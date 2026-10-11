import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SessionRecord {
  accessToken: string;
  expiresAt: number;
  identityFence: string;
  identityFenceVersion: "auth0-subject-sha256-v1";
  refreshToken?: string;
}

const completeScope =
  "openid profile email offline_access profile:read profile:write jobs:read jobs:write jobs:contribute";

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function accessToken(subject: string, nonce = "one", overrides: Record<string, unknown> = {}) {
  return [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      aud: "ai-job-apply-api",
      azp: "extension-native-client",
      exp: Math.floor(Date.now() / 1_000) + 3_600,
      iss: "https://tenant.example.test/",
      jti: nonce,
      sub: subject,
      ...overrides,
    }),
    "test-signature",
  ].join(".");
}

async function accountFence(subject: string): Promise<string> {
  const { accountFenceFromAccessToken } = await import("../lib/account-fence");
  return accountFenceFromAccessToken({
    accessToken: accessToken(subject),
    audience: "ai-job-apply-api",
    clientId: "extension-native-client",
    issuer: "https://tenant.example.test/",
  });
}

function tokenResponse(
  accessToken: string,
  refreshToken?: string,
  overrides: Partial<Record<string, unknown>> = {},
): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      expires_in: 3600,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      scope: completeScope,
      token_type: "Bearer",
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function installPublicConfiguration(): void {
  vi.stubGlobal("__AUTH0_AUDIENCE__", "ai-job-apply-api");
  vi.stubGlobal("__AUTH0_CLIENT_ID__", "extension-native-client");
  vi.stubGlobal("__AUTH0_DOMAIN__", "tenant.example.test");
  vi.stubGlobal("__EXTENSION_API_ORIGIN__", "https://api.example.test");
  vi.stubGlobal("__PENDING_RETENTION_MILLISECONDS__", 24 * 60 * 60 * 1_000);
  vi.stubGlobal("__CAPABILITY_POLICY_PUBLIC_KEYS__", {});
  vi.stubGlobal("__UGC_CONTRIBUTION_POLICY_VERSION__", "d2-development-policy.v1");
}

function installChrome(options: {
  callback?: string;
  initialSession?: unknown;
  launchError?: Error;
}) {
  const records = new Map<string, unknown>();
  if (options.initialSession) records.set("auth0Session", options.initialSession);
  const launchWebAuthFlow = vi.fn(async (_details: { url: string }) => {
    if (options.launchError) throw options.launchError;
    return options.callback;
  });
  const sessionStorage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(records.get(key)) })),
    remove: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    set: vi.fn(async (value: Record<string, unknown>) => {
      for (const [key, entry] of Object.entries(value)) records.set(key, structuredClone(entry));
    }),
  };
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/auth0"),
      launchWebAuthFlow,
    },
    storage: {
      session: sessionStorage,
    },
  });
  return { launchWebAuthFlow, records, sessionStorage };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise not initialized");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function storedSession(subject = "auth0|candidate-one"): Promise<SessionRecord> {
  return {
    accessToken: accessToken(subject),
    expiresAt: Date.now() + 10_000,
    identityFence: await accountFence(subject),
    identityFenceVersion: "auth0-subject-sha256-v1",
    refreshToken: "refresh-original",
  };
}

function authorize({ url }: { url: string }) {
  const state = new URL(url).searchParams.get("state");
  return Promise.resolve(
    `https://extension-id.chromiumapp.org/auth0?code=short-code&state=${state}`,
  );
}

async function protocol() {
  return import("../lib/protocol");
}

