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
        const authenticationMethods =
          Array.isArray(payload.amr) &&
          payload.amr.length <= 16 &&
          payload.amr.every(
            (value): value is string =>
              typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value),
          )
            ? payload.amr
            : undefined;

        return {
          issuer: payload.iss,
          subject: payload.sub,
          audience,
          scopes,
          ...(typeof payload.email === "string" ? { email: payload.email } : {}),
          ...(typeof payload.sid === "string" ? { sessionId: payload.sid } : {}),
          ...(typeof payload.auth_time === "number" &&
          Number.isSafeInteger(payload.auth_time) &&
          payload.auth_time > 0
            ? { authenticatedAt: payload.auth_time }
            : {}),
          ...(authenticationMethods && authenticationMethods.length > 0
            ? { authenticationMethods }
            : {}),
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

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    throw new AuthenticationError("A bearer access token is required");
  }
  return match[1];
}
