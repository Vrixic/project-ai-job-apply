import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AccessTokenVerifier,
  AuthenticationError,
  type AuthPrincipal,
  bearerToken,
  createOidcVerifier,
} from "@ai-job-apply/auth";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { MAXIMUM_GATEWAY_BODY_BYTES } from "./gateway-boundary.js";
import type { AuthorizedHttpApiEvent } from "./lambda.js";

const operationPathPattern =
  /^\/v1\/operations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const responseHeaderAllowlist = new Set(["content-type", "x-correlation-id"]);

interface BridgeRequest {
  body?: string;
  headers: Record<string, string | undefined>;
  method: string;
  path: string;
}

interface LambdaInvocation {
  executedVersion?: string;
  functionError?: string;
  payload?: Uint8Array;
}

interface LambdaInvoker {
  invoke(event: AuthorizedHttpApiEvent): Promise<LambdaInvocation>;
}

interface BridgeDependencies {
  audience: string;
  expectedVersion: string;
  invoker: LambdaInvoker;
  issuer: string;
  now?: () => Date;
  requestId?: () => string;
  verifier: AccessTokenVerifier;
}

export interface DarkConformanceTarget {
  alias: string;
  audience: string;
  environment: string;
  expectedVersion: string;
  functionName: string;
  port: number;
  region: string;
}

interface AllowedRoute {
  protected: boolean;
  routeKey: string;
}

function allowedRoute(method: string, path: string): AllowedRoute | undefined {
  if (method === "GET" && ["/health/live", "/health/ready"].includes(path)) {
    return { protected: false, routeKey: `${method} ${path}` };
  }
  if (method === "GET" && ["/v1/me", "/v1/me/job-preferences"].includes(path)) {
    return { protected: true, routeKey: `${method} ${path}` };
  }
  if (method === "PUT" && path === "/v1/me/job-preferences") {
    return { protected: true, routeKey: `${method} ${path}` };
  }
  if (method === "GET" && operationPathPattern.test(path)) {
    return { protected: true, routeKey: "GET /v1/operations/{operationId}" };
  }
  return undefined;
}

function problem(status: number, code: string, title: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json",
    },
    body: JSON.stringify({
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
    }),
  };
}

function authorizerClaims(principal: AuthPrincipal): Record<string, string | string[]> {
  return {
    iss: principal.issuer,
    sub: principal.subject,
    aud: principal.audience,
    scope: principal.scopes.join(" "),
  };
}

function forwardedHeaders(request: BridgeRequest, protectedRoute: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  const contentType = request.headers["content-type"];
  const idempotencyKey = request.headers["idempotency-key"];
  const correlationId = request.headers["x-correlation-id"];
  if (contentType) {
    headers["content-type"] = contentType;
  }
  if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }
  if (correlationId) {
    headers["x-correlation-id"] = correlationId;
  }
  if (protectedRoute) {
    // The application requires a bearer-shaped header, but trusts identity only from the
    // independently validated authorizer context. Never forward the real access token to Lambda.
    headers.authorization = "Bearer validated-loopback-authorizer-context";
  }
  return headers;
}

function validLambdaResponse(value: unknown): value is APIGatewayProxyStructuredResultV2 {
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as Partial<APIGatewayProxyStructuredResultV2>;
  return (
    typeof response.statusCode === "number" &&
    Number.isInteger(response.statusCode) &&
    response.statusCode >= 100 &&
    response.statusCode <= 599 &&
    (response.body === undefined || typeof response.body === "string")
  );
}

export async function handleDarkConformanceRequest(
  request: BridgeRequest,
  dependencies: BridgeDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = request.method.toUpperCase();
  const route = allowedRoute(method, request.path);
  if (!route) {
    return problem(404, "not_found", "Not found");
  }

  let principal: AuthPrincipal | undefined;
  if (route.protected) {
    try {
      const accessToken = bearerToken(request.headers.authorization);
      principal = await dependencies.verifier.verify(accessToken);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return problem(401, "authentication_required", "Authentication required");
      }
      throw error;
    }
  }

  const now = dependencies.now?.() ?? new Date();
  const requestId = dependencies.requestId?.() ?? randomUUID();
  const event: AuthorizedHttpApiEvent = {
    version: "2.0",
    routeKey: route.routeKey,
    rawPath: request.path,
    rawQueryString: "",
    headers: forwardedHeaders(request, route.protected),
    requestContext: {
      accountId: "dark-conformance",
      apiId: "dark-conformance",
      domainName: "127.0.0.1",
      domainPrefix: "dark-conformance",
      http: {
        method,
        path: request.path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "applydash-dark-conformance",
      },
      requestId,
      routeKey: route.routeKey,
      stage: "$default",
      time: now.toISOString(),
      timeEpoch: now.getTime(),
      ...(principal
        ? {
            authorizer: {
              jwt: {
                claims: authorizerClaims(principal),
                scopes: principal.scopes,
              },
            },
          }
        : {}),
    },
    isBase64Encoded: false,
    ...(request.body !== undefined ? { body: request.body } : {}),
  };

  try {
    const invocation = await dependencies.invoker.invoke(event);
    if (
      invocation.functionError ||
      invocation.executedVersion !== dependencies.expectedVersion ||
      !invocation.payload
    ) {
      return problem(503, "platform_unavailable", "The platform API is unavailable");
    }
    const parsed = JSON.parse(Buffer.from(invocation.payload).toString("utf8")) as unknown;
    return validLambdaResponse(parsed)
      ? parsed
      : problem(503, "platform_unavailable", "The platform API is unavailable");
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAXIMUM_GATEWAY_BODY_BYTES) {
      throw new Error("request_too_large");
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function writeResponse(target: ServerResponse, response: APIGatewayProxyStructuredResultV2): void {
  target.statusCode = response.statusCode ?? 500;
  target.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    const normalized = name.toLowerCase();
    if (responseHeaderAllowlist.has(normalized) && typeof value === "string") {
      target.setHeader(normalized, value);
    }
  }
  target.end(response.body ?? "");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function exactHttpsIssuer(value: string): string {
  const issuer = new URL(value);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/"
  ) {
    throw new Error("OIDC_ISSUER must be an exact HTTPS issuer origin ending in a slash");
  }
  return issuer.toString();
}

