import "reflect-metadata";
import { randomBytes } from "node:crypto";
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
import { MAXIMUM_GATEWAY_BODY_BYTES } from "./gateway-boundary.js";

type JwtClaimValue = string | number | boolean | string[] | undefined;

interface JwtAuthorizerContext {
  jwt?: {
    claims?: Record<string, JwtClaimValue>;
    scopes?: string[];
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
  principalBridge: InvocationPrincipalBridge;
}

export interface InvocationPrincipalBridge {
  verifier: AccessTokenVerifier;
  run<T>(
    principal: AuthPrincipal,
    dispatch: (internalAccessToken: string) => Promise<T>,
  ): Promise<T>;
}

export type ApiGatewayHandler = (
  event: AuthorizedHttpApiEvent,
) => Promise<APIGatewayProxyStructuredResultV2>;

const PUBLIC_PATHS = new Set(["/health/live", "/health/ready"]);
const PROTECTED_EXACT_ROUTES = new Set([
  "GET /v1/me",
  "GET /v1/me/job-preferences",
  "PUT /v1/me/job-preferences",
]);
const OPERATION_PATH_PATTERN =
  /^\/v1\/operations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

interface AllowedRoute {
  acceptsBody: boolean;
  protected: boolean;
}

function allowedRoute(method: string, path: string): AllowedRoute | undefined {
  if (method === "GET" && PUBLIC_PATHS.has(path)) {
    return { acceptsBody: false, protected: false };
  }
  if (PROTECTED_EXACT_ROUTES.has(`${method} ${path}`)) {
    return { acceptsBody: method === "PUT", protected: true };
  }
  if (method === "GET" && OPERATION_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  return undefined;
}

function boundaryFailure(
  event: APIGatewayProxyEventV2,
  status: number,
  code: string,
  title: string,
): APIGatewayProxyStructuredResultV2 {
  const traceId = event.requestContext.requestId;
  return {
    statusCode: status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      "x-correlation-id": traceId,
    },
    body: JSON.stringify({
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId,
    }),
  };
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function decodeBase64(value: string): Buffer | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  return Buffer.from(value, "base64");
}

function requestPayload(
  event: APIGatewayProxyEventV2,
  route: AllowedRoute,
): { failure?: APIGatewayProxyStructuredResultV2; payload?: string } {
  if (event.rawQueryString) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }

  if (event.body === undefined) {
    if (route.acceptsBody) {
      return {
        failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
      };
    }
    return {};
  }

  if (!route.acceptsBody) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }
  if (!isJsonContentType(event.headers?.["content-type"] ?? event.headers?.["Content-Type"])) {
    return {
      failure: boundaryFailure(event, 415, "unsupported_media_type", "Unsupported media type"),
    };
  }

  const body = event.isBase64Encoded ? decodeBase64(event.body) : Buffer.from(event.body, "utf8");
  if (!body) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }
  if (body.byteLength > MAXIMUM_GATEWAY_BODY_BYTES) {
    return {
      failure: boundaryFailure(event, 413, "payload_too_large", "Payload too large"),
    };
  }
  return { payload: body.toString("utf8") };
}

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
  const validatedScopes = event.requestContext.authorizer?.jwt?.scopes;
  const scopes = Array.isArray(validatedScopes)
    ? validatedScopes.filter((scope): scope is string => typeof scope === "string")
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

/**
 * Bridges the principal already validated by API Gateway into the normal HTTP authentication
 * boundary without forwarding the caller's bearer token into the application. Tokens are random,
 * invocation-scoped capabilities held only in Lambda memory and removed after dispatch.
 */
export function createInvocationPrincipalBridge(): InvocationPrincipalBridge {
  const principals = new Map<string, AuthPrincipal>();
  const verifier: AccessTokenVerifier = {
    async verify(accessToken): Promise<AuthPrincipal> {
      const principal = principals.get(accessToken);
      if (!principal) {
        throw new AuthenticationError("Validated API Gateway identity context is required");
      }
      return principal;
    },
  };

  return {
    verifier,
    async run<T>(
      principal: AuthPrincipal,
      dispatch: (internalAccessToken: string) => Promise<T>,
    ): Promise<T> {
      let internalAccessToken: string;
      do {
        internalAccessToken = randomBytes(32).toString("base64url");
      } while (principals.has(internalAccessToken));

      principals.set(internalAccessToken, principal);
      try {
        return await dispatch(internalAccessToken);
      } finally {
        principals.delete(internalAccessToken);
      }
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
  return boundaryFailure(event, 401, "authentication_required", "Authentication required");
}

export function createApiGatewayHandler(options: ApiGatewayHandlerOptions): ApiGatewayHandler {
  return async (event) => {
    const path = event.rawPath || "/";
    const method = event.requestContext.http.method.toUpperCase();
    const route = allowedRoute(method, path);
    if (!route) {
      return boundaryFailure(event, 404, "not_found", "Not found");
    }

    const decodedRequest = requestPayload(event, route);
    if (decodedRequest.failure) {
      return decodedRequest.failure;
    }

    let principal: AuthPrincipal | undefined;
    if (route.protected) {
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
    const inject = (internalAccessToken?: string) => {
      const headers = requestHeaders(event);
      headers["x-correlation-id"] ??= event.requestContext.requestId;
      if (internalAccessToken) {
        headers.authorization = `Bearer ${internalAccessToken}`;
      }
      return app.inject({
        method,
        url: path,
        headers,
        ...(decodedRequest.payload !== undefined ? { payload: decodedRequest.payload } : {}),
      });
    };
    const response = principal
      ? await options.principalBridge.run(principal, inject)
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
  principalBridge: InvocationPrincipalBridge,
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
    verifier: principalBridge.verifier,
    releaseSha: config.RELEASE_SHA,
    adapter: new FastifyAdapter({
      bodyLimit: MAXIMUM_GATEWAY_BODY_BYTES,
      loggerInstance: logger,
    }),
  });
}

let configuredHandler: ApiGatewayHandler | undefined;

export const handler: Handler<AuthorizedHttpApiEvent, APIGatewayProxyStructuredResultV2> = async (
  event,
) => {
  if (!configuredHandler) {
    const config = loadLambdaGatewayConfig();
    const principalBridge = createInvocationPrincipalBridge();
    configuredHandler = createApiGatewayHandler({
      app: createConfiguredApplication(principalBridge),
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
      principalBridge,
    });
  }
  return configuredHandler(event);
};
