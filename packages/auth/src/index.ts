import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthPrincipal {
  issuer: string;
  subject: string;
  audience: string[];
  scopes: string[];
  email?: string;
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

export interface IdTokenVerifier {
  verify(idToken: string): Promise<IdTokenProof>;
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
  };
}

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    throw new AuthenticationError("A bearer access token is required");
  }
  return match[1];
}
