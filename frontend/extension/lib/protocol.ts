import { ACCOUNT_FENCE_VERSION, accountFenceFromAccessToken } from "./account-fence";
import { extensionConfiguration } from "./config";
import { pkceChallenge, randomBase64Url, validateAuthorizationCallback } from "./pkce";

const SESSION_KEY = "auth0Session";
const REQUIRED_SCOPE =
  "openid profile email offline_access profile:read profile:write jobs:read jobs:write jobs:contribute";

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  identityFence: string;
  identityFenceVersion: typeof ACCOUNT_FENCE_VERSION;
  refreshToken?: string;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

let sessionGeneration = 0;
let identityTransition: number | undefined;
let sessionStorageTail: Promise<void> = Promise.resolve();
let pendingRefresh: { generation: number; promise: Promise<void> } | undefined;

function withSessionStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionStorageTail.then(operation);
  sessionStorageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function assertSessionGeneration(generation: number, allowTransition = false): void {
  if (generation !== sessionGeneration || (!allowTransition && identityTransition !== undefined)) {
    throw new Error("identity_changed");
  }
}

function endpoint(path: string): URL {
  return new URL(path, `https://${extensionConfiguration.domain}/`);
}

function configured() {
  if (!extensionConfiguration.configured) {
    throw new Error("configuration_required");
  }
}

async function tokenRequest(parameters: URLSearchParams): Promise<StoredSession> {
  const response = await fetch(endpoint("/oauth/token"), {
    body: parameters,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("token_request_failed");
  }
  const body = (await response.json()) as TokenResponse;
  if (
    typeof body.access_token !== "string" ||
    body.access_token.length === 0 ||
    body.token_type !== "Bearer" ||
    typeof body.expires_in !== "number" ||
    body.expires_in <= 0
  ) {
    throw new Error("invalid_token_response");
  }
  const grantedScopes = typeof body.scope === "string" ? body.scope.split(" ") : undefined;
  if (
    grantedScopes &&
    !["profile:read", "profile:write", "jobs:read", "jobs:write", "jobs:contribute"].every(
      (scope) => grantedScopes.includes(scope),
    )
  ) {
    throw new Error("required_scope_missing");
  }
  const identityFence = await accountFenceFromAccessToken({
    accessToken: body.access_token,
    audience: extensionConfiguration.audience,
    clientId: extensionConfiguration.clientId,
    issuer: `https://${extensionConfiguration.domain}/`,
  });
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1_000,
    identityFence,
    identityFenceVersion: ACCOUNT_FENCE_VERSION,
    ...(typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? { refreshToken: body.refresh_token }
      : {}),
  };
}

async function readStoredSession(): Promise<StoredSession | undefined> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const candidate = result[SESSION_KEY] as Partial<StoredSession> | undefined;
  if (candidate === undefined) return undefined;
  if (
    typeof candidate.accessToken !== "string" ||
    candidate.accessToken.length === 0 ||
    candidate.accessToken.length > 16_384 ||
    !Number.isFinite(candidate.expiresAt) ||
    (candidate.expiresAt ?? 0) <= 0 ||
    typeof candidate.identityFence !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(candidate.identityFence) ||
    candidate.identityFenceVersion !== ACCOUNT_FENCE_VERSION ||
    (candidate.refreshToken !== undefined &&
      (typeof candidate.refreshToken !== "string" ||
        candidate.refreshToken.length === 0 ||
        candidate.refreshToken.length > 4_096))
  ) {
    await chrome.storage.session.remove(SESSION_KEY);
    return undefined;
  }
  return candidate as StoredSession;
}

function readSession(): Promise<StoredSession | undefined> {
  return withSessionStorage(readStoredSession);
}

function writeSession(
  session: StoredSession | undefined,
  generation: number,
  expected?: StoredSession,
): Promise<void> {
  return withSessionStorage(async () => {
    assertSessionGeneration(generation, true);
    const previous = await readStoredSession();
    assertSessionGeneration(generation, true);
    if (expected) {
      assertSessionGeneration(generation);
      if (
        previous?.accessToken !== expected.accessToken ||
        previous?.refreshToken !== expected.refreshToken ||
        previous?.identityFence !== expected.identityFence
      ) {
        throw new Error("identity_changed");
      }
    }
    if (session) {
      await chrome.storage.session.set({ [SESSION_KEY]: session });
    } else {
      await chrome.storage.session.remove(SESSION_KEY);
    }
    if (generation !== sessionGeneration && session) {
      // No newer storage operation can interleave here. Roll back only this superseded write;
      // an ordered logout still needs the previous refresh token for its revocation attempt.
      if (previous) await chrome.storage.session.set({ [SESSION_KEY]: previous });
      else await chrome.storage.session.remove(SESSION_KEY);
    }
    // A newer logout/commit queues behind this write, including a delayed storage completion.
    assertSessionGeneration(generation, true);
  });
}