describe("extension Auth0 protocol lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    installPublicConfiguration();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads a still-valid local session without proactive refresh for cached display", async () => {
    const session = await storedSession();
    installChrome({ initialSession: session });
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const api = await protocol();
    await expect(api.authenticatedApiSession({ refreshIfNeeded: false })).resolves.toEqual({
      accessToken: session.accessToken,
      identityFence: session.identityFence,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Ordinary API callers retain proactive refresh and fail when the exchange is offline.
    await expect(api.authenticatedApiSession()).rejects.toThrow("token_request_failed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["expired", "missing"])("rejects %s sessions even for cached display", async (kind) => {
    const session = await storedSession();
    installChrome({
      initialSession: kind === "expired" ? { ...session, expiresAt: Date.now() - 1 } : undefined,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      (await protocol()).authenticatedApiSession({ refreshIfNeeded: false }),
    ).rejects.toThrow("authentication_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when interactive authorization is cancelled", async () => {
    const browser = installChrome({});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect((await protocol()).login()).rejects.toThrow("authorization_cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("removes a legacy random-fence session before reporting authentication", async () => {
    const browser = installChrome({
      initialSession: {
        accessToken: accessToken("auth0|candidate-one"),
        expiresAt: Date.now() + 60_000,
        identityFence: "a".repeat(43),
        refreshToken: "refresh-one",
      },
    });

    await expect((await protocol()).authenticationStatus()).resolves.toMatchObject({
      authenticated: false,
      refreshAvailable: false,
    });
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("rejects a callback whose state does not match before token exchange", async () => {
    const browser = installChrome({
      callback: "https://extension-id.chromiumapp.org/auth0?code=short-code&state=wrong",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect((await protocol()).login()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])("exchanges a valid PKCE callback with handoff=%s execution=%s", async (handoff, execution) => {
    vi.stubGlobal("__APPLICATION_EXECUTION_ENABLED__", execution);
    vi.stubGlobal("__APPLICATION_HANDOFF_WEB_ORIGIN__", handoff ? "https://candidate.example" : "");
    const scope =
      completeScope +
      (handoff ? " applications:read" : "") +
      (execution ? " applications:write" : "");
    const issuedAccessToken = accessToken("auth0|candidate-one");
    let authorizationState = "";
    const browser = installChrome({});
    browser.launchWebAuthFlow.mockImplementationOnce(async ({ url }: { url: string }) => {
      const authorization = new URL(url);
      authorizationState = authorization.searchParams.get("state") ?? "";
      expect(authorization.origin).toBe("https://tenant.example.test");
      expect(authorization.pathname).toBe("/authorize");
      expect(authorization.searchParams.get("audience")).toBe("ai-job-apply-api");
      expect(authorization.searchParams.get("client_id")).toBe("extension-native-client");
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorization.searchParams.get("response_type")).toBe("code");
      expect(authorization.searchParams.get("scope")).toBe(scope);
      return `https://extension-id.chromiumapp.org/auth0?code=short-code&state=${authorizationState}`;
    });
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const parameters = init.body as URLSearchParams;
      expect(parameters.get("grant_type")).toBe("authorization_code");
      expect(parameters.get("code")).toBe("short-code");
      expect(parameters.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{86}$/u);
      return tokenResponse(issuedAccessToken, "refresh-one", { scope });
    });
    vi.stubGlobal("fetch", fetchMock);
    await (await protocol()).login();
    const stored = browser.records.get("auth0Session") as SessionRecord;
    expect(stored).toMatchObject({
      accessToken: issuedAccessToken,
      identityFenceVersion: "auth0-subject-sha256-v1",
      refreshToken: "refresh-one",
    });
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.identityFence).toBe(await accountFence("auth0|candidate-one"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same pseudonymous account fence after a full login to the same account", async () => {
    const firstFence = await accountFence("auth0|candidate-one");
    let authorizationState = "";
    const browser = installChrome({
      initialSession: {
        accessToken: accessToken("auth0|candidate-one", "old"),
        expiresAt: Date.now() + 60_000,
        identityFence: firstFence,
        identityFenceVersion: "auth0-subject-sha256-v1",
        refreshToken: "refresh-old",
      },
    });
    browser.launchWebAuthFlow.mockImplementationOnce(async ({ url }: { url: string }) => {
      authorizationState = new URL(url).searchParams.get("state") ?? "";
      return `https://extension-id.chromiumapp.org/auth0?code=short-code&state=${authorizationState}`;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenResponse(accessToken("auth0|candidate-one", "new"), "refresh-new")),
    );

    await (await protocol()).login();

    expect(browser.records.get("auth0Session")).toMatchObject({
      identityFence: firstFence,
      identityFenceVersion: "auth0-subject-sha256-v1",
      refreshToken: "refresh-new",
    });
  });

  it("rotates refresh tokens while preserving the account fence", async () => {
    const rotatedAccessToken = accessToken("auth0|candidate-one", "two");
    const identityFence = await accountFence("auth0|candidate-one");
    const browser = installChrome({
      initialSession: {
        accessToken: accessToken("auth0|candidate-one", "one"),
        expiresAt: Date.now() + 60_000,
        identityFence,
        identityFenceVersion: "auth0-subject-sha256-v1",
        refreshToken: "refresh-one",
      },
    });
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const parameters = init.body as URLSearchParams;
      expect(parameters.get("grant_type")).toBe("refresh_token");
      expect(parameters.get("refresh_token")).toBe("refresh-one");
      return tokenResponse(rotatedAccessToken, "refresh-two");
    });
    vi.stubGlobal("fetch", fetchMock);
    await (await protocol()).refresh();
    expect(browser.records.get("auth0Session")).toMatchObject({
      accessToken: rotatedAccessToken,
      identityFence,
      refreshToken: "refresh-two",
    });
  });

  it("rejects a refresh that resolves to a different account without replacing the session", async () => {
    const identityFence = await accountFence("auth0|candidate-one");
    const original: SessionRecord = {
      accessToken: accessToken("auth0|candidate-one"),
      expiresAt: Date.now() + 60_000,
      identityFence,
      identityFenceVersion: "auth0-subject-sha256-v1",
      refreshToken: "refresh-one",
    };
    const browser = installChrome({ initialSession: original });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenResponse(accessToken("auth0|candidate-two"), "refresh-two")),
    );

    await expect((await protocol()).refresh()).rejects.toThrow("identity_changed");
    expect(browser.records.get("auth0Session")).toEqual(original);
  });

  it("retains the last valid session when a replayed refresh token is rejected", async () => {
    const identityFence = await accountFence("auth0|candidate-one");
    const original: SessionRecord = {
      accessToken: accessToken("auth0|candidate-one"),
      expiresAt: Date.now() - 1,
      identityFence,
      identityFenceVersion: "auth0-subject-sha256-v1",
      refreshToken: "refresh-one",
    };
    const browser = installChrome({ initialSession: original });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    await expect((await protocol()).refresh()).rejects.toThrow("token_request_failed");
    expect(browser.records.get("auth0Session")).toEqual(original);
  });

  it("refreshes an expiring session before returning API credentials", async () => {
    const rotatedAccessToken = accessToken("auth0|candidate-one", "two");
    const identityFence = await accountFence("auth0|candidate-one");
    const browser = installChrome({
      initialSession: {
        accessToken: accessToken("auth0|candidate-one", "one"),
        expiresAt: Date.now() + 10_000,
        identityFence,
        identityFenceVersion: "auth0-subject-sha256-v1",
        refreshToken: "refresh-one",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenResponse(rotatedAccessToken, "refresh-two")),
    );
    await expect((await protocol()).authenticatedApiSession()).resolves.toEqual({
      accessToken: rotatedAccessToken,
      identityFence,
    });
    expect(browser.records.get("auth0Session")).toMatchObject({
      accessToken: rotatedAccessToken,
      refreshToken: "refresh-two",
    });
  });

  it("revokes the refresh token, completes provider logout, and clears the session", async () => {
    const identityFence = await accountFence("auth0|candidate-one");
    const browser = installChrome({
      callback: "https://extension-id.chromiumapp.org/auth0",
      initialSession: {
        accessToken: accessToken("auth0|candidate-one"),
        expiresAt: Date.now() + 60_000,
        identityFence,
        identityFenceVersion: "auth0-subject-sha256-v1",
        refreshToken: "refresh-one",
      },
    });
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      expect(new URL(url).pathname).toBe("/oauth/revoke");
      const parameters = init.body as URLSearchParams;
      expect(parameters.get("client_id")).toBe("extension-native-client");
      expect(parameters.get("token")).toBe("refresh-one");
      expect(parameters.get("token_type_hint")).toBe("refresh_token");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await (await protocol()).logout();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(browser.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    const logoutCall = browser.launchWebAuthFlow.mock.calls[0];
    expect(logoutCall).toBeDefined();
    const logoutUrl = new URL(logoutCall?.[0].url ?? "https://invalid.example.test");
    expect(logoutUrl.pathname).toBe("/v2/logout");
    expect(logoutUrl.searchParams.get("client_id")).toBe("extension-native-client");
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("clears local credentials even when provider revocation fails", async () => {
    const identityFence = await accountFence("auth0|candidate-one");
    const browser = installChrome({
      initialSession: {
        accessToken: accessToken("auth0|candidate-one"),
        expiresAt: Date.now() + 60_000,
        identityFence,
        identityFenceVersion: "auth0-subject-sha256-v1",
        refreshToken: "refresh-one",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect((await protocol()).logout()).rejects.toThrow("revocation_failed");
    expect(browser.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("does not restore a deferred refresh after logout", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    const started = deferred<void>();
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname === "/oauth/revoke") return new Response(null, { status: 200 });
        started.resolve();
        return response.promise;
      }),
    );
    const api = await protocol();
    const refreshing = expect(api.refresh()).rejects.toThrow("identity_changed");
    await started.promise;
    await api.logout();
    response.resolve(tokenResponse(accessToken("auth0|candidate-one"), "refresh-late"));
    await refreshing;
    expect(browser.records.has("auth0Session")).toBe(false);
    expect(await api.authenticationStatus()).toMatchObject({ authenticated: false });
  });

  it("does not let an old refresh replace a newer account login", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    browser.launchWebAuthFlow.mockImplementation(authorize);
    const started = deferred<void>();
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        if ((init.body as URLSearchParams).get("grant_type") === "authorization_code") {
          return tokenResponse(accessToken("auth0|candidate-two"), "refresh-new-account");
        }
        started.resolve();
        return response.promise;
      }),
    );
    const api = await protocol();
    const refreshing = expect(api.refresh()).rejects.toThrow("identity_changed");
    await started.promise;
    await api.login();
    response.resolve(tokenResponse(accessToken("auth0|candidate-one"), "refresh-late"));
    await refreshing;
    expect(browser.records.get("auth0Session")).toMatchObject({
      identityFence: await accountFence("auth0|candidate-two"),
      refreshToken: "refresh-new-account",
    });
  });

  it("coalesces concurrent near-expiry and explicit refresh calls into one rotation", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    const started = deferred<void>();
    const response = deferred<Response>();
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect((init.body as URLSearchParams).get("refresh_token")).toBe("refresh-original");
      started.resolve();
      return response.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const api = await protocol();
    const sessions = [api.authenticatedApiSession(), api.authenticatedApiSession()];
    await started.promise;
    const explicit = api.refresh();
    response.resolve(tokenResponse(accessToken("auth0|candidate-one", "rotated"), "refresh-next"));
    const [first, second] = await Promise.all(sessions);
    await explicit;
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(browser.records.get("auth0Session")).toMatchObject({ refreshToken: "refresh-next" });
  });

  it("drains a delayed session write before logout clears it", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    const started = deferred<void>();
    const release = deferred<void>();
    browser.sessionStorage.set.mockImplementationOnce(async (value) => {
      started.resolve();
      await release.promise;
      for (const [key, entry] of Object.entries(value)) browser.records.set(key, entry);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.pathname === "/oauth/revoke"
          ? new Response(null, { status: 200 })
          : tokenResponse(accessToken("auth0|candidate-one"), "refresh-next"),
      ),
    );
    const api = await protocol();
    const refreshing = expect(api.refresh()).rejects.toThrow("identity_changed");
    await started.promise;
    const signingOut = api.logout();
    release.resolve();
    await Promise.all([refreshing, signingOut]);
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("removes a stale login storage write when the newer login cancels", async () => {
    const browser = installChrome({});
    browser.launchWebAuthFlow.mockImplementationOnce(authorize).mockResolvedValueOnce(undefined);
    const started = deferred<void>();
    const release = deferred<void>();
    browser.sessionStorage.set.mockImplementationOnce(async (value) => {
      started.resolve();
      await release.promise;
      for (const [key, entry] of Object.entries(value)) browser.records.set(key, entry);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenResponse(accessToken("auth0|candidate-one"), "refresh-one")),
    );
    const api = await protocol();
    const first = expect(api.login()).rejects.toThrow("identity_changed");
    await started.promise;
    await expect(api.login()).rejects.toThrow("authorization_cancelled");
    release.resolve();
    await first;
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("does not let an older logout clear or complete provider logout after a newer login", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    browser.launchWebAuthFlow.mockImplementation(authorize);
    const started = deferred<void>();
    const revocation = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname === "/oauth/revoke") {
          started.resolve();
          return revocation.promise;
        }
        return tokenResponse(accessToken("auth0|candidate-two"), "refresh-new-account");
      }),
    );
    const api = await protocol();
    const signingOut = expect(api.logout()).rejects.toThrow("identity_changed");
    await started.promise;
    await api.login();
    revocation.resolve(new Response(null, { status: 200 }));
    await signingOut;
    expect(browser.records.get("auth0Session")).toMatchObject({
      refreshToken: "refresh-new-account",
    });
    expect(browser.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(
      new URL(browser.launchWebAuthFlow.mock.calls[0]?.[0].url ?? "https://invalid.test").pathname,
    ).toBe("/authorize");
  });

  it("refuses credentials from a delayed session read after logout starts", async () => {
    const initial = { ...(await storedSession()), expiresAt: Date.now() + 60_000 };
    const browser = installChrome({ initialSession: initial });
    const started = deferred<void>();
    const release = deferred<void>();
    browser.sessionStorage.get.mockImplementationOnce(async (key) => {
      started.resolve();
      await release.promise;
      return { [key]: initial };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const api = await protocol();
    const reading = expect(api.authenticatedApiSession()).rejects.toThrow("identity_changed");
    await started.promise;
    const signingOut = api.logout();
    release.resolve();
    await Promise.all([reading, signingOut]);
    expect(browser.records.has("auth0Session")).toBe(false);
  });

  it("keeps the ordered logout clear when a newer login cancels during its storage read", async () => {
    const initial = await storedSession();
    const browser = installChrome({ initialSession: initial });
    const started = deferred<void>();
    const release = deferred<void>();
    browser.sessionStorage.get.mockImplementationOnce(async (key) => {
      started.resolve();
      await release.promise;
      return { [key]: initial };
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const api = await protocol();
    const signingOut = expect(api.logout()).rejects.toThrow("identity_changed");
    await started.promise;
    await expect(api.login()).rejects.toThrow("authorization_cancelled");
    release.resolve();
    await signingOut;
    expect(browser.records.has("auth0Session")).toBe(false);
    expect(await api.authenticationStatus()).toMatchObject({ authenticated: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["login", "refresh", "logout"] as const)(
    "isolates the %s OAuth POST from redirects, cookies, and caching",
    async (action) => {
      const browser = installChrome({ initialSession: await storedSession() });
      browser.launchWebAuthFlow.mockImplementation(authorize);
      const fetcher = vi.fn(async () =>
        action === "logout"
          ? new Response(null, { status: 200 })
          : tokenResponse(accessToken("auth0|candidate-one"), "refresh-next"),
      );
      vi.stubGlobal("fetch", fetcher);

      await (await protocol())[action]();

      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith(
        new URL(`https://tenant.example.test/oauth/${action === "logout" ? "revoke" : "token"}`),
        expect.objectContaining({
          cache: "no-store",
          credentials: "omit",
          method: "POST",
          redirect: "error",
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );

  it.each(["refresh", "logout"] as const)(
    "refuses a redirected %s response without accepting provider content",
    async (action) => {
      const original = await storedSession();
      const browser = installChrome({ initialSession: original });
      const response = tokenResponse(accessToken("auth0|candidate-one"), "refresh-redirected");
      Object.defineProperty(response, "redirected", { value: true });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );

      await expect((await protocol())[action]()).rejects.toThrow(
        action === "logout" ? "revocation_failed" : "token_request_failed",
      );
      expect(browser.records.get("auth0Session")).toEqual(
        action === "logout" ? undefined : original,
      );
      expect(browser.launchWebAuthFlow).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["login", "headers"],
    ["login", "body"],
    ["refresh", "headers"],
    ["refresh", "body"],
  ] as const)(
    "bounds stalled %s %s, releases the lifecycle, and never commits its late result",
    async (action, stalledAt) => {
      const original = await storedSession();
      const browser = installChrome({ initialSession: original });
      browser.launchWebAuthFlow.mockImplementation(authorize);
      const started = deferred<void>();
      const response = deferred<Response>();
      const releaseBody = deferred<void>();
      const cancel = vi.fn();
      let requestSignal: AbortSignal | null | undefined;
      const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
        requestSignal = init.signal;
        started.resolve();
        if (stalledAt === "headers") return response.promise;
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await releaseBody.promise;
              if (requestSignal?.aborted) return;
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    access_token: accessToken("auth0|candidate-one", "late"),
                    expires_in: 3600,
                    refresh_token: "refresh-late",
                    token_type: "Bearer",
                  }),
                ),
              );
              controller.close();
            },
            cancel,
          }),
          { headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const api = await protocol();
      vi.useFakeTimers();
      const outcome = api[action]().then(
        () => "accepted",
        (error: unknown) => (error instanceof Error ? error.message : "unexpected_error"),
      );
      try {
        await started.promise;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await Promise.race([outcome, Promise.resolve("still_pending")])).toBe(
          "token_request_failed",
        );
        expect(requestSignal?.aborted).toBe(true);
        expect(browser.records.get("auth0Session")).toEqual(original);
        expect(await api.authenticationStatus()).toMatchObject({ refreshAvailable: true });
        if (stalledAt === "body") expect(cancel).toHaveBeenCalledOnce();

        fetcher.mockImplementationOnce(async () =>
          tokenResponse(accessToken("auth0|candidate-one", "next"), "refresh-next"),
        );
        await api[action]();
        expect(browser.records.get("auth0Session")).toMatchObject({ refreshToken: "refresh-next" });
      } finally {
        response.resolve(tokenResponse(accessToken("auth0|candidate-one", "late"), "refresh-late"));
        releaseBody.resolve();
        await outcome;
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(browser.records.get("auth0Session")).toMatchObject({ refreshToken: "refresh-next" });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("bounds revocation failure after clearing local credentials, without later provider logout", async () => {
    const browser = installChrome({ initialSession: await storedSession() });
    const started = deferred<void>();
    const response = deferred<Response>();
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        requestSignal = init.signal;
        started.resolve();
        return response.promise;
      }),
    );
    const api = await protocol();
    vi.useFakeTimers();
    const outcome = api.logout().then(
      () => "accepted",
      (error: unknown) => (error instanceof Error ? error.message : "unexpected_error"),
    );
    try {
      await started.promise;
      expect(browser.records.has("auth0Session")).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await Promise.race([outcome, Promise.resolve("still_pending")])).toBe(
        "revocation_failed",
      );
      expect(requestSignal?.aborted).toBe(true);
      expect(await api.authenticationStatus()).toMatchObject({
        authenticated: false,
        refreshAvailable: false,
      });
    } finally {
      response.resolve(new Response(null, { status: 200 }));
      await outcome;
    }
    expect(browser.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "non-json",
    "non-object",
    "wrong-media-type",
    "invalid-utf8",
    "oversized-json",
    "oversized-refresh-token",
    "malformed-refresh-token",
    "overflowed-expiry",
  ])("refuses %s token content without replacing the session or exposing it", async (shape) => {
    const original = await storedSession();
    const browser = installChrome({ initialSession: original });
    let response: Response;
    if (shape === "non-json" || shape === "non-object" || shape === "invalid-utf8") {
      response = new Response(
        shape === "non-json"
          ? "provider-private-error-content"
          : shape === "non-object"
            ? "null"
            : new Uint8Array([0xff]),
        { headers: { "content-type": "application/json" } },
      );
    } else {
      response = tokenResponse(accessToken("auth0|candidate-one"), "refresh-next", {
        ...(shape === "oversized-json" ? { ignored: "x".repeat(65_536) } : {}),
        ...(shape === "oversized-refresh-token" ? { refresh_token: "x".repeat(4_097) } : {}),
        ...(shape === "malformed-refresh-token" ? { refresh_token: { token: "private" } } : {}),
        ...(shape === "overflowed-expiry" ? { expires_in: 1e308 } : {}),
      });
      if (shape === "wrong-media-type") response.headers.set("content-type", "text/html");
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect((await protocol()).refresh()).rejects.toThrow(/^invalid_token_response$/u);
    expect(browser.records.get("auth0Session")).toEqual(original);
  });

  it.each(["refresh", "logout"] as const)(
    "projects a private %s transport error to its fixed code",
    async (action) => {
      installChrome({ initialSession: await storedSession() });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-refresh-token-value")));
      await expect((await protocol())[action]()).rejects.toThrow(
        action === "logout" ? /^revocation_failed$/u : /^token_request_failed$/u,
      );
    },
  );

  it.each([65_536, 65_537])("bounds streamed token JSON at exactly %s bytes", async (size) => {
    const original = await storedSession();
    const browser = installChrome({ initialSession: original });
    const payload = {
      access_token: accessToken("auth0|candidate-one"),
      expires_in: 3600,
      refresh_token: "refresh-next",
      token_type: "Bearer",
      ignored: "é",
    };
    const encoder = new TextEncoder();
    payload.ignored += "x".repeat(size - encoder.encode(JSON.stringify(payload)).byteLength);
    const bytes = encoder.encode(JSON.stringify(payload));
    const cancel = vi.fn();
    let offset = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (offset === bytes.byteLength) {
              controller.close();
              return;
            }
            const next = Math.min(offset + 4_096, bytes.byteLength);
            controller.enqueue(bytes.subarray(offset, next));
            offset = next;
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const refreshing = (await protocol()).refresh();
    if (size === 65_536) {
      await refreshing;
      expect(browser.records.get("auth0Session")).toMatchObject({ refreshToken: "refresh-next" });
    } else {
      await expect(refreshing).rejects.toThrow(/^invalid_token_response$/u);
      expect(browser.records.get("auth0Session")).toEqual(original);
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
});
