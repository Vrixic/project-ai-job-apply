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

async function readSession(): Promise<StoredSession | undefined> {
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

async function writeSession(session: StoredSession | undefined): Promise<void> {
  if (session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

export async function login(): Promise<void> {
  configured();
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

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    interactive: true,
    url: authorizationUrl.href,
  });
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
  await writeSession(session);
}

export async function refresh(): Promise<void> {
  configured();
  const current = await readSession();
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
  if (replacement.identityFence !== current.identityFence) {
    throw new Error("identity_changed");
  }
  await writeSession({
    ...replacement,
    refreshToken: replacement.refreshToken ?? current.refreshToken,
  });
}

export async function authenticatedApiSession(): Promise<{
  accessToken: string;
  identityFence: string;
}> {
  configured();
  let current = await readSession();
  if (!current) {
    throw new Error("authentication_required");
  }
  if (current.expiresAt <= Date.now() + 30_000) {
    await refresh();
    current = await readSession();
  }
  if (!current || current.expiresAt <= Date.now()) {
    throw new Error("authentication_required");
  }
  return { accessToken: current.accessToken, identityFence: current.identityFence };
}

export async function logout(): Promise<void> {
  configured();
  const current = await readSession();
  try {
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
    const returnTo = chrome.identity.getRedirectURL("auth0");
    const logoutUrl = endpoint("/v2/logout");
    logoutUrl.search = new URLSearchParams({
      client_id: extensionConfiguration.clientId,
      returnTo,
    }).toString();
    await chrome.identity.launchWebAuthFlow({ interactive: true, url: logoutUrl.href });
  } finally {
    await writeSession(undefined);
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
  const session = await readSession();
  return {
    apiConfigured: extensionConfiguration.apiConfigured,
    authenticated: Boolean(session && session.expiresAt > Date.now()),
    configured: true,
    refreshAvailable: Boolean(session?.refreshToken),
  };
}
