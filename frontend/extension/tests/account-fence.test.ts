import { describe, expect, it } from "vitest";
import { ACCOUNT_FENCE_VERSION, accountFenceFromAccessToken } from "../lib/account-fence";

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function token(overrides: Record<string, unknown> = {}): string {
  return [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      aud: "ai-job-apply-api",
      azp: "extension-native-client",
      exp: Math.floor(Date.now() / 1_000) + 3_600,
      iss: "https://tenant.example.test/",
      sub: "auth0|candidate-one",
      ...overrides,
    }),
    "test-signature",
  ].join(".");
}

function fence(accessToken: string) {
  return accountFenceFromAccessToken({
    accessToken,
    audience: "ai-job-apply-api",
    clientId: "extension-native-client",
    issuer: "https://tenant.example.test/",
  });
}

describe("pseudonymous Auth0 account fence", () => {
  it("is stable for one account and distinct for another without retaining the subject", async () => {
    const first = await fence(token({ jti: "first" }));
    const reauthenticated = await fence(token({ jti: "second" }));
    const different = await fence(token({ sub: "auth0|candidate-two" }));

    expect(ACCOUNT_FENCE_VERSION).toBe("auth0-subject-sha256-v1");
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(reauthenticated).toBe(first);
    expect(different).not.toBe(first);
    expect(first).not.toContain("candidate-one");
  });

  it.each([
    ["opaque token", "opaque-token"],
    ["wrong issuer", token({ iss: "https://other.example.test/" })],
    ["wrong audience", token({ aud: "other-api" })],
    ["wrong authorized party", token({ azp: "other-client" })],
    ["expired token", token({ exp: Math.floor(Date.now() / 1_000) - 1 })],
    ["missing subject", token({ sub: undefined })],
    ["control-bearing subject", token({ sub: "candidate\u0000one" })],
  ])("rejects a %s before creating an account fence", async (_scenario, accessToken) => {
    await expect(fence(accessToken)).rejects.toThrow("invalid_token_identity");
  });
});
