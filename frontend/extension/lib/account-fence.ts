const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const MAXIMUM_ACCESS_TOKEN_LENGTH = 16_384;
const MAXIMUM_CLAIM_BYTES = 8_192;

interface AccessTokenClaims {
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iss?: unknown;
  sub?: unknown;
}

function decodeBase64Url(value: string): string {
  if (!JWT_SEGMENT.test(value) || value.length > MAXIMUM_CLAIM_BYTES * 2) {
    throw new Error("invalid_token_identity");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    throw new Error("invalid_token_identity");
  }
  if (binary.length === 0 || binary.length > MAXIMUM_CLAIM_BYTES) {
    throw new Error("invalid_token_identity");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    throw new Error("invalid_token_identity");
  }
}

function tokenClaims(accessToken: string): AccessTokenClaims {
  if (accessToken.length === 0 || accessToken.length > MAXIMUM_ACCESS_TOKEN_LENGTH) {
    throw new Error("invalid_token_identity");
  }
  const segments = accessToken.split(".");
  if (segments.length !== 3 || segments.some((segment) => !JWT_SEGMENT.test(segment))) {
    throw new Error("invalid_token_identity");
  }
  try {
    const claims = JSON.parse(decodeBase64Url(segments[1] ?? "")) as unknown;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new Error("invalid_token_identity");
    }
    return claims as AccessTokenClaims;
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_token_identity") throw error;
    throw new Error("invalid_token_identity");
  }
}

function audiences(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 10 &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value;
  }
  throw new Error("invalid_token_identity");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export const ACCOUNT_FENCE_VERSION = "auth0-subject-sha256-v1";

export async function accountFenceFromAccessToken(input: {
  accessToken: string;
  audience: string;
  clientId: string;
  issuer: string;
  now?: Date;
}): Promise<string> {
  const claims = tokenClaims(input.accessToken);
  const subject = claims.sub;
  const expectedIssuer = input.issuer;
  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > 256 ||
    [...subject].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    }) ||
    claims.iss !== expectedIssuer ||
    !audiences(claims.aud).includes(input.audience) ||
    (claims.azp !== undefined && claims.azp !== input.clientId) ||
    !Number.isSafeInteger(claims.exp) ||
    (claims.exp as number) * 1_000 <= (input.now ?? new Date()).getTime()
  ) {
    throw new Error("invalid_token_identity");
  }
  const canonical = [
    ACCOUNT_FENCE_VERSION,
    expectedIssuer,
    input.audience,
    input.clientId,
    subject,
    "",
  ].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64Url(new Uint8Array(digest));
}
