import { ACCOUNT_FENCE_VERSION, accountFenceFromAccessToken } from "./account-fence";
import { extensionConfiguration } from "./config";
import { pkceChallenge, randomBase64Url, validateAuthorizationCallback } from "./pkce";

const SESSION_KEY = "auth0Session";
const REQUIRED_SCOPE =
  "openid profile email offline_access profile:read profile:write jobs:read jobs:write jobs:contribute" +
  (extensionConfiguration.applicationHandoffWebOrigin ? " applications:read" : "");
const AUTH_REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_TOKEN_RESPONSE_BYTES = 65_536;

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

async function oauthPost(
  action: "token" | "revoke",
  parameters: URLSearchParams,
): Promise<unknown> {
  const failure = action === "token" ? "token_request_failed" : "revocation_failed";
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async (): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(endpoint(`/oauth/${action}`), {
        body: parameters,
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error(failure);
    }
    responseBody = response.body;
    if (controller.signal.aborted) {
      void responseBody?.cancel().catch(() => undefined);
      throw new Error(failure);
    }
    if (!response.ok || response.redirected) throw new Error(failure);
    if (action === "revoke") return undefined;
    try {
      if (
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json" ||
        !responseBody
      ) {
        throw new Error("invalid_token_response");
      }
      reader = responseBody.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw new Error(failure);
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAXIMUM_TOKEN_RESPONSE_BYTES) throw new Error("invalid_token_response");
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new Error(controller.signal.aborted ? failure : "invalid_token_response");
    } finally {
      reader?.releaseLock();
      reader = undefined;
    }
  };
  try {
    // Race the entire body read as well as fetch. A late transport result cannot reach storage.
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(failure));
        }, AUTH_REQUEST_TIMEOUT_MILLISECONDS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else if (responseBody) void responseBody.cancel().catch(() => undefined);
  }
}

async function tokenRequest(parameters: URLSearchParams): Promise<StoredSession> {
  const value = await oauthPost("token", parameters);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_token_response");
  }
  const body = value as TokenResponse;
  const expiresAt =
    typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1_000 : Number.NaN;
  if (
    typeof body.access_token !== "string" ||
    body.access_token.length === 0 ||
    body.token_type !== "Bearer" ||
    typeof body.expires_in !== "number" ||
    body.expires_in <= 0 ||
    !Number.isFinite(expiresAt) ||
    (body.refresh_token !== undefined &&
      (typeof body.refresh_token !== "string" ||
        body.refresh_token.length === 0 ||
        body.refresh_token.length > 4_096))
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
    expiresAt,
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

export async function authenticatedApiSession({ refreshIfNeeded = true } = {}): Promise<{
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
  if (refreshIfNeeded && current.expiresAt <= Date.now() + 30_000) {
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
      await oauthPost(
        "revoke",
        new URLSearchParams({
          client_id: extensionConfiguration.clientId,
          token: current.refreshToken,
          token_type_hint: "refresh_token",
        }),
      );
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
