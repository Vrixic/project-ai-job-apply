import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AccessTokenVerifier,
  AuthenticationError,
  type AuthPrincipal,
} from "@ai-job-apply/auth";
import { loadLambdaGatewayConfig } from "@ai-job-apply/config";
import { createLogger, initializeTelemetry } from "@ai-job-apply/observability";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";
import { createGatewayApplication } from "./application.js";
import { resolveLambdaDatabaseUrl } from "./database-secret.js";

type JwtClaimValue = string | number | boolean | string[] | undefined;

interface JwtAuthorizerContext {
  jwt?: {
    claims?: Record<string, JwtClaimValue>;
  };
}

export type AuthorizedHttpApiEvent = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: JwtAuthorizerContext;
  };
};

interface InjectableApplication {
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: string;
  }): Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | number | undefined>;
  }>;
}

export interface ApiGatewayHandlerOptions {
  app: Promise<InjectableApplication>;
  issuer: string;
  audience: string;
  principalContext: AsyncLocalStorage<AuthPrincipal>;
}

export type ApiGatewayHandler = (
  event: AuthorizedHttpApiEvent,
) => Promise<APIGatewayProxyStructuredResultV2>;

const PUBLIC_PATHS = new Set(["/health/live", "/health/ready"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function claimStrings(value: JwtClaimValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function authorizerPrincipal(
  event: AuthorizedHttpApiEvent,
  issuer: string,
  audience: string,
): AuthPrincipal {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const subject = typeof claims?.sub === "string" ? claims.sub : undefined;
  const tokenIssuer = typeof claims?.iss === "string" ? claims.iss : undefined;
  const audiences = claimStrings(claims?.aud);
  const scopeClaim = claims?.scope;
  const scopes = Array.isArray(scopeClaim)
    ? claimStrings(scopeClaim)
    : typeof scopeClaim === "string"
      ? scopeClaim.split(" ").filter(Boolean)
      : [];

  if (!claims || !subject || tokenIssuer !== issuer || !audiences.includes(audience)) {
    throw new AuthenticationError("Validated API Gateway identity context is required");
  }

  return {
    issuer: tokenIssuer,
    subject,
    audience: audiences,
    scopes,
    ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    ...(typeof claims.sid === "string" ? { sessionId: claims.sid } : {}),
  };
}

export function createAuthorizerContextVerifier(
  context: AsyncLocalStorage<AuthPrincipal>,
): AccessTokenVerifier {
  return {
    async verify(): Promise<AuthPrincipal> {
      const principal = context.getStore();
      if (!principal) {
        throw new AuthenticationError("Validated API Gateway identity context is required");
      }
      return principal;
    },
  };
}

function requestHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (typeof value === "string") {
      headers[name.toLowerCase()] = value;
    }
  }
  if (event.cookies?.length) {
    headers.cookie = event.cookies.join("; ");
  }
  return headers;
}

function responseHeaders(headers: Record<string, string | string[] | number | undefined>): {
  headers: Record<string, string>;
  cookies?: string[];
} {
  const result: Record<string, string> = {};
  let cookies: string[] | undefined;
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (rawValue === undefined || HOP_BY_HOP_HEADERS.has(name)) {
      continue;
    }
    if (name === "set-cookie") {
      cookies = Array.isArray(rawValue) ? rawValue.map(String) : [String(rawValue)];
      continue;
    }
    result[name] = Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue);
  }
  return cookies ? { headers: result, cookies } : { headers: result };
}

function authenticationFailure(event: APIGatewayProxyEventV2): APIGatewayProxyStructuredResultV2 {
  const traceId = event.requestContext.requestId;
  return {
    statusCode: 401,
    headers: {
      "content-type": "application/problem+json",
      "x-correlation-id": traceId,
    },
    body: JSON.stringify({
      type: "urn:ai-job-apply:problem:authentication_required",
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
      traceId,
      detail: "Validated API Gateway identity context is required",
    }),
  };
}

export function createApiGatewayHandler(options: ApiGatewayHandlerOptions): ApiGatewayHandler {
  return async (event) => {
    const path = event.rawPath || "/";
    let principal: AuthPrincipal | undefined;
    if (!PUBLIC_PATHS.has(path)) {
      try {
        principal = authorizerPrincipal(event, options.issuer, options.audience);
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return authenticationFailure(event);
        }
        throw error;
      }
    }

    const app = await options.app;
    const headers = requestHeaders(event);
    headers["x-correlation-id"] ??= event.requestContext.requestId;
    const payload = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body
      : undefined;
    const inject = () =>
      app.inject({
        method: event.requestContext.http.method,
        url: event.rawQueryString ? `${path}?${event.rawQueryString}` : path,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
    const response = principal
      ? await options.principalContext.run(principal, inject)
      : await inject();
    const mappedHeaders = responseHeaders(response.headers);
    return {
      statusCode: response.statusCode,
      headers: mappedHeaders.headers,
      ...(mappedHeaders.cookies ? { cookies: mappedHeaders.cookies } : {}),
      body: response.body,
      isBase64Encoded: false,
    };
  };
}

async function createConfiguredApplication(
  principalContext: AsyncLocalStorage<AuthPrincipal>,
): Promise<NestFastifyApplication> {
  const config = loadLambdaGatewayConfig();
  initializeTelemetry({
    service: "gateway",
    environment: config.NODE_ENV,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
    sampleRatio: config.OTEL_TRACE_SAMPLE_RATIO,
    releaseSha: config.RELEASE_SHA,
  });
  const logger = createLogger({
    service: "gateway",
    level: config.LOG_LEVEL,
    releaseSha: config.RELEASE_SHA,
  });
  const databaseUrl = await resolveLambdaDatabaseUrl(config, {
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  });
  const store = new PostgresProfileStore(createDatabase(databaseUrl, { maxConnections: 2 }));
  return createGatewayApplication({
    store,
    verifier: createAuthorizerContextVerifier(principalContext),
    releaseSha: config.RELEASE_SHA,
    adapter: new FastifyAdapter({ loggerInstance: logger }),
  });
}

let configuredHandler: ApiGatewayHandler | undefined;

export const handler: Handler<AuthorizedHttpApiEvent, APIGatewayProxyStructuredResultV2> = async (
  event,
) => {
  if (!configuredHandler) {
    const config = loadLambdaGatewayConfig();
    const principalContext = new AsyncLocalStorage<AuthPrincipal>();
    configuredHandler = createApiGatewayHandler({
      app: createConfiguredApplication(principalContext),
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
      principalContext,
    });
  }
  return configuredHandler(event);
};