export async function login(): Promise<void> {
  configured();
  const generation = ++sessionGeneration;
  identityTransition = generation;
  try {
    const redirectUri = chrome.identity.getRedirectURL("auth0");
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const authorizationUrl = endpoint("/authorize");
    authorizationUrl.search = new URLSearchParams({
      audience: extensionConfiguration.audience,
      client_id: extensionConfiguration.clientId,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: REQUIRED_SCOPE,
      state,
    }).toString();

    assertSessionGeneration(generation, true);
    const callbackUrl = await chrome.identity.launchWebAuthFlow({
      interactive: true,
      url: authorizationUrl.href,
    });
    assertSessionGeneration(generation, true);
    if (!callbackUrl) {
      throw new Error("authorization_cancelled");
    }
    const code = validateAuthorizationCallback({
      callbackUrl,
      expectedRedirectUri: redirectUri,
      expectedState: state,
    });
    const session = await tokenRequest(
      new URLSearchParams({
        client_id: extensionConfiguration.clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    );
    await writeSession(session, generation);
  } finally {
    if (identityTransition === generation) identityTransition = undefined;
  }
}

export async function refresh(): Promise<void> {
  configured();
  const generation = sessionGeneration;
  assertSessionGeneration(generation);
  if (pendingRefresh?.generation === generation) return pendingRefresh.promise;
  const promise = refreshSession(generation);
  pendingRefresh = { generation, promise };
  try {
    await promise;
  } finally {
    if (pendingRefresh?.promise === promise) pendingRefresh = undefined;
  }
}

async function refreshSession(generation: number): Promise<void> {
  const current = await readSession();
  assertSessionGeneration(generation);
  if (!current?.refreshToken) {
    throw new Error("reauthentication_required");
  }
  const replacement = await tokenRequest(
    new URLSearchParams({
      client_id: extensionConfiguration.clientId,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    }),
  );
  assertSessionGeneration(generation);
  if (replacement.identityFence !== current.identityFence) {
    throw new Error("identity_changed");
  }
  await writeSession(
    {
      ...replacement,
      refreshToken: replacement.refreshToken ?? current.refreshToken,
    },
    generation,
    current,
  );
}

export async function authenticatedApiSession(): Promise<{
  accessToken: string;
  identityFence: string;
}> {
  configured();
  const generation = sessionGeneration;
  assertSessionGeneration(generation);
  let current = await readSession();
  assertSessionGeneration(generation);
  if (!current) {
    throw new Error("authentication_required");
  }
  if (current.expiresAt <= Date.now() + 30_000) {
    await refresh();
    current = await readSession();
    assertSessionGeneration(generation);
  }
  if (!current || current.expiresAt <= Date.now()) {
    throw new Error("authentication_required");
  }
  return { accessToken: current.accessToken, identityFence: current.identityFence };
}

export async function logout(): Promise<void> {
  configured();
  const generation = ++sessionGeneration;
  identityTransition = generation;
  // Enqueue synchronously: explicit logout clears prior credentials even if a newer login
  // cancels, but this barrier always precedes any newer successful session commit.
  const cleared = withSessionStorage(async () => {
    const current = await readStoredSession();
    await chrome.storage.session.remove(SESSION_KEY);
    return current;
  });
  try {
    const current = await cleared;
    assertSessionGeneration(generation, true);
    if (current?.refreshToken) {
      const revocationResponse = await fetch(endpoint("/oauth/revoke"), {
        body: new URLSearchParams({
          client_id: extensionConfiguration.clientId,
          token: current.refreshToken,
          token_type_hint: "refresh_token",
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      if (!revocationResponse.ok) {
        throw new Error("revocation_failed");
      }
    }
    assertSessionGeneration(generation, true);
    const returnTo = chrome.identity.getRedirectURL("auth0");
    const logoutUrl = endpoint("/v2/logout");
    logoutUrl.search = new URLSearchParams({
      client_id: extensionConfiguration.clientId,
      returnTo,
    }).toString();
    await chrome.identity.launchWebAuthFlow({ interactive: true, url: logoutUrl.href });
  } finally {
    if (identityTransition === generation) identityTransition = undefined;
  }
}

export async function authenticationStatus(): Promise<{
  apiConfigured: boolean;
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
}> {
  if (!extensionConfiguration.configured) {
    return {
      apiConfigured: extensionConfiguration.apiConfigured,
      authenticated: false,
      configured: false,
      refreshAvailable: false,
    };
  }
  const generation = sessionGeneration;
  const session = await readSession();
  const current = generation === sessionGeneration && identityTransition === undefined;
  return {
    apiConfigured: extensionConfiguration.apiConfigured,
    authenticated: Boolean(current && session && session.expiresAt > Date.now()),
    configured: true,
    refreshAvailable: Boolean(current && session?.refreshToken),
  };
}
