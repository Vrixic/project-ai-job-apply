import { beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/auth0"),
      launchWebAuthFlow,
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: records.get(key) })),
        remove: vi.fn(async (key: string) => {
          records.delete(key);
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, entry] of Object.entries(value)) records.set(key, entry);
        }),
      },
    },
  });
  return { launchWebAuthFlow, records };
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

  it("exchanges one valid PKCE callback and stores the bounded session", async () => {
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
      expect(authorization.searchParams.get("scope")).toBe(completeScope);
      return `https://extension-id.chromiumapp.org/auth0?code=short-code&state=${authorizationState}`;
    });
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const parameters = init.body as URLSearchParams;
      expect(parameters.get("grant_type")).toBe("authorization_code");
      expect(parameters.get("code")).toBe("short-code");
      expect(parameters.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{86}$/u);
      return tokenResponse(issuedAccessToken, "refresh-one");
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
});
