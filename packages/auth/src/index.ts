import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthPrincipal {
  issuer: string;
  subject: string;
  audience: string[];
  scopes: string[];
  email?: string;
  /** The account address from a verified ID token proof; never taken from an access token. */
  verifiedEmail?: string;
  sessionId?: string;
  authenticatedAt?: number;
  authenticationMethods?: string[];
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthPrincipal>;
}

export interface IdTokenProof {
  issuer: string;
  subject: string;
  audience: string[];
  authenticatedAt: number;
  authenticationMethods: string[];
}

/** Who a session ID token names. It carries no recent-authentication evidence. */
export interface AccountIdentityProof {
  issuer: string;
  subject: string;
  /** The account address, present only when the identity provider states it is verified. */
  verifiedEmail?: string;
}

export interface IdTokenVerifier {
  verify(idToken: string): Promise<IdTokenProof>;
  /**
   * Signature, issuer, one exact client audience and expiry only. An ordinary sign-in ID token has
   * no `auth_time` or `amr`, so this must not demand them the way `verify` does.
   */
  verifyIdentity(idToken: string): Promise<AccountIdentityProof>;
}

export class AuthenticationError extends Error {
  constructor(message = "The access token is invalid") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function createOidcVerifier(options: {
  issuer: string;
  audience: string;
  /** Direct transports without an upstream JWT authorizer must require expiration. */
  requireExpiration?: boolean;
}): AccessTokenVerifier {
  const issuer = new URL(options.issuer);
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

  return {
    async verify(accessToken: string): Promise<AuthPrincipal> {
      try {
        const { payload } = await jwtVerify(accessToken, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
          ...(options.requireExpiration ? { requiredClaims: ["exp"] } : {}),
        });
        if (!payload.sub || !payload.iss) {
          throw new AuthenticationError("The token is missing required identity claims");
        }
        const scopes =
          typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
        const audience = Array.isArray(payload.aud)
          ? payload.aud
          : payload.aud
            ? [payload.aud]
            : [];
        return {
          issuer: payload.iss,
          subject: payload.sub,
          audience,
          scopes,
          ...(typeof payload.email === "string" ? { email: payload.email } : {}),
          ...(typeof payload.sid === "string" ? { sessionId: payload.sid } : {}),
        };
      } catch (error) {
        if (error instanceof AuthenticationError) {
          throw error;
        }
        throw new AuthenticationError();
      }
    },
  };
}

export function createOidcIdTokenVerifier(options: {
  issuer: string;
  audience: string;
}): IdTokenVerifier {
  const issuer = new URL(options.issuer);
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

  return {
    async verify(idToken: string): Promise<IdTokenProof> {
      try {
        const { payload } = await jwtVerify(idToken, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "auth_time"],
        });
        if (!payload.sub || !payload.iss) {
          throw new AuthenticationError("The ID token is missing required identity claims");
        }
        const audience = Array.isArray(payload.aud)
          ? payload.aud
          : payload.aud
            ? [payload.aud]
            : [];
        if (audience.length !== 1 || audience[0] !== options.audience) {
          throw new AuthenticationError("The ID token audience is invalid");
        }
        if (
          typeof payload.auth_time !== "number" ||
          !Number.isSafeInteger(payload.auth_time) ||
          payload.auth_time <= 0
        ) {
          throw new AuthenticationError("The ID token is missing valid authentication time");
        }
        if (
          !Array.isArray(payload.amr) ||
          payload.amr.length === 0 ||
          payload.amr.length > 16 ||
          !payload.amr.every(
            (value): value is string =>
              typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value),
          )
        ) {
          throw new AuthenticationError("The ID token is missing valid authentication methods");
        }

        return {
          issuer: payload.iss,
          subject: payload.sub,
          audience,
          authenticatedAt: payload.auth_time,
          authenticationMethods: payload.amr,
        };
      } catch (error) {
        if (error instanceof AuthenticationError) {
          throw error;
        }
        throw new AuthenticationError("The ID token is invalid");
      }
    },
    async verifyIdentity(idToken: string): Promise<AccountIdentityProof> {
      try {
        const { payload } = await jwtVerify(idToken, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat"],
        });
        if (!payload.sub || !payload.iss) {
          throw new AuthenticationError("The ID token is missing required identity claims");
        }
        const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (audience.length !== 1 || audience[0] !== options.audience) {
          throw new AuthenticationError("The ID token audience is invalid");
        }
        return {
          issuer: payload.iss,
          subject: payload.sub,
          ...(payload.email_verified === true &&
          typeof payload.email === "string" &&
          payload.email.length <= 254
            ? { verifiedEmail: payload.email }
            : {}),
        };
      } catch (error) {
        if (error instanceof AuthenticationError) {
          throw error;
        }
        throw new AuthenticationError("The ID token is invalid");
      }
    },
  };
}

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    throw new AuthenticationError("A bearer access token is required");
  }
  return match[1];
}
