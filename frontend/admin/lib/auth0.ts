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
export type AdminAuthorizationProfile = "standard" | "appeals";
let auth0Client: Auth0Client | undefined;
let auth0ClientProfile: AdminAuthorizationProfile | undefined;

const canonicalDnsHostname =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;
const canonicalIpv4Address = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u;
const canonicalIpv6Address = /^\[[0-9a-f:.]+\]$/u;

export const requestedAuthScopes =
  "openid profile jobs:moderate trust:review trust:case:open trust:case:decide trust:case:takedown trust:appeal:resolve";
export const appealAuthScopes = "openid profile trust:review trust:appeal:resolve";
export const adminMfaAcr = "http://schemas.openid.net/pape/policies/2007/06/multi-factor";
export const adminReauthenticationSeconds = 15 * 60;
export const adminAbsoluteSessionSeconds = 60 * 60;

/** Server configuration narrows the requested scopes and UI; it never assigns reviewer roles. */
export function getAdminAuthorizationProfile(
  environment: Environment = process.env,
): AdminAuthorizationProfile {
  const profile = environment.ADMIN_AUTHORIZATION_PROFILE;
  if (profile === undefined || profile === "standard") return "standard";
  if (profile === "appeals") return "appeals";
  throw new Error("ADMIN_AUTHORIZATION_PROFILE must be standard or appeals");
}

export function isAuth0Configured(environment: Environment = process.env): boolean {
  getAdminAuthorizationProfile(environment);
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
    throw new Error("AUTH0_DOMAIN must be an exact HTTPS issuer hostname");
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
    throw new Error("AUTH0_DOMAIN must be an exact HTTPS issuer hostname");
  }
  return value;
}

export function validateAppBaseUrl(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("APP_BASE_URL must be an exact HTTP(S) origin");
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
    throw new Error("APP_BASE_URL must be an exact HTTP(S) origin");
  }
  return value;
}

export function requireAdminMfa<T extends { user: Record<string, unknown> }>(session: T): T {
  if (!Array.isArray(session.user.amr) || !session.user.amr.includes("mfa")) {
    throw new Error("Admin authentication did not prove MFA");
  }
  return session;
}

export function getAuth0Client(environment: Environment = process.env): Auth0Client {
  const authorizationProfile = getAdminAuthorizationProfile(environment);
  if (environment === process.env && auth0Client && auth0ClientProfile === authorizationProfile)
    return auth0Client;
  if (!isAuth0Configured(environment)) throw new Error("Admin Auth0 is not configured");
  const domain = validateAuth0Domain(environment.AUTH0_DOMAIN as string);
  const secret = environment.AUTH0_SECRET as string;
  const appBaseUrl = validateAppBaseUrl(environment.APP_BASE_URL as string);
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("AUTH0_SECRET is invalid");
  const client = new Auth0Client({
    domain,
    clientId: environment.AUTH0_CLIENT_ID as string,
    clientSecret: environment.AUTH0_CLIENT_SECRET as string,
    secret,
    appBaseUrl,
    authorizationParameters: {
      audience: environment.AUTH0_AUDIENCE?.trim() || "ai-job-apply-api",
      scope: authorizationProfile === "appeals" ? appealAuthScopes : requestedAuthScopes,
      acr_values: adminMfaAcr,
      max_age: adminReauthenticationSeconds,
    },
    session: {
      rolling: true,
      inactivityDuration: adminReauthenticationSeconds,
      absoluteDuration: adminAbsoluteSessionSeconds,
    },
    beforeSessionSaved: async (session) => requireAdminMfa(session),
    enableAccessTokenEndpoint: false,
    logoutStrategy: "oidc",
    onCallback: async (error) => {
      const target = new URL("/", appBaseUrl);
      if (error) target.searchParams.set("auth_error", "authentication_failed");
      return NextResponse.redirect(target);
    },
    signInReturnToPath: "/",
  });
  if (environment === process.env) {
    auth0Client = client;
    auth0ClientProfile = authorizationProfile;
  }
  return client;
}
