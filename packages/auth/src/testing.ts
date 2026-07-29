import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import type { AccessTokenVerifier, AuthPrincipal } from "./index.js";

export interface TestTokenIssuer {
  issue(subject: string, claims?: { email?: string; scope?: string }): Promise<string>;
  verifier: AccessTokenVerifier;
  jwk: Record<string, unknown>;
}

export async function createTestTokenIssuer(): Promise<TestTokenIssuer> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The test token issuer is disabled outside NODE_ENV=test");
  }

  const issuer = "https://test-issuer.invalid/";
  const audience = "ai-job-apply-api";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = (await exportJWK(publicKey)) as Record<string, unknown>;

  return {
    jwk,
    async issue(subject, claims = {}) {
      return new SignJWT({
        ...(claims.email ? { email: claims.email } : {}),
        scope: claims.scope ?? "profile:read profile:write",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    },
    verifier: {
      async verify(accessToken): Promise<AuthPrincipal> {
        const { payload } = await jwtVerify(accessToken, publicKey, {
          issuer,
          audience,
          algorithms: ["RS256"],
        });
        if (!payload.sub || !payload.iss) {
          throw new Error("Test token is missing required claims");
        }
        return {
          issuer: payload.iss,
          subject: payload.sub,
          audience: [audience],
          scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
          ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        };
      },
    },
  };
}
