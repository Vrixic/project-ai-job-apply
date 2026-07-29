import { extensionConfiguration } from "./config";
import { pkceChallenge, randomBase64Url, validateAuthorizationCallback } from "./pkce";

const SESSION_KEY = "auth0Session";
const REQUIRED_SCOPE = "openid profile email offline_access profile:read profile:write";

interface StoredSession {
  accessToken: string;
  expiresAt: number;
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
    !["profile:read", "profile:write"].every((scope) => grantedScopes.includes(scope))
  ) {
    throw new Error("required_scope_missing");
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1_000,
    ...(typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? { refreshToken: body.refresh_token }
      : {}),
  };
}

async function readSession(): Promise<StoredSession | undefined> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] as StoredSession | undefined;
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
  await writeSession({
    ...replacement,
    refreshToken: replacement.refreshToken ?? current.refreshToken,
  });
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
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
}> {
  if (!extensionConfiguration.configured) {
    return { authenticated: false, configured: false, refreshAvailable: false };
  }
  const session = await readSession();
  return {
    authenticated: Boolean(session && session.expiresAt > Date.now()),
    configured: true,
    refreshAvailable: Boolean(session?.refreshToken),
  };
}
