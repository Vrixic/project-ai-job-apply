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

function bearerToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.test-signature`;
}

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
          scopes: ["profile:read", "profile:write"],
        },
      },
    },
    isBase64Encoded: false,
    ...overrides,
  } as AuthorizedHttpApiEvent;
}

function routedEvent(
  method: string,
  path: string,
  overrides: Partial<AuthorizedHttpApiEvent> = {},
): AuthorizedHttpApiEvent {
  const base = event();
  return event({
    routeKey: `${method} ${path}`,
    rawPath: path,
    requestContext: {
      ...base.requestContext,
      http: { ...base.requestContext.http, method, path },
      routeKey: `${method} ${path}`,
    },
    ...overrides,
  });
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

  it("allows an exact canonical-job UUID route through the protected boundary", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"status":"active"}',
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const path = "/v1/jobs/018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";

    const response = await invoke(handler, routedEvent("GET", path));

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", url: path }));
  });

  it("allows only the exact bodyless entitlement GET boundary", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"plan":"free"}',
      headers: { "cache-control": "no-store", "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });

    const accepted = await invoke(handler, routedEvent("GET", "/v1/entitlements"));
    const query = await invoke(
      handler,
      routedEvent("GET", "/v1/entitlements", { rawQueryString: "owner=other" }),
    );
    const body = await invoke(
      handler,
      routedEvent("GET", "/v1/entitlements", {
        body: "{}",
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    );
    const trailing = await invoke(handler, routedEvent("GET", "/v1/entitlements/"));
    const post = await invoke(handler, routedEvent("POST", "/v1/entitlements"));

    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers?.["cache-control"]).toBe("no-store");
    expect(query.statusCode).toBe(400);
    expect(body.statusCode).toBe(400);
    expect(trailing.statusCode).toBe(404);
    expect(post.statusCode).toBe(404);
    expect(inject).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "/v1/entitlements" }),
    );
  });

  it("allows only an exact lowercase UUIDv7 bodyless match-assessment route", async () => {
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: "{}",
      headers: { "cache-control": "no-store" },
    });
    const principalBridge = createInvocationPrincipalBridge();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const jobId = "019d04cf-1f80-7000-8000-000000000012";
    const path = `/v1/jobs/${jobId}/match-assessment`;

    expect((await invoke(handler, routedEvent("GET", path))).statusCode).toBe(200);
    expect(
      (await invoke(handler, routedEvent("GET", path, { rawQueryString: "owner=other" })))
        .statusCode,
    ).toBe(400);
    expect((await invoke(handler, routedEvent("GET", path, { body: "{}" }))).statusCode).toBe(400);
    expect((await invoke(handler, routedEvent("GET", path.toUpperCase()))).statusCode).toBe(404);
    expect(
      (
        await invoke(
          handler,
          routedEvent("GET", "/v1/jobs/019d04cf-1f80-4000-8000-000000000012/match-assessment"),
        )
      ).statusCode,
    ).toBe(404);
    expect(inject).toHaveBeenCalledOnce();
  });

  it("allows only a JSON body on the exact protected job-search route", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"items":[]}',
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const payload = JSON.stringify({ query: "synthetic engineer", pageSize: 10 });
    const input = routedEvent("POST", "/v1/jobs/search", {
      body: payload,
      headers: {
        authorization: "Bearer opaque-api-gateway-token",
        "content-type": "application/json",
      },
    });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", url: "/v1/jobs/search", payload }),
    );

    const queryBearing = await invoke(
      handler,
      routedEvent("POST", "/v1/jobs/search", {
        rawQueryString: "query=must-not-enter-url-telemetry",
        body: payload,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    );
    expect(queryBearing.statusCode).toBe(400);
    expect(inject).toHaveBeenCalledOnce();

    const missingBody = await invoke(handler, routedEvent("POST", "/v1/jobs/search"));
    expect(missingBody.statusCode).toBe(400);
    const wrongMedia = await invoke(
      handler,
      routedEvent("POST", "/v1/jobs/search", {
        body: payload,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "text/plain",
        },
      }),
    );
    expect(wrongMedia.statusCode).toBe(415);
    const oversized = await invoke(
      handler,
      routedEvent("POST", "/v1/jobs/search", {
        body: "x".repeat(64 * 1024 + 1),
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    );
    expect(oversized.statusCode).toBe(413);
    const wrongPath = await invoke(handler, routedEvent("POST", "/v1/jobs/search/"));
    expect(wrongPath.statusCode).toBe(404);
    expect(inject).toHaveBeenCalledOnce();
  });

  it("allows only the exact saved-job create, list, and delete route shapes", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 204,
      body: "",
      headers: { "cache-control": "no-store" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const payload = JSON.stringify({ pageSize: 20 });
    for (const path of ["/v1/saved-jobs", "/v1/saved-jobs/search"]) {
      const response = await invoke(
        handler,
        routedEvent("POST", path, {
          body: payload,
          headers: {
            authorization: "Bearer opaque-api-gateway-token",
            "content-type": "application/json",
          },
        }),
      );
      expect(response.statusCode).toBe(204);
    }
    const savedPath = "/v1/saved-jobs/018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
    expect((await invoke(handler, routedEvent("DELETE", savedPath))).statusCode).toBe(204);
    expect((await invoke(handler, routedEvent("GET", savedPath))).statusCode).toBe(404);
    expect((await invoke(handler, routedEvent("DELETE", `${savedPath}/`))).statusCode).toBe(404);
    expect(inject).toHaveBeenCalledTimes(3);
  });

  it("allows only exact candidate-rights routes and preserves the private proof header", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 202,
      body: "{}",
      headers: { "cache-control": "no-store", "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const resourceId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
    const proof = "proof-header-segment.proof-payload-segment.proof-signature-segment";
    const bodyOptions = {
      body: "{}",
      headers: {
        authorization: "Bearer opaque-api-gateway-token",
        "content-type": "application/json",
        "x-ai-job-apply-reauthentication": proof,
      },
    };

    for (const [method, path, options] of [
      ["POST", "/v1/me/data-exports", bodyOptions],
      ["GET", `/v1/me/data-exports/${resourceId}`, undefined],
      ["POST", "/v1/me/account-deletion-requests", bodyOptions],
      ["GET", `/v1/me/account-deletion-requests/${resourceId}`, undefined],
      ["DELETE", `/v1/me/account-deletion-requests/${resourceId}`, undefined],
      ["POST", `/v1/me/account-deletion-requests/${resourceId}/confirm`, bodyOptions],
    ] as const) {
      const response = await invoke(handler, routedEvent(method, path, options));
      expect(response.statusCode).toBe(202);
    }

    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/me/data-exports",
        headers: expect.objectContaining({ "x-ai-job-apply-reauthentication": proof }),
      }),
    );
    for (const [method, path] of [
      ["GET", `/v1/me/data-exports/${resourceId.toUpperCase()}`],
      ["GET", "/v1/me/data-exports/018f92b0-4ad7-4b1d-8f44-b7ae694c85c1"],
      ["DELETE", `/v1/me/account-deletion-requests/${resourceId}/`],
      ["GET", `/v1/me/account-deletion-requests/${resourceId}/confirm`],
    ] as const) {
      expect((await invoke(handler, routedEvent(method, path))).statusCode).toBe(404);
    }
  });

  it("allows only exact candidate-report and admin-moderation route shapes", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn(async () => ({ statusCode: 200, body: "{}", headers: {} }));
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const jobId = "019d04cf-1f80-7000-8000-000000000012";
    const caseId = "019d04cf-1f80-7000-8000-000000000013";
    const bodyOptions = {
      body: "{}",
      headers: {
        authorization: "Bearer opaque-api-gateway-token",
        "content-type": "application/json",
      },
    };
    for (const path of [
      `/v1/jobs/${jobId}/reports`,
      "/v1/admin/moderation/cases",
      "/v1/admin/moderation/cases/search",
      `/v1/admin/moderation/cases/${caseId}/resolve`,
    ]) {
      expect((await invoke(handler, routedEvent("POST", path, bodyOptions))).statusCode).toBe(200);
    }
    expect(
      (
        await invoke(
          handler,
          routedEvent("GET", `/v1/admin/moderation/jobs/${jobId}/report-summary`),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await invoke(
          handler,
          routedEvent("POST", `/v1/jobs/${jobId.toUpperCase()}/reports`, bodyOptions),
        )
      ).statusCode,
    ).toBe(404);
    expect(inject).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["POST", "/v1/profile/facts"],
    ["PATCH", "/v1/profile/facts/018f92b0-4ad7-7b1d-8f44-b7ae694c85c1"],
  ])("allows the protected profile-fact %s boundary", async (method, path) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"version":1}',
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const payload = JSON.stringify({ synthetic: true });

    const response = await invoke(
      handler,
      routedEvent(method, path, {
        body: payload,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({ method, url: path, payload }));
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
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      type: "urn:ai-job-apply:problem:authentication_required",
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
      traceId: "request-id-0001",
    });
    expect(response.headers).toMatchObject({ "cache-control": "no-store" });
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

  it.each([
    ["a scalar", AUDIENCE],
    ["an array", [AUDIENCE, "https://identity.example.test/userinfo"]],
    ["a JSON-encoded array", JSON.stringify([AUDIENCE, "https://identity.example.test/userinfo"])],
  ])("accepts %s exact audience representation", async (_label, aud) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}", headers: {} });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event();
    Object.assign(input.requestContext.authorizer?.jwt?.claims ?? {}, { aud });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledOnce();
  });

  it("recovers an exact multi-valued audience from the API Gateway-validated bearer token", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    let observedPrincipal: AuthPrincipal | undefined;
    const inject = vi.fn(async (request: { headers: Record<string, string> }) => {
      const accessToken = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      observedPrincipal = await principalBridge.verifier.verify(accessToken);
      return { statusCode: 200, body: "{}", headers: {} };
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event({
      headers: {
        authorization: `Bearer ${bearerToken({
          iss: ISSUER,
          sub: "auth0|candidate-1",
          aud: [AUDIENCE, "https://identity.example.test/userinfo"],
        })}`,
      },
    });
    Object.assign(input.requestContext.authorizer?.jwt?.claims ?? {}, {
      aud: `${AUDIENCE},https://identity.example.test/userinfo`,
    });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(200);
    expect(observedPrincipal?.audience).toEqual([
      AUDIENCE,
      "https://identity.example.test/userinfo",
    ]);
    expect(inject).toHaveBeenCalledOnce();
  });

  it.each([
    ["a malformed token", "not-a-jwt"],
    [
      "a different token issuer",
      bearerToken({
        iss: "https://attacker.example/",
        sub: "auth0|candidate-1",
        aud: [AUDIENCE],
      }),
    ],
    [
      "a different token subject",
      bearerToken({
        iss: ISSUER,
        sub: "auth0|candidate-2",
        aud: [AUDIENCE],
      }),
    ],
    [
      "a different token audience",
      bearerToken({
        iss: ISSUER,
        sub: "auth0|candidate-1",
        aud: ["different-api"],
      }),
    ],
  ])("rejects a flattened audience backed by %s", async (_label, token) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event({ headers: { authorization: `Bearer ${token}` } });
    Object.assign(input.requestContext.authorizer?.jwt?.claims ?? {}, {
      aud: `${AUDIENCE},https://identity.example.test/userinfo`,
    });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(401);
    expect(inject).not.toHaveBeenCalled();
  });

  it("emits only privacy-safe claim-shape diagnostics when identity context is rejected", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const onAuthenticationFailure = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject: vi.fn() }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
      onAuthenticationFailure,
    });
    const input = event();
    Object.assign(input.requestContext.authorizer?.jwt?.claims ?? {}, {
      aud: JSON.stringify(["different-api"]),
    });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(401);
    expect(onAuthenticationFailure).toHaveBeenCalledWith({
      claimsPresent: true,
      subjectPresent: true,
      issuerMatches: true,
      audienceMatches: false,
      audienceEncoding: "json_array",
    });
    expect(JSON.stringify(onAuthenticationFailure.mock.calls)).not.toContain("auth0|candidate-1");
    expect(JSON.stringify(onAuthenticationFailure.mock.calls)).not.toContain("different-api");
  });

  it("does not treat an unvalidated scope claim as an API Gateway-validated scope", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    let observedPrincipal: AuthPrincipal | undefined;
    const inject = vi.fn(async (request: { headers: Record<string, string> }) => {
      const accessToken = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      observedPrincipal = await principalBridge.verifier.verify(accessToken);
      return { statusCode: 200, body: "{}", headers: {} };
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = event();
    const jwt = input.requestContext.authorizer?.jwt;
    if (!jwt) {
      throw new Error("Test authorizer context is missing");
    }
    jwt.claims = { ...jwt.claims, scope: "profile:read profile:write" };
    jwt.scopes = [];

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(200);
    expect(observedPrincipal?.scopes).toEqual([]);
  });

  it.each([
    ["unknown route", "GET", "/v1/admin"],
    ["unknown method", "POST", "/v1/me"],
    ["method on a public path", "PUT", "/health/live"],
    ["malformed operation identifier", "GET", "/v1/operations/not-a-uuid"],
    ["malformed job identifier", "GET", "/v1/jobs/not-a-uuid"],
    ["malformed profile fact identifier", "PATCH", "/v1/profile/facts/not-a-uuid"],
    ["default-dark contribution intake", "POST", "/v1/jobs/contributions"],
    ["default-dark contribution consent grant", "POST", "/v1/profile/ugc-contribution-consents"],
    [
      "default-dark contribution consent revoke",
      "POST",
      "/v1/profile/ugc-contribution-consents/019c0000-0000-7000-8000-000000000010/revoke",
    ],
    [
      "default-dark contribution status",
      "GET",
      "/v1/jobs/contributions/019c0000-0000-7000-8000-000000000010",
    ],
    ["default-dark private capture create", "POST", "/v1/saved-job-captures"],
    [
      "default-dark private capture read",
      "GET",
      "/v1/saved-job-captures/019c0000-0000-7000-8000-000000000010",
    ],
    [
      "default-dark private capture delete",
      "DELETE",
      "/v1/saved-job-captures/019c0000-0000-7000-8000-000000000010",
    ],
  ])("rejects %s before authentication or application dispatch", async (_label, method, path) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });

    const response = await invoke(handler, routedEvent(method, path));

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? "{}").code).toBe("not_found");
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([
    ["query parameters", routedEvent("GET", "/v1/me", { rawQueryString: "source=web" }), 400],
    ["a GET body", routedEvent("GET", "/v1/me", { body: "{}" }), 400],
    ["a missing PUT body", routedEvent("PUT", "/v1/me/job-preferences"), 400],
    [
      "a non-JSON PUT body",
      routedEvent("PUT", "/v1/me/job-preferences", {
        body: "targetRoles=Engineer",
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/x-www-form-urlencoded",
        },
      }),
      415,
    ],
    [
      "malformed base64",
      routedEvent("PUT", "/v1/me/job-preferences", {
        body: "not-valid-base64***",
        isBase64Encoded: true,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
      400,
    ],
    [
      "an oversized plain body",
      routedEvent("PUT", "/v1/me/job-preferences", {
        body: "x".repeat(64 * 1024 + 1),
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json; charset=utf-8",
        },
      }),
      413,
    ],
    [
      "an oversized encoded body",
      routedEvent("PUT", "/v1/me/job-preferences", {
        body: Buffer.alloc(64 * 1024 + 1).toString("base64"),
        isBase64Encoded: true,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
      413,
    ],
  ])("rejects %s at the transport boundary", async (_label, input, status) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(status);
    expect(response.headers).toMatchObject({ "cache-control": "no-store" });
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
        body: Buffer.from(payload).toString("base64"),
        isBase64Encoded: true,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
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
        url: "/v1/me/job-preferences",
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
