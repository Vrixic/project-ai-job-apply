#!/usr/bin/env node

function usage() {
  console.log(`Usage:
  node scripts/verify-auth0-tenant.mjs --issuer https://TENANT.us.auth0.com/

The issuer may instead be supplied through OIDC_ISSUER. This performs read-only checks against
public OIDC discovery and JWKS endpoints. It never reads client secrets or tokens.`);
}

function issuerArgument(argumentsList) {
  const index = argumentsList.indexOf("--issuer");
  if (index >= 0) {
    return argumentsList[index + 1];
  }
  return process.env.OIDC_ISSUER;
}

if (process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const issuerValue = issuerArgument(process.argv.slice(2));
if (!issuerValue) {
  usage();
  process.exitCode = 2;
} else {
  const issuer = new URL(issuerValue);
  if (issuer.protocol !== "https:" || !issuer.pathname.endsWith("/")) {
    throw new Error("The issuer must be an HTTPS URL ending with a slash");
  }

  const discoveryUrl = new URL(".well-known/openid-configuration", issuer);
  const discoveryResponse = await fetch(discoveryUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!discoveryResponse.ok) {
    throw new Error(`OIDC discovery failed with HTTP ${discoveryResponse.status}`);
  }
  const discovery = await discoveryResponse.json();
  const jwksUrl = new URL(discovery.jwks_uri);
  const jwksResponse = await fetch(jwksUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!jwksResponse.ok) {
    throw new Error(`JWKS retrieval failed with HTTP ${jwksResponse.status}`);
  }
  const jwks = await jwksResponse.json();

  const checks = {
    exactIssuer: discovery.issuer === issuer.href,
    authorizationCode: discovery.response_types_supported?.includes("code") === true,
    pkceS256: discovery.code_challenge_methods_supported?.includes("S256") === true,
    rs256: discovery.id_token_signing_alg_values_supported?.includes("RS256") === true,
    httpsAuthorizationEndpoint: new URL(discovery.authorization_endpoint).protocol === "https:",
    httpsTokenEndpoint: new URL(discovery.token_endpoint).protocol === "https:",
    httpsJwksEndpoint: jwksUrl.protocol === "https:",
    rsaSigningKey:
      Array.isArray(jwks.keys) &&
      jwks.keys.some(
        (key) => key.kty === "RSA" && key.use === "sig" && typeof key.kid === "string",
      ),
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  console.log(
    JSON.stringify(
      {
        status: failures.length === 0 ? "passed" : "failed",
        issuerHost: issuer.host,
        checks,
        signingKeyCount: Array.isArray(jwks.keys) ? jwks.keys.length : 0,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
