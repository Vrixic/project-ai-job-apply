import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
  loadD2LambdaComposition,
} from "./lambda.js";

const ISSUER = "https://identity.example.test/";
const AUDIENCE = "ai-job-apply-api";

describe("development contribution Lambda composition", () => {
  const values = () => ({
    D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
    D2_DEPLOYMENT_ENVIRONMENT: "development",
    D2_CONTRIBUTION_ROUTES_ENABLED: "true",
    D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: "true",
    UGC_CONTRIBUTION_POLICY_VERSION: "d2-synthetic-ugc.v1",
    D2_TRUST_REVIEWER_ASSIGNMENTS_JSON: JSON.stringify([
      {
        issuer: ISSUER,
        subject: "synthetic|reviewer",
        roles: ["case_opener"],
        verifiedRequesterTakedown: false,
      },
    ]),
    D2_TRUST_EVIDENCE_ALLOWLIST_JSON: "[]",
    D2_TRUST_POLICY_VERSION: "d2-synthetic-trust.v1",
    D2_TRUST_APPEAL_WINDOW_MILLISECONDS: "1000",
    D2_TRUST_SYSTEM_ACTOR_ID: "019d04cf-1f80-7000-8000-000000000099",
  });
  const config = { OIDC_ISSUER: ISSUER } as Parameters<typeof loadD2LambdaComposition>[0];
  it("enables authenticated intake but does not fabricate a public signed envelope", () => {
    const composition = loadD2LambdaComposition(config, values());
    expect(composition.routes).toMatchObject({
      candidateContribution: true,
      contributionPolicy: false,
      privateCapture: false,
      trustReviewer: false,
    });
    expect(composition.contributionCapability).toHaveProperty("mode", "development");
    expect(composition).not.toHaveProperty("contributionCapabilityPolicy");
  });
  it("ignores stale signed settings and keeps the retained anonymous projection disabled", () => {
    const composition = loadD2LambdaComposition(config, {
      ...values(),
      JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: '{"stale":true}',
      JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON: '{"retired-key":"retired"}',
    });
    expect(composition.configuration).toMatchObject({
      valid: true,
      signedContributionPolicyConfigured: false,
    });
    expect(composition.routes).toMatchObject({
      candidateContribution: true,
      contributionPolicy: false,
    });
    expect(composition).not.toHaveProperty("contributionCapabilityPolicy");
  });
  it("fails closed outside development, without Trust, or when route activation is off", () => {
    for (const change of [
      { D2_DEPLOYMENT_ENVIRONMENT: "production" },
      { D2_TRUST_POLICY_VERSION: undefined },
      { D2_CONTRIBUTION_ROUTES_ENABLED: "false" },
    ]) {
      expect(
        loadD2LambdaComposition(config, { ...values(), ...change }).routes.candidateContribution,
      ).toBe(false);
    }
    expect(
      loadD2LambdaComposition({ ...config, OIDC_ISSUER: "https://other.example.test/" }, values())
        .routes.candidateContribution,
    ).toBe(false);
  });
});

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
  it("keeps the public contribution capability policy route dark by default", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const input = routedEvent("GET", "/v1/extension/contribution-capability-policy", {
      headers: {},
    });
    delete input.requestContext.authorizer;

    const response = await invoke(handler, input);

    expect(response.statusCode).toBe(404);
    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([
    ["private capture create", "POST", "/v1/saved-job-captures"],
    ["private capture read", "GET", "/v1/saved-job-captures/019d04cf-1f80-7000-8000-000000000010"],
    ["contribution create", "POST", "/v1/jobs/contributions"],
    ["contribution history", "GET", "/v1/jobs/contributions"],
    ["contribution status", "GET", "/v1/jobs/contributions/019d04cf-1f80-7000-8000-000000000010"],
    ["owner Trust read", "GET", "/v1/trust/contributions/019d04cf-1f80-7000-8000-000000000010"],
    ["reviewer Trust open", "POST", "/v1/admin/trust/cases"],
    ["reviewer Trust queue", "GET", "/v1/admin/trust/cases"],
    [
      "reviewer Trust evidence",
      "GET",
      "/v1/admin/trust/cases/019d04cf-1f80-8000-8000-000000000010/evidence",
    ],
    ["reviewer Trust read", "GET", "/v1/admin/trust/cases/019d04cf-1f80-8000-8000-000000000010"],
  ])(
    "keeps %s dark by default before authentication or application dispatch",
    async (_label, method, path) => {
      const principalBridge = createInvocationPrincipalBridge();
      const inject = vi.fn();
      const handler = createApiGatewayHandler({
        app: Promise.resolve({ inject }),
        issuer: ISSUER,
        audience: AUDIENCE,
        principalBridge,
      });
      const input = routedEvent(method, path, {
        ...(method === "POST" ? { body: "{}" } : {}),
        headers: method === "POST" ? { "content-type": "application/json" } : {},
      });
      delete input.requestContext.authorizer;

      const response = await invoke(handler, input);

      expect(response.statusCode).toBe(404);
      expect(inject).not.toHaveBeenCalled();
    },
  );

  it("requires exact authenticated queryless and bodyless history routing", async () => {
    const inject = vi
      .fn()
      .mockResolvedValue({ statusCode: 200, body: '{"items":[]}', headers: {} });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge: createInvocationPrincipalBridge(),
      d2Routes: { candidateContribution: true },
    });
    const exact = () =>
      routedEvent("GET", "/v1/jobs/contributions", {
        headers: { authorization: "Bearer opaque-api-gateway-token" },
      });
    expect((await invoke(handler, exact())).statusCode).toBe(200);
    expect(inject).toHaveBeenCalledOnce();
    inject.mockClear();
    const fallback = exact();
    fallback.routeKey = "$default";
    fallback.requestContext.routeKey = "$default";
    const mismatch = exact();
    mismatch.requestContext.routeKey = "POST /v1/jobs/contributions";
    const unauthenticated = exact();
    delete unauthenticated.requestContext.authorizer;
    for (const input of [fallback, mismatch]) {
      expect((await invoke(handler, input)).statusCode).toBe(404);
    }
    expect((await invoke(handler, unauthenticated)).statusCode).toBe(401);
    for (const input of [
      { ...exact(), rawQueryString: "ownerUserId=private" },
      { ...exact(), rawQueryString: "cursor=anything" },
      { ...exact(), body: "{}" },
      { ...exact(), body: "e30=", isBase64Encoded: true },
    ]) {
      expect((await invoke(handler, input)).statusCode).toBe(400);
    }
    expect(inject).not.toHaveBeenCalled();
  });

  it("keeps private capture independent from every contribution and Trust route gate", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}", headers: {} });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
      d2Routes: { privateCapture: true },
    });
    const captureId = "019d04cf-1f80-7000-8000-000000000010";
    const privateRead = routedEvent("GET", `/v1/saved-job-captures/${captureId}`);
    privateRead.routeKey = "GET /v1/saved-job-captures/{captureId}";
    privateRead.requestContext.routeKey = privateRead.routeKey;
    const contribution = routedEvent("POST", "/v1/jobs/contributions", {
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect((await invoke(handler, privateRead)).statusCode).toBe(200);
    expect((await invoke(handler, contribution)).statusCode).toBe(404);
    expect(inject).toHaveBeenCalledOnce();
  });

  it("allows bounded reviewer queue queries only on the exact enabled queue route", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}", headers: {} });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
      d2Routes: { trustReviewer: true },
    });
    const queued = routedEvent("GET", "/v1/admin/trust/cases", {
      rawQueryString: "state=needs_review&pageSize=25",
    });
    expect((await invoke(handler, queued)).statusCode).toBe(200);
    expect(inject).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "/v1/admin/trust/cases?state=needs_review&pageSize=25" }),
    );
    for (const query of [
      "query=private",
      "state=accepted",
      "pageSize=26",
      "pageSize=01",
      "state=needs_review&state=appeal_pending",
      `cursor=${"a".repeat(401)}`,
    ])
      expect(
        (
          await invoke(
            handler,
            routedEvent("GET", "/v1/admin/trust/cases", { rawQueryString: query }),
          )
        ).statusCode,
      ).toBe(400);
    const evidence = routedEvent(
      "GET",
      "/v1/admin/trust/cases/019d04cf-1f80-8000-8000-000000000010/evidence",
    );
    evidence.routeKey = "GET /v1/admin/trust/cases/{caseId}/evidence";
    evidence.requestContext.routeKey = evidence.routeKey;
    expect((await invoke(handler, evidence)).statusCode).toBe(200);
    expect((await invoke(handler, { ...evidence, rawQueryString: "pageSize=25" })).statusCode).toBe(
      400,
    );
    const fallback = {
      ...evidence,
      routeKey: "$default",
      requestContext: { ...evidence.requestContext, routeKey: "$default" },
    };
    expect((await invoke(handler, fallback)).statusCode).toBe(404);
    expect(inject).toHaveBeenCalledTimes(2);
  });

  it("allows only the exact anonymous capability-policy route key when its gate is enabled", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}", headers: {} });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
      d2Routes: { contributionPolicy: true },
    });
    const path = "/v1/extension/contribution-capability-policy";
    const exact = routedEvent("GET", path, { headers: {} });
    delete exact.requestContext.authorizer;
    const fallback = routedEvent("GET", path, { headers: {}, routeKey: "$default" });
    fallback.requestContext.routeKey = "$default";
    delete fallback.requestContext.authorizer;
    const mismatchedContext = routedEvent("GET", path, { headers: {} });
    mismatchedContext.requestContext.routeKey = "$default";
    delete mismatchedContext.requestContext.authorizer;

    expect((await invoke(handler, exact)).statusCode).toBe(200);
    expect((await invoke(handler, fallback)).statusCode).toBe(404);
    expect((await invoke(handler, mismatchedContext)).statusCode).toBe(404);
    expect(inject).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "candidate contribution",
      { candidateContribution: true },
      "POST",
      "/v1/jobs/contributions",
      "POST /v1/jobs/contributions",
    ],
    [
      "candidate contribution cancellation",
      { candidateContribution: true },
      "POST",
      "/v1/jobs/contributions/019d04cf-1f80-7000-8000-000000000010/cancel",
      "POST /v1/jobs/contributions/{contributionId}/cancel",
    ],
    [
      "candidate owner Trust appeal",
      { candidateContribution: true },
      "POST",
      "/v1/trust/contributions/019d04cf-1f80-7000-8000-000000000010/appeals",
      "POST /v1/trust/contributions/{contributionId}/appeals",
    ],
    [
      "reviewer Trust decision",
      { trustReviewer: true },
      "POST",
      "/v1/admin/trust/cases/019d04cf-1f80-8000-8000-000000000010/decision",
      "POST /v1/admin/trust/cases/{caseId}/decision",
    ],
  ])(
    "requires the exact templated route key for %s",
    async (_label, d2Routes, method, path, routeKey) => {
      const principalBridge = createInvocationPrincipalBridge();
      const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}", headers: {} });
      const handler = createApiGatewayHandler({
        app: Promise.resolve({ inject }),
        issuer: ISSUER,
        audience: AUDIENCE,
        principalBridge,
        d2Routes,
      });
      const exact = routedEvent(method, path, {
        body: "{}",
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      });
      exact.routeKey = routeKey;
      exact.requestContext.routeKey = routeKey;
      const fallback = routedEvent(method, path, {
        body: "{}",
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
        routeKey: "$default",
      });
      fallback.requestContext.routeKey = "$default";

      expect((await invoke(handler, exact)).statusCode).toBe(200);
      expect((await invoke(handler, fallback)).statusCode).toBe(404);
      expect(inject).toHaveBeenCalledOnce();
    },
  );

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

  it("allows bodyless authenticated billing sessions and one public signed Stripe webhook", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });

    for (const path of [
      "/v1/billing/checkout-sessions",
      "/v1/billing/portal-sessions",
      "/v1/billing/subscription-syncs",
    ]) {
      const accepted = await invoke(handler, routedEvent("POST", path));
      const withBody = await invoke(
        handler,
        routedEvent("POST", path, {
          body: "{}",
          headers: {
            authorization: "Bearer opaque-api-gateway-token",
            "content-type": "application/json",
          },
        }),
      );
      const unauthenticated = routedEvent("POST", path);
      delete unauthenticated.requestContext.authorizer;
      const anonymous = await invoke(handler, unauthenticated);
      const get = await invoke(handler, routedEvent("GET", path));
      expect(accepted.statusCode).toBe(200);
      expect(withBody.statusCode).toBe(400);
      expect(anonymous.statusCode).toBe(401);
      expect(get.statusCode).toBe(404);
    }
    expect(inject).toHaveBeenCalledTimes(3);

    inject.mockClear();
    const webhookPath = "/v1/billing/webhooks/stripe";
    const signed = routedEvent("POST", webhookPath, {
      body: '{"id":"evt_00000001"}',
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=ab" },
    });
    delete signed.requestContext.authorizer;
    const webhook = await invoke(handler, signed);
    expect(webhook.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: webhookPath,
        payload: '{"id":"evt_00000001"}',
        headers: expect.objectContaining({ "stripe-signature": "t=1,v1=ab" }),
      }),
    );
    const getWebhook = await invoke(handler, routedEvent("GET", webhookPath));
    const trailing = await invoke(handler, routedEvent("POST", `${webhookPath}/`));
    expect(getWebhook.statusCode).toBe(404);
    expect(trailing.statusCode).toBe(404);
  });

  it("allows the notifications inbox routes with a bounded query only on the list (D5-001)", async () => {
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge: createInvocationPrincipalBridge(),
    });
    const id = "019d04cf-1f80-7000-8000-00000000a111";
    const status = async (method: string, path: string, extra: Record<string, unknown> = {}) =>
      (await invoke(handler, routedEvent(method, path, extra as never))).statusCode;

    expect(await status("GET", "/v1/notifications")).toBe(200);
    expect(
      await status("GET", "/v1/notifications", {
        rawQueryString: "state=open&limit=25&cursor=abc_DEF-1",
      }),
    ).toBe(200);
    for (const bad of [
      "state=all",
      "limit=0",
      "limit=101",
      "cursor=a%20b",
      "owner=other",
      "state=open&state=unread",
    ])
      expect(await status("GET", "/v1/notifications", { rawQueryString: bad })).toBe(400);
    expect(await status("GET", "/v1/notifications/preferences")).toBe(200);
    expect(
      await status("GET", "/v1/notifications/preferences", { rawQueryString: "state=open" }),
    ).toBe(400);
    expect(
      await status("PUT", "/v1/notifications/preferences", {
        body: "{}",
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    ).toBe(200);
    expect(await status("PUT", "/v1/notifications/preferences")).toBe(400);
    for (const command of ["acknowledgement", "dismissal"]) {
      expect(await status("POST", `/v1/notifications/${id}/${command}`)).toBe(200);
      expect(
        await status("POST", `/v1/notifications/${id}/${command}`, {
          body: "{}",
          headers: {
            authorization: "Bearer opaque-api-gateway-token",
            "content-type": "application/json",
          },
        }),
      ).toBe(400);
      expect(await status("GET", `/v1/notifications/${id}/${command}`)).toBe(404);
      expect(await status("POST", `/v1/notifications/not-a-uuid/${command}`)).toBe(404);
      expect(await status("POST", `/v1/notifications/${id}/${command}/`)).toBe(404);
    }
    expect(await status("DELETE", `/v1/notifications/${id}`)).toBe(404);
    expect(await status("POST", "/v1/notifications")).toBe(404);
    const anonymous = routedEvent("GET", "/v1/notifications");
    delete anonymous.requestContext.authorizer;
    expect((await invoke(handler, anonymous)).statusCode).toBe(401);
  });

  it("allows the notification delivery routes, with bodies only where they are written (D5-002)", async () => {
    const inject = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge: createInvocationPrincipalBridge(),
    });
    const id = "019d04cf-1f80-7000-8000-00000000a111";
    const json = {
      body: "{}",
      headers: {
        authorization: "Bearer opaque-api-gateway-token",
        "content-type": "application/json",
      },
    };
    const status = async (method: string, path: string, extra: Record<string, unknown> = {}) =>
      (await invoke(handler, routedEvent(method, path, extra as never))).statusCode;

    expect(await status("GET", "/v1/notifications/delivery")).toBe(200);
    expect(await status("GET", "/v1/notifications/delivery", { rawQueryString: "x=1" })).toBe(400);
    expect(await status("PUT", "/v1/notifications/delivery/email", json)).toBe(200);
    expect(await status("PUT", "/v1/notifications/delivery/email")).toBe(400);
    expect(await status("DELETE", "/v1/notifications/delivery/email")).toBe(200);
    expect(await status("DELETE", "/v1/notifications/delivery/email", json)).toBe(400);
    expect(await status("POST", "/v1/notifications/delivery/email/confirmation", json)).toBe(200);
    expect(await status("POST", "/v1/notifications/delivery/push-subscriptions", json)).toBe(200);
    expect(await status("DELETE", `/v1/notifications/delivery/push-subscriptions/${id}`)).toBe(200);
    expect(
      await status("DELETE", `/v1/notifications/delivery/push-subscriptions/${id}`, json),
    ).toBe(400);
    for (const [method, path] of [
      ["DELETE", "/v1/notifications/delivery/push-subscriptions/not-a-uuid"],
      ["DELETE", `/v1/notifications/delivery/push-subscriptions/${id}/`],
      ["DELETE", "/v1/notifications/delivery/push-subscriptions"],
      ["GET", `/v1/notifications/delivery/push-subscriptions/${id}`],
      ["PATCH", "/v1/notifications/delivery/email"],
      ["POST", "/v1/notifications/delivery"],
      ["GET", "/v1/notifications/delivery/email"],
      ["GET", "/v1/notifications/delivery/email/confirmation"],
    ] as const)
      expect(await status(method, path)).toBe(404);
    const anonymous = routedEvent("GET", "/v1/notifications/delivery");
    delete anonymous.requestContext.authorizer;
    expect((await invoke(handler, anonymous)).statusCode).toBe(401);
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

  it("allows only the exact resume delete route shape", async () => {
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
    const resumePath = "/v1/resumes/018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
    expect((await invoke(handler, routedEvent("DELETE", resumePath))).statusCode).toBe(204);
    for (const [method, path] of [
      ["GET", resumePath],
      ["PUT", resumePath],
      ["PATCH", resumePath],
      ["DELETE", "/v1/resumes"],
      ["DELETE", `${resumePath}/`],
      ["DELETE", `${resumePath}/source`],
      ["DELETE", "/v1/resumes/6f9619ff-8b86-4011-b42d-00c04fc964ff"],
      ["DELETE", "/v1/resumes/not-a-uuid"],
    ] as const) {
      expect(
        (await invoke(handler, routedEvent(method, path))).statusCode,
        `${method} ${path}`,
      ).toBe(404);
    }
    expect(inject).toHaveBeenCalledTimes(1);
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

  it.each([])("allows the protected profile-fact %s boundary", async (method, path) => {
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

  it.each([
    ["GET", "/v1/profile/restricted-answers"],
    ["PUT", "/v1/profile/restricted-answers/authorization.us_authorized"],
    ["DELETE", "/v1/profile/restricted-answers/authorization.us_authorized"],
  ])("allows the protected restricted-answer %s boundary", async (method, path) => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn().mockResolvedValue({
      statusCode: method === "DELETE" ? 204 : 200,
      body: method === "DELETE" ? "" : '{"version":1}',
      headers: { "content-type": "application/json" },
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const payload = method === "PUT" ? JSON.stringify({ synthetic: true }) : undefined;

    const response = await invoke(
      handler,
      routedEvent(method, path, {
        ...(payload ? { body: payload } : {}),
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          ...(payload ? { "content-type": "application/json" } : {}),
        },
      }),
    );

    expect(response.statusCode).toBe(method === "DELETE" ? 204 : 200);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ method, url: path, ...(payload ? { payload } : {}) }),
    );
  });

  it("allows the restricted-answer context query on PUT and DELETE, forwarding it to the app", async () => {
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
    const path = "/v1/profile/restricted-answers/authorization.sponsorship_required";
    const payload = JSON.stringify({ synthetic: true });

    const response = await invoke(
      handler,
      routedEvent("PUT", path, {
        rawQueryString: "context=us",
        body: payload,
        headers: {
          authorization: "Bearer opaque-api-gateway-token",
          "content-type": "application/json",
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", url: `${path}?context=us`, payload }),
    );
  });

  it("rejects any restricted-answer query key other than context", async () => {
    const principalBridge = createInvocationPrincipalBridge();
    const inject = vi.fn();
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge,
    });
    const response = await invoke(
      handler,
      routedEvent("DELETE", "/v1/profile/restricted-answers/authorization.us_authorized", {
        rawQueryString: "other=1",
        headers: { authorization: "Bearer opaque-api-gateway-token" },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(inject).not.toHaveBeenCalled();
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
    ["default-dark contribution intake", "POST", "/v1/jobs/contributions"],
    [
      "default-dark contribution cancellation",
      "POST",
      "/v1/jobs/contributions/019c0000-0000-7000-8000-000000000010/cancel",
    ],
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

describe("Applications routes at the Lambda boundary", () => {
  const id = "019d04cf-1f80-7000-8000-000000000101";
  const attempt = "019d04cf-1f80-7000-8000-000000000102";
  const json = { "content-type": "application/json", authorization: "Bearer opaque" };
  const invocation = (method: string, path: string, extra: Partial<AuthorizedHttpApiEvent> = {}) =>
    routedEvent(method, path, { headers: json, ...extra });
  const dispatcher = () => {
    const inject = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge: createInvocationPrincipalBridge(),
    });
    return { inject, handler };
  };

  it.each([
    ["POST", "/v1/applications", "{}"],
    ["POST", "/v1/applications/search", "{}"],
    ["PUT", `/v1/material-withdrawals/${id}`, undefined],
    ["GET", `/v1/material-withdrawals/${id}`, undefined],
    ["GET", `/v1/applications/${id}`, undefined],
    ["GET", `/v1/applications/${id}/history`, undefined],
    ["GET", `/v1/applications/${id}/resume`, undefined],
    ["POST", `/v1/applications/${id}/packets`, "{}"],
    ["POST", `/v1/applications/${id}/approval`, "{}"],
    ["POST", `/v1/applications/${id}/reopen`, "{}"],
    ["POST", `/v1/applications/${id}/cancel`, "{}"],
    ["POST", `/v1/applications/${id}/submissions`, "{}"],
    ["POST", `/v1/applications/${id}/manual-submissions`, "{}"],
    ["POST", `/v1/applications/${id}/attempts/${attempt}/dispatch`, undefined],
    ["POST", `/v1/applications/${id}/attempts/${attempt}/result`, "{}"],
    ["POST", `/v1/applications/${id}/attempts/${attempt}/reconciliation`, "{}"],
  ])("forwards %s %s to the gateway after authentication", async (method, path, body) => {
    const { inject, handler } = dispatcher();
    const response = await invoke(
      handler,
      invocation(method as string, path as string, body === undefined ? {} : { body }),
    );
    expect(response.statusCode).toBe(200);
    expect(inject).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong method", "GET", "/v1/applications"],
    ["withdrawal wrong method", "POST", `/v1/material-withdrawals/${id}`],
    ["withdrawal invalid id", "PUT", "/v1/material-withdrawals/not-an-id"],
    ["non-v7 identifier", "GET", "/v1/applications/00000000-0000-1000-8000-000000000001"],
    ["traversal", "GET", `/v1/applications/${id}/../me`],
    ["unknown suffix", "POST", `/v1/applications/${id}/delete`],
    ["dispatch with a bad attempt id", "POST", `/v1/applications/${id}/attempts/nope/dispatch`],
    ["delete", "DELETE", `/v1/applications/${id}`],
    ["resume as a command", "POST", `/v1/applications/${id}/resume`],
    ["resume file with an extra segment", "GET", `/v1/applications/${id}/resume/file/extra`],
  ])("does not route %s", async (_label, method, path) => {
    const { inject, handler } = dispatcher();
    const response = await invoke(handler, invocation(method as string, path as string));
    expect(response.statusCode).toBe(404);
    expect(inject).not.toHaveBeenCalled();
  });

  it("requires a body on commands and refuses one on reads and dispatch", async () => {
    const { inject, handler } = dispatcher();
    expect(
      (await invoke(handler, invocation("PUT", `/v1/material-withdrawals/${id}`, { body: "{}" })))
        .statusCode,
    ).toBe(400);
    expect(
      (await invoke(handler, invocation("POST", `/v1/applications/${id}/cancel`))).statusCode,
    ).toBe(400);
    expect(
      (await invoke(handler, invocation("GET", `/v1/applications/${id}`, { body: "{}" })))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await invoke(
          handler,
          invocation("POST", `/v1/applications/${id}/attempts/${attempt}/dispatch`, { body: "{}" }),
        )
      ).statusCode,
    ).toBe(400);
    expect(inject).not.toHaveBeenCalled();
  });

  it("accepts only bounded unique afterSeq and limit on the history route", async () => {
    const path = `/v1/applications/${id}/history`;
    for (const [query, status] of [
      ["afterSeq=3&limit=50", 200],
      ["limit=200", 200],
      ["limit=201", 400],
      ["limit=0", 400],
      ["afterSeq=1&afterSeq=2", 400],
      ["afterSeq=abc", 400],
      ["owner=other", 400],
      ["afterSeq=1234567890", 400],
    ] as const) {
      const { handler } = dispatcher();
      const response = await invoke(handler, invocation("GET", path, { rawQueryString: query }));
      expect(response.statusCode, query).toBe(status);
    }
    // The application detail route does not accept a query string.
    const { handler } = dispatcher();
    expect(
      (
        await invoke(
          handler,
          invocation("GET", `/v1/applications/${id}`, { rawQueryString: "limit=5" }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it("routes every Applications operation the OpenAPI contract declares", async () => {
    const contract = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../../packages/api-contracts/openapi/platform.v1.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { paths: Record<string, Record<string, unknown>> };
    const declared: Array<[string, string]> = [];
    for (const [template, operations] of Object.entries(contract.paths)) {
      if (!template.startsWith("/applications")) continue;
      for (const method of Object.keys(operations)) {
        declared.push([method.toUpperCase(), `/v1${template}`]);
      }
    }
    expect(declared.length).toBeGreaterThan(10);
    for (const [method, template] of declared) {
      const path = template
        .replace("{applicationId}", id)
        .replace("{attemptId}", attempt)
        .replace("{preparationId}", attempt);
      const { handler } = dispatcher();
      const query =
        path.endsWith("/authorization") || path.endsWith("/location")
          ? `generationId=${attempt}`
          : path.endsWith("/file")
            ? "format=pdf"
            : "";
      const commandBody = method === "POST" && !path.endsWith("/dispatch") ? "{}" : undefined;
      const response = await invoke(
        handler,
        invocation(method, path, {
          ...(commandBody === undefined ? {} : { body: commandBody }),
          ...(query ? { rawQueryString: query } : {}),
        }),
      );
      expect(response.statusCode, `${method} ${template}`).toBe(200);
    }
  });

  it.each([
    ["missing", ""],
    ["empty", "generationId="],
    ["malformed", "generationId=nope"],
    ["non-v7", "generationId=00000000-0000-1000-8000-000000000001"],
    ["repeated", `generationId=${attempt}&generationId=${attempt}`],
    ["owner override", `generationId=${attempt}&ownerUserId=${id}`],
    ["oversized", `generationId=${"a".repeat(300)}`],
  ])("refuses %s material authorization queries before dispatch", async (_label, query) => {
    for (const kind of ["cover-letter", "resume"]) {
      const { handler, inject } = dispatcher();
      const response = await invoke(
        handler,
        invocation("GET", `/v1/applications/${id}/${kind}/authorization`, {
          rawQueryString: query,
        }),
      );
      expect(response.statusCode).toBe(400);
      expect(inject).not.toHaveBeenCalled();
    }
  });

  it.each([
    "cover-letter/authorization",
    "cover-letter/location",
    "resume/authorization",
    "resume/location",
  ])("forwards authenticated body-free material %s reads", async (route) => {
    const { handler, inject } = dispatcher();
    const path = `/v1/applications/${id}/${route}`;
    const extra = { rawQueryString: `generationId=${attempt}` };
    const anonymous = invocation("GET", path, extra);
    delete anonymous.requestContext.authorizer;
    expect((await invoke(handler, anonymous)).statusCode).toBe(401);
    expect(
      (await invoke(handler, invocation("GET", path, { ...extra, body: "{}" }))).statusCode,
    ).toBe(400);
    expect((await invoke(handler, invocation("POST", path, extra))).statusCode).toBe(404);
    expect(inject).not.toHaveBeenCalled();
    expect((await invoke(handler, invocation("GET", path, extra))).statusCode).toBe(200);
    expect(inject).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${path}?${extra.rawQueryString}` }),
    );
  });

  it.each(["resume", "cover-letter"])("bounds %s file format and preview queries", async (kind) => {
    const file = `/v1/applications/${id}/${kind}/file`;
    for (const [query, status] of [
      ["format=docx", 200],
      ["format=pdf", 200],
      ["format=txt", 400],
      ["format=pdf&format=docx", 400],
      ["format=pdf&x=1", 400],
      ["x=pdf", 400],
    ] as const) {
      const { inject, handler } = dispatcher();
      const response = await invoke(handler, invocation("GET", file, { rawQueryString: query }));
      expect(response.statusCode, query).toBe(status);
      if (status === 200) {
        expect(inject).toHaveBeenCalledWith(expect.objectContaining({ url: `${file}?${query}` }));
      }
    }
    const { handler } = dispatcher();
    expect(
      (
        await invoke(
          handler,
          invocation("GET", `/v1/applications/${id}/${kind}`, { rawQueryString: "format=pdf" }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it.each(["cover-letter", `packet-preparations/${attempt}`])(
    "protects the %s read boundary and rejects bodies or surplus query parameters",
    async (suffix) => {
      const { handler, inject } = dispatcher();
      const path = `/v1/applications/${id}/${suffix}`;
      const anonymous = invocation("GET", path);
      delete anonymous.requestContext.authorizer;
      expect((await invoke(handler, anonymous)).statusCode).toBe(401);
      expect((await invoke(handler, invocation("GET", path, { body: "{}" }))).statusCode).toBe(400);
      expect(
        (await invoke(handler, invocation("GET", path, { rawQueryString: "owner=other" })))
          .statusCode,
      ).toBe(400);
      expect((await invoke(handler, invocation("POST", path, { body: "{}" }))).statusCode).toBe(
        404,
      );
      expect(inject).not.toHaveBeenCalled();
    },
  );

  it("rejects an unauthenticated call before dispatch", async () => {
    const { inject, handler } = dispatcher();
    const input = invocation("GET", `/v1/applications/${id}`);
    delete input.requestContext.authorizer;
    expect((await invoke(handler, input)).statusCode).toBe(401);
    expect(inject).not.toHaveBeenCalled();
  });
});

describe("structured Profile routes at the Lambda boundary (ADR-052)", () => {
  const id = "019d04cf-1f80-7000-8000-000000000201";
  const json = { "content-type": "application/json", authorization: "Bearer opaque" };
  const invocation = (method: string, path: string, extra: Partial<AuthorizedHttpApiEvent> = {}) =>
    routedEvent(method, path, { headers: json, ...extra });
  const dispatcher = () => {
    const inject = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    const handler = createApiGatewayHandler({
      app: Promise.resolve({ inject }),
      issuer: ISSUER,
      audience: AUDIENCE,
      principalBridge: createInvocationPrincipalBridge(),
    });
    return { inject, handler };
  };

  it("routes every Profile section operation the OpenAPI contract declares", async () => {
    const contract = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../../packages/api-contracts/openapi/platform.v1.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { paths: Record<string, Record<string, unknown>> };
    const declared: Array<[string, string]> = [];
    for (const [template, operations] of Object.entries(contract.paths)) {
      if (
        !/^\/profile\/(personal|education-entries|work-experience-entries|skill-entries|application-answers|import-drafts)/.test(
          template,
        )
      ) {
        continue;
      }
      for (const method of Object.keys(operations)) declared.push([method.toUpperCase(), template]);
    }
    expect(declared.length).toBe(24);
    for (const [method, template] of declared) {
      const path = `/v1${template}`
        .replace("{entryId}", id)
        .replace("{answerId}", id)
        .replace("{draftId}", id);
      const { inject, handler } = dispatcher();
      const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
      const response = await invoke(
        handler,
        invocation(method, path, {
          ...(hasBody ? { body: "{}" } : {}),
          ...(method === "DELETE" && !path.includes("import-drafts")
            ? { rawQueryString: "expectedVersion=1" }
            : {}),
        }),
      );
      expect(response.statusCode, `${method} ${template}`).toBe(200);
      expect(inject, `${method} ${template}`).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ["DELETE", `/v1/profile/skill-entries/${id}`, undefined, ""],
    ["DELETE", `/v1/profile/skill-entries/${id}`, undefined, "expectedVersion=0"],
    ["DELETE", `/v1/profile/skill-entries/${id}`, undefined, "expectedVersion=1&x=1"],
    ["DELETE", `/v1/profile/skill-entries/${id}`, "{}", "expectedVersion=1"],
    ["GET", "/v1/profile/education-entries", undefined, "limit=1"],
    ["PATCH", "/v1/profile/education-entries/not-a-uuid", "{}", ""],
    ["DELETE", "/v1/profile/personal", undefined, ""],
    ["PATCH", "/v1/profile/personal", "{}", ""],
    ["GET", "/v1/profile/education-entries/reorder", undefined, ""],
    ["POST", "/v1/profile/education-entries/extra/segment", "{}", ""],
  ])("refuses %s %s with body %s and query %s", async (method, path, body, query) => {
    const { inject, handler } = dispatcher();
    const response = await invoke(
      handler,
      invocation(method as string, path as string, {
        ...(body === undefined ? {} : { body }),
        ...(query ? { rawQueryString: query as string } : {}),
      }),
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(inject).not.toHaveBeenCalled();
  });
});
