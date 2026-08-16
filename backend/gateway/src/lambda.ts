import "reflect-metadata";
import { randomBytes } from "node:crypto";
import {
  type AccessTokenVerifier,
  AuthenticationError,
  type AuthPrincipal,
} from "@ai-job-apply/auth";
import {
  BillingEntitlementService,
  EntitlementCache,
  PostgresBillingStore,
} from "@ai-job-apply/billing-service";
import { loadLambdaGatewayConfig } from "@ai-job-apply/config";
import {
  PostgresDocumentStore,
  S3ResumeUploadSigner,
  UnavailableDocumentStore,
} from "@ai-job-apply/documents-service";
import { PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  deriveSavedJobCursorKeys,
  MatchAssessmentService,
  PostgresSavedJobStore,
  SavedJobsService,
} from "@ai-job-apply/matching-service";
import { createLogger, initializeTelemetry } from "@ai-job-apply/observability";
import {
  createDatabase,
  PostgresProfileStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";
import { createGatewayApplication } from "./application.js";
import { MAXIMUM_GATEWAY_BODY_BYTES } from "./gateway-boundary.js";
import { deriveJobSearchCursorKeys } from "./job-search-cursor-key.js";
import { JobCatalogSavedJobResolver } from "./saved-job-catalog-resolver.js";
import { SqsOutboxNudgePublisher } from "./sqs-outbox-nudge-publisher.js";

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
  onAuthenticationFailure?: (diagnostic: AuthenticationContextDiagnostic) => void;
}

export interface AuthenticationContextDiagnostic {
  claimsPresent: boolean;
  subjectPresent: boolean;
  issuerMatches: boolean;
  audienceMatches: boolean;
  audienceEncoding: "absent" | "array" | "json_array" | "scalar" | "unsupported";
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
  "GET /v1/profile/facts",
  "POST /v1/profile/facts",
  "GET /v1/resumes",
  "POST /v1/resumes/uploads",
  "POST /v1/jobs/search",
  "POST /v1/saved-jobs",
  "POST /v1/saved-jobs/search",
  "GET /v1/entitlements",
]);
const OPERATION_PATH_PATTERN =
  /^\/v1\/operations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_PATH_PATTERN =
  /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_ASSESSMENT_PATH_PATTERN =
  /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/match-assessment$/;
const PROFILE_FACT_PATH_PATTERN =
  /^\/v1\/profile\/facts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAVED_JOB_PATH_PATTERN =
  /^\/v1\/saved-jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
const MAXIMUM_BEARER_TOKEN_BYTES = 16 * 1024;

interface AllowedRoute {
  acceptsBody: boolean;
  protected: boolean;
}

function allowedRoute(method: string, path: string): AllowedRoute | undefined {
  if (method === "GET" && PUBLIC_PATHS.has(path)) {
    return { acceptsBody: false, protected: false };
  }
  if (PROTECTED_EXACT_ROUTES.has(`${method} ${path}`)) {
    return { acceptsBody: method === "PUT" || method === "POST", protected: true };
  }
  if (method === "PATCH" && PROFILE_FACT_PATH_PATTERN.test(path)) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "GET" && (OPERATION_PATH_PATTERN.test(path) || JOB_PATH_PATTERN.test(path))) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "GET" && MATCH_ASSESSMENT_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "DELETE" && SAVED_JOB_PATH_PATTERN.test(path)) {
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
  if (typeof value !== "string") {
    return [];
  }

  // API Gateway's JWT context normally preserves a scalar audience. Some providers issue a
  // multi-audience claim that API Gateway represents as a JSON-encoded string. Normalize only a
  // valid string array; never split arbitrary text or weaken exact audience matching.
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed;
      }
    } catch {
      // Treat malformed serialized data as one non-matching scalar and fail closed below.
    }
  }
  return [value];
}

function bearerTokenClaims(
  event: AuthorizedHttpApiEvent,
): Record<string, JwtClaimValue> | undefined {
  const authorization = Object.entries(event.headers ?? {}).find(
    ([name, value]) => name.toLowerCase() === "authorization" && typeof value === "string",
  )?.[1];
  if (typeof authorization !== "string" || authorization.length > MAXIMUM_BEARER_TOKEN_BYTES) {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match?.[2]) {
    return undefined;
  }

  try {
    const decoded: unknown = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return undefined;
    }
    return decoded as Record<string, JwtClaimValue>;
  } catch {
    return undefined;
  }
}

function audienceEncoding(
  value: JwtClaimValue,
): AuthenticationContextDiagnostic["audienceEncoding"] {
  if (value === undefined) {
    return "absent";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value !== "string") {
    return "unsupported";
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return "json_array";
      }
    } catch {
      // The invalid value remains a scalar for privacy-safe diagnostics and fails exact matching.
    }
  }
  return "scalar";
}

