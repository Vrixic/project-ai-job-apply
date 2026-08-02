import type { AuthPrincipal } from "@ai-job-apply/auth";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
} from "./lambda.js";

const ISSUER = "https://identity.example.test/";
const AUDIENCE = "ai-job-apply-api";

function event(overrides: Partial<AuthorizedHttpApiEvent> = {}): AuthorizedHttpApiEvent {
  return {
    version: "2.0",
    routeKey: "GET /v1/me",
    rawPath: "/v1/me",
    rawQueryString: "",
    headers: { authorization: "Bearer opaque-api-gateway-token" },
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method: "GET",
        path: "/v1/me",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.1",
        userAgent: "test",
      },
      requestId: "request-id-0001",
      routeKey: "GET /v1/me",
      stage: "$default",
      time: "31/Jul/2026:00:00:00 +0000",
      timeEpoch: 1_775_000_000_000,
      authorizer: {
        jwt: {
          claims: {
            iss: ISSUER,
            sub: "auth0|candidate-1",
            aud: [AUDIENCE],
            scope: "profile:read profile:write",
            email: "candidate@example.test",
          },
        },
      },
    },
    isBase64Encoded: false,
    ...overrides,
  } as AuthorizedHttpApiEvent;
}

function invoke(
  handler: ReturnType<typeof createApiGatewayHandler>,
  input: AuthorizedHttpApiEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handler(input);
}

describe("API Gateway Lambda boundary", () => {
  it("allows the exact public health route without authorizer context", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"status":"ok"}',
      headers: { "content-type": "application/json", "content-length": "15" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });

    const input = event({
      rawPath: "/health/live",
      headers: {},
      requestContext: {
        ...event().requestContext,
        http: { ...event().requestContext.http, path: "/health/live" },
      },
    });
    delete input.requestContext.authorizer;
    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledOnce();
    expect(response.headers).not.toHaveProperty("content-length");
  });

  it("fails closed before application dispatch when authorizer context is absent", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event();
    delete input.requestContext.authorizer;

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body ?? "{}").code).toBe("authentication_required");
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.example/" }],
    ["wrong audience", { aud: ["different-api"] }],
    ["missing subject", { sub: undefined }],
  ])("rejects %s authorizer claims", async (_label, replacement) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event();
    Object.assign(input.requestContext.authorizer?.jwt?.claims ?? {}, replacement);

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(401);
    expect(inject).not.toHaveBeenCalled();
  });

  it("maps the v2 request and exposes only the validated principal during dispatch", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const verifier = principalBridge.verifier;
    let observedPrincipal: AuthPrincipal | undefined;
    const inject = vi.fn(async (request: { headers: Record<string, string> }) => {
      const accessToken = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      observedPrincipal = await verifier.verify(accessToken);
      return {
        statusCode: 200,
        body: '{"ok":true}',
        headers: {
          "content-type": "application/json",
          "set-cookie": ["session=one; Secure", "state=two; Secure"],
          connection: "keep-alive",
        },
      };
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const payload = JSON.stringify({ targetRoles: ["Engineer"] });
    const response = await invoke(
      handler,
      event({
        rawPath: "/v1/me/job-preferences",
        rawQueryString: "source=web",
        body: Buffer.from(payload).toString("base64"),
        isBase64Encoded: true,
        cookies: ["csrf=one", "device=two"],
        requestContext: {
          ...event().requestContext,
          http: {
            ...event().requestContext.http,
            method: "PUT",
            path: "/v1/me/job-preferences",
          },
        },
      }),
    );

    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        url: "/v1/me/job-preferences?source=web",
        payload,
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer (?!opaque-api-gateway-token$).+/),
          cookie: "csrf=one; device=two",
          "x-correlation-id": "request-id-0001",
        }),
      }),
    );
    expect(observedPrincipal).toMatchObject({
      issuer: ISSUER,
      subject: "auth0|candidate-1",
      audience: [AUDIENCE],
      scopes: ["profile:read", "profile:write"],
    });
    expect(response.cookies).toEqual(["session=one; Secure", "state=two; Secure"]);
    expect(response.headers).not.toHaveProperty("connection");
    await expect(verifier.verify("outside-dispatch")).rejects.toThrow(
      "Validated API Gateway identity context is required",
    );
  });

  it("isolates concurrent principals and removes invocation capabilities after dispatch", async () => {
    const bridge = createInvocationPrincipalBridge();
    const observed = new Map<string, AuthPrincipal>();
    const tokens: string[] = [];
    const principals: AuthPrincipal[] = [
      {
        issuer: ISSUER,
        subject: "auth0|candidate-1",
        audience: [AUDIENCE],
        scopes: ["profile:read"],
      },
      {
        issuer: ISSUER,
        subject: "auth0|candidate-2",
        audience: [AUDIENCE],
        scopes: ["profile:write"],
      },
    ];

    await Promise.all(
      principals.map((principal) =>
        bridge.run(principal, async (token) => {
          tokens.push(token);
          await Promise.resolve();
          observed.set(principal.subject, await bridge.verifier.verify(token));
        }),
      ),
    );

    expect(tokens[0]).not.toBe(tokens[1]);
    expect(observed.get("auth0|candidate-1")?.subject).toBe("auth0|candidate-1");
    expect(observed.get("auth0|candidate-2")?.subject).toBe("auth0|candidate-2");
    await Promise.all(
      tokens.map((token) =>
        expect(bridge.verifier.verify(token)).rejects.toThrow(
          "Validated API Gateway identity context is required",
        ),
      ),
    );
  });
});
