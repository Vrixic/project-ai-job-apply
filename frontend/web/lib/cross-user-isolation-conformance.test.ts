import { describe, expect, it, vi } from "vitest";
import {
  armCrossUserIsolationProbe,
  CROSS_USER_PROBE_COOKIE_NAME,
  isCrossUserIsolationConformanceEnabled,
  isDarkLambdaIsolationConformanceEnabled,
  runCrossUserIsolationProbe,
} from "./cross-user-isolation-conformance";

const secret = "a".repeat(64);
const operationId = "019b4e12-7ea3-7c36-9357-aea35ab542cc";

function request(path: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function cookieStore() {
  let value: string | undefined;
  return {
    get: (name: string) => (name === CROSS_USER_PROBE_COOKIE_NAME && value ? { value } : undefined),
    set: vi.fn((name: string, nextValue: string, options: { maxAge: number }) => {
      if (name === CROSS_USER_PROBE_COOKIE_NAME) {
        value = options.maxAge === 0 ? undefined : nextValue;
      }
    }),
  };
}

function dependencies(
  subject: string,
  store: ReturnType<typeof cookieStore>,
  platformFetch: typeof fetch,
) {
  return {
    appBaseUrl: "http://localhost:3000",
    auth0: {
      getAccessToken: async () => ({ token: `server-token-${subject}` }),
      getSession: async () => ({ user: { sub: subject } }),
    },
    baseUrl: "https://platform.example",
    cookieStore: store,
    enabled: true,
    fetch: platformFetch,
    issuer: "https://development.example.auth0.com/",
    now: () => 1_000,
    secret,
  };
}

describe("deployed cross-user isolation conformance", () => {
  it("is available only in development mode", () => {
    expect(isCrossUserIsolationConformanceEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isCrossUserIsolationConformanceEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isCrossUserIsolationConformanceEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows queued-operation arming only in explicit local dark Lambda conformance", () => {
    expect(
      isDarkLambdaIsolationConformanceEnabled({
        NODE_ENV: "development",
        DARK_LAMBDA_CONFORMANCE: "1",
      }),
    ).toBe(true);
    expect(
      isDarkLambdaIsolationConformanceEnabled({
        NODE_ENV: "development",
        DARK_LAMBDA_CONFORMANCE: "0",
      }),
    ).toBe(false);
    expect(
      isDarkLambdaIsolationConformanceEnabled({
        NODE_ENV: "production",
        DARK_LAMBDA_CONFORMANCE: "1",
      }),
    ).toBe(false);
  });

  it("hides the probe when conformance mode is disabled", async () => {
    const store = cookieStore();
    const response = await armCrossUserIsolationProbe(request("/arm", { operationId }), {
      ...dependencies("owner-a", store, vi.fn()),
      enabled: false,
    });
    expect(response.status).toBe(404);
  });

  it("rejects cross-origin arming before reading identity", async () => {
    const store = cookieStore();
    const getSession = vi.fn();
    const response = await armCrossUserIsolationProbe(
      new Request("http://localhost:3000/arm", {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
        body: JSON.stringify({ operationId }),
      }),
      {
        ...dependencies("owner-a", store, vi.fn()),
        auth0: {
          getAccessToken: vi.fn(),
          getSession,
        },
      },
    );
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("arms only after verifying the current account owns the operation", async () => {
    const store = cookieStore();
    const platformFetch = vi.fn(async () =>
      Response.json({
        state: "succeeded",
        privateFieldThatMustNotLeak: "private operation body",
      }),
    );
    const response = await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies("owner-a", store, platformFetch),
    );

    expect(response.status).toBe(200);
    expect(store.set).toHaveBeenCalledOnce();
    const cookieCall = store.set.mock.calls[0];
    expect(cookieCall).toBeDefined();
    if (!cookieCall) {
      throw new Error("Expected the conformance probe cookie to be set");
    }
    const [, sealedCookie, cookieOptions] = cookieCall;
    expect(sealedCookie).not.toContain(operationId);
    expect(sealedCookie).not.toContain("owner-a");
    expect(cookieOptions).toMatchObject({
      httpOnly: true,
      maxAge: 900,
      path: "/",
      sameSite: "strict",
      secure: false,
    });
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(operationId);
    expect(serialized).not.toContain("owner-a");
    expect(serialized).not.toContain("server-token");
  });

  it("refuses to arm an operation that has not completed", async () => {
    const store = cookieStore();
    const response = await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies(
        "owner-a",
        store,
        vi.fn(async () => Response.json({ state: "running" })),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ state: "operation_unavailable" });
    expect(store.set).not.toHaveBeenCalled();
  });

  it("arms an owner-visible queued operation only when dark conformance explicitly permits it", async () => {
    const store = cookieStore();
    const platformFetch = vi.fn(async () => Response.json({ state: "queued" }));
    const response = await armCrossUserIsolationProbe(request("/arm", { operationId }), {
      ...dependencies("owner-a", store, platformFetch),
      allowQueuedOperation: true,
    });

    expect(response.status).toBe(200);
    expect(store.set).toHaveBeenCalledOnce();
  });

  it("requires a distinct identity before calling the deployed operation", async () => {
    const store = cookieStore();
    const platformFetch = vi.fn(async () => Response.json({ state: "succeeded" }));
    await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies("owner-a", store, platformFetch),
    );
    platformFetch.mockClear();

    const response = await runCrossUserIsolationProbe(
      request("/run"),
      dependencies("owner-a", store, platformFetch),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ state: "different_account_required" });
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("passes only when the deployed API hides the operation from a second identity", async () => {
    const store = cookieStore();
    const platformFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ state: "succeeded", private: "owner operation" }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies("owner-a", store, platformFetch),
    );

    const response = await runCrossUserIsolationProbe(
      request("/run"),
      dependencies("owner-b", store, platformFetch),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "isolation_passed",
      message: "Cross-user isolation passed: the second account could not read the operation.",
    });
    expect(store.get(CROSS_USER_PROBE_COOKIE_NAME)).toBeUndefined();
  });

  it("returns the isolation result without waiting for an unused response body", async () => {
    const store = cookieStore();
    const cancellationNeverCompletes = new Promise<void>(() => undefined);
    const platformFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ state: "succeeded" }))
      .mockResolvedValueOnce({
        body: {
          cancel: vi.fn(() => cancellationNeverCompletes),
        },
        status: 404,
      } as unknown as Response);
    await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies("owner-a", store, platformFetch),
    );

    const outcome = await Promise.race([
      runCrossUserIsolationProbe(request("/run"), dependencies("owner-b", store, platformFetch)),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(outcome).toBeInstanceOf(Response);
    if (!(outcome instanceof Response)) {
      throw new Error("The isolation result waited for the unused response body");
    }
    expect(outcome.status).toBe(200);
  });

  it("fails loudly without reflecting either private response body", async () => {
    const store = cookieStore();
    const platformFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ state: "succeeded", private: "owner private body" }))
      .mockResolvedValueOnce(new Response("cross-user private body", { status: 200 }));
    await armCrossUserIsolationProbe(
      request("/arm", { operationId }),
      dependencies("owner-a", store, platformFetch),
    );

    const response = await runCrossUserIsolationProbe(
      request("/run"),
      dependencies("owner-b", store, platformFetch),
    );
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain("isolation_failed");
    expect(body).not.toContain("owner private body");
    expect(body).not.toContain("cross-user private body");
    expect(body).not.toContain(operationId);
  });
});