function authorizerPrincipal(
  event: AuthorizedHttpApiEvent,
  issuer: string,
  audience: string,
  onAuthenticationFailure?: (diagnostic: AuthenticationContextDiagnostic) => void,
): AuthPrincipal {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const subject = typeof claims?.sub === "string" ? claims.sub : undefined;
  const tokenIssuer = typeof claims?.iss === "string" ? claims.iss : undefined;
  const contextAudiences = claimStrings(claims?.aud);
  const contextAudienceMatches = contextAudiences.includes(audience);
  const originalClaims = contextAudienceMatches ? undefined : bearerTokenClaims(event);
  const originalSubject = typeof originalClaims?.sub === "string" ? originalClaims.sub : undefined;
  const originalIssuer = typeof originalClaims?.iss === "string" ? originalClaims.iss : undefined;
  const originalAudiences = claimStrings(originalClaims?.aud);
  // API Gateway has already verified the bearer token's signature, algorithm, time claims,
  // issuer, and audience before creating this authorizer context. Its string-only claims map can
  // flatten a standards-compliant multi-valued `aud` claim. In that one case, recover the exact
  // array from the same bearer token and bind it back to the trusted context through issuer and
  // subject equality. The caller token is never forwarded into the application.
  const originalAudienceMatches =
    Boolean(claims?.aud) &&
    originalIssuer === tokenIssuer &&
    originalSubject === subject &&
    originalAudiences.includes(audience);
  const audiences = contextAudienceMatches ? contextAudiences : originalAudiences;
  const validatedScopes = event.requestContext.authorizer?.jwt?.scopes;
  const scopes = Array.isArray(validatedScopes)
    ? validatedScopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  if (
    !claims ||
    !subject ||
    tokenIssuer !== issuer ||
    (!contextAudienceMatches && !originalAudienceMatches)
  ) {
    onAuthenticationFailure?.({
      claimsPresent: Boolean(claims),
      subjectPresent: Boolean(subject),
      issuerMatches: tokenIssuer === issuer,
      audienceMatches: contextAudienceMatches || originalAudienceMatches,
      audienceEncoding: audienceEncoding(claims?.aud),
    });
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
        principal = authorizerPrincipal(
          event,
          options.issuer,
          options.audience,
          options.onAuthenticationFailure,
        );
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
  const database = createDatabase(databaseUrl, { maxConnections: 2 });
  const store = new PostgresProfileStore(database, {
    dispatchTarget: config.OUTBOX_DISPATCH_TARGET,
    ...(config.OUTBOX_QUEUE_URL
      ? { nudgePublisher: new SqsOutboxNudgePublisher(config.OUTBOX_QUEUE_URL) }
      : {}),
  });
  const catalog = new PostgresJobCatalog(database.client, {
    searchCursorKeys: deriveJobSearchCursorKeys(databaseUrl),
  });
  const savedJobs = new SavedJobsService(
    new PostgresSavedJobStore(database.client),
    new JobCatalogSavedJobResolver(catalog),
    deriveSavedJobCursorKeys(databaseUrl),
  );
  const matchAssessments = new MatchAssessmentService(store, catalog);
  const entitlements = new BillingEntitlementService(
    new PostgresBillingStore(database.client),
    new EntitlementCache({ capacity: 1_000, freshTtlMs: 5_000 }),
  );
  const documents =
    config.DOCUMENT_UPLOAD_BUCKET && config.DOCUMENT_UPLOAD_KMS_KEY_ARN
      ? new PostgresDocumentStore(
          database.client,
          new S3ResumeUploadSigner({
            bucket: config.DOCUMENT_UPLOAD_BUCKET,
            kmsKeyArn: config.DOCUMENT_UPLOAD_KMS_KEY_ARN,
          }),
        )
      : new UnavailableDocumentStore();
  return createGatewayApplication({
    store,
    catalog,
    savedJobs,
    matchAssessments,
    entitlements,
    documents,
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
    const boundaryLogger = createLogger({
      service: "gateway",
      level: config.LOG_LEVEL,
      releaseSha: config.RELEASE_SHA,
    });
    configuredHandler = createApiGatewayHandler({
      app: createConfiguredApplication(principalBridge),
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
      principalBridge,
      onAuthenticationFailure: (diagnostic) => {
        boundaryLogger.warn(
          { event: "api_gateway_identity_context_rejected", ...diagnostic },
          "API Gateway identity context failed the Lambda defense-in-depth check",
        );
      },
    });
  }
  return configuredHandler(event);
};