export function validateDarkConformanceTarget(target: DarkConformanceTarget): void {
  if (
    target.region !== "us-east-2" ||
    !["development", "staging"].includes(target.environment) ||
    target.functionName !== `ai-job-apply-${target.environment}-gateway` ||
    target.alias !== target.environment ||
    !/^[1-9][0-9]*$/.test(target.expectedVersion) ||
    target.audience !== "ai-job-apply-api" ||
    !Number.isInteger(target.port) ||
    target.port < 1024 ||
    target.port > 65_535
  ) {
    throw new Error(
      "The dark Lambda bridge configuration is outside the selected environment boundary",
    );
  }
}

function isEntrypoint(): boolean {
  const argument = process.argv[1];
  return Boolean(
    argument &&
      resolve(argument).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase(),
  );
}

async function startBridge(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.DARK_LAMBDA_CONFORMANCE !== "1") {
    throw new Error("The dark Lambda bridge is restricted to explicit local conformance");
  }
  const region = requiredEnvironment("AWS_REGION");
  const environment = requiredEnvironment("DARK_LAMBDA_ENVIRONMENT");
  const functionName = requiredEnvironment("DARK_LAMBDA_FUNCTION_NAME");
  const alias = requiredEnvironment("DARK_LAMBDA_ALIAS");
  const expectedVersion = requiredEnvironment("DARK_LAMBDA_EXPECTED_VERSION");
  const issuer = exactHttpsIssuer(requiredEnvironment("OIDC_ISSUER"));
  const audience = requiredEnvironment("OIDC_AUDIENCE");
  const port = Number(process.env.DARK_LAMBDA_BRIDGE_PORT ?? "4400");
  validateDarkConformanceTarget({
    alias,
    audience,
    environment,
    expectedVersion,
    functionName,
    port,
    region,
  });

  const client = new LambdaClient({ region });
  const dependencies: BridgeDependencies = {
    audience,
    expectedVersion,
    issuer,
    verifier: createOidcVerifier({ issuer, audience }),
    invoker: {
      async invoke(event) {
        const output = await client.send(
          new InvokeCommand({
            FunctionName: functionName,
            Qualifier: alias,
            InvocationType: "RequestResponse",
            Payload: Buffer.from(JSON.stringify(event)),
          }),
        );
        return {
          ...(output.ExecutedVersion ? { executedVersion: output.ExecutedVersion } : {}),
          ...(output.FunctionError ? { functionError: output.FunctionError } : {}),
          ...(output.Payload ? { payload: output.Payload } : {}),
        };
      },
    },
  };

  const server = createServer(async (request, response) => {
    try {
      const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
      if (parsed.search || parsed.hash) {
        writeResponse(response, problem(404, "not_found", "Not found"));
        return;
      }
      const body = request.method === "PUT" ? await readBody(request) : undefined;
      const result = await handleDarkConformanceRequest(
        {
          method: request.method ?? "GET",
          path: parsed.pathname,
          headers: {
            authorization: singleHeader(request, "authorization"),
            "content-type": singleHeader(request, "content-type"),
            "idempotency-key": singleHeader(request, "idempotency-key"),
            "x-correlation-id": singleHeader(request, "x-correlation-id"),
          },
          ...(body !== undefined ? { body } : {}),
        },
        dependencies,
      );
      writeResponse(response, result);
    } catch (error) {
      writeResponse(
        response,
        error instanceof Error && error.message === "request_too_large"
          ? problem(413, "payload_too_large", "Payload too large")
          : problem(503, "platform_unavailable", "The platform API is unavailable"),
      );
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`${environment} dark Lambda conformance bridge ready on loopback.\n`);
  });

  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (isEntrypoint()) {
  await startBridge();
}
