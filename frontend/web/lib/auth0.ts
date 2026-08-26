import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

const requiredKeys = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
] as const;

type Environment = Record<string, string | undefined>;

let auth0Client: Auth0Client | undefined;

const canonicalDnsHostname =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;
const canonicalIpv4Address = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u;
const canonicalIpv6Address = /^\[[0-9a-f:.]+\]$/u;

export const requestedAuthScopes =
  "openid profile email offline_access documents:read documents:write jobs:read jobs:write profile:read profile:write";

export const candidateRightsReauthenticationPath =
  "/auth/login?returnTo=%2F&max_age=0&acr_values=http%3A%2F%2Fschemas.openid.net%2Fpape%2Fpolicies%2F2007%2F06%2Fmulti-factor";

export class AuthConfigurationError extends Error {
  constructor(message = "Auth0 is not configured") {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function isAuth0Configured(environment: Environment = process.env): boolean {
  return requiredKeys.every((key) => Boolean(environment[key]?.trim()));
}

function applicationHostnameIsCanonical(hostname: string): boolean {
  return (
    canonicalDnsHostname.test(hostname) ||
    canonicalIpv4Address.test(hostname) ||
    canonicalIpv6Address.test(hostname)
  );
}

export function validateAuth0Domain(value: string): string {
  let issuer: URL;
  try {
    issuer = new URL(`https://${value}`);
  } catch {
    throw new AuthConfigurationError("AUTH0_DOMAIN must be an exact HTTPS issuer hostname");
  }
  if (
    value !== value.trim() ||
    value.endsWith(".") ||
    !canonicalDnsHostname.test(value) ||
    issuer.protocol !== "https:" ||
    issuer.username !== "" ||
    issuer.password !== "" ||
    issuer.port !== "" ||
    issuer.pathname !== "/" ||
    issuer.search !== "" ||
    issuer.hash !== "" ||
    issuer.hostname !== value ||
    issuer.origin !== `https://${value}`
  ) {
    throw new AuthConfigurationError("AUTH0_DOMAIN must be an exact HTTPS issuer hostname");
  }
  return value;
}

export function validateAppBaseUrl(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new AuthConfigurationError("APP_BASE_URL must be an exact HTTP(S) origin");
  }
  const localHttp =
    origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (
    value !== value.trim() ||
    (origin.protocol !== "https:" && !localHttp) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.hostname.endsWith(".") ||
    !applicationHostnameIsCanonical(origin.hostname) ||
    origin.origin !== value
  ) {
    throw new AuthConfigurationError("APP_BASE_URL must be an exact HTTP(S) origin");
  }
  return value;
}

export function auth0CallbackResponse(error: unknown, appBaseUrl: string): NextResponse {
  const target = new URL("/", appBaseUrl);
  if (error) {
    target.searchParams.set("auth_error", "authentication_failed");
  }
  return NextResponse.redirect(target);
}

export function getAuth0Client(environment: Environment = process.env): Auth0Client {
  if (environment === process.env && auth0Client) {
    return auth0Client;
  }
  if (!isAuth0Configured(environment)) {
    throw new AuthConfigurationError();
  }

  const domain = validateAuth0Domain(environment.AUTH0_DOMAIN as string);
  const clientId = environment.AUTH0_CLIENT_ID as string;
  const clientSecret = environment.AUTH0_CLIENT_SECRET as string;
  const secret = environment.AUTH0_SECRET as string;
  const appBaseUrl = validateAppBaseUrl(environment.APP_BASE_URL as string);
  const audience = environment.AUTH0_AUDIENCE?.trim() || "ai-job-apply-api";

  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    throw new AuthConfigurationError("AUTH0_SECRET must be a 32-byte hexadecimal value");
  }

  const client = new Auth0Client({
    domain,
    clientId,
    clientSecret,
    secret,
    appBaseUrl,
    authorizationParameters: {
      audience,
      scope: requestedAuthScopes,
    },
    enableAccessTokenEndpoint: false,
    logoutStrategy: "oidc",
    onCallback: async (error) => auth0CallbackResponse(error, appBaseUrl),
    signInReturnToPath: "/",
  });

  if (environment === process.env) {
    auth0Client = client;
  }
  return client;
}
