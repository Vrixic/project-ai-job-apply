import { describe, expect, it } from "vitest";
import { extensionPublicConfiguration } from "../lib/config";
import { pkceChallenge, validateAuthorizationCallback } from "../lib/pkce";

describe("extension public-client authentication", () => {
  it("uses the RFC 7636 S256 challenge", async () => {
    await expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("requires the exact callback URL and state before accepting a code", () => {
    const redirect = "https://abcdefghijklmnop.chromiumapp.org/auth0";
    expect(
      validateAuthorizationCallback({
        callbackUrl: `${redirect}?code=short-lived-code&state=expected`,
        expectedRedirectUri: redirect,
        expectedState: "expected",
      }),
    ).toBe("short-lived-code");
    expect(() =>
      validateAuthorizationCallback({
        callbackUrl: "https://abcdefghijklmnop.chromiumapp.org/other?code=code&state=expected",
        expectedRedirectUri: redirect,
        expectedState: "expected",
      }),
    ).toThrow();
    expect(() =>
      validateAuthorizationCallback({
        callbackUrl: `${redirect}?code=code&state=wrong`,
        expectedRedirectUri: redirect,
        expectedState: "expected",
      }),
    ).toThrow();
  });

  it("fails closed without an exact audience and safe public settings", () => {
    expect(
      extensionPublicConfiguration({
        audience: "wrong-api",
        clientId: "public-client",
        domain: "tenant.example.test",
      }).configured,
    ).toBe(false);
    expect(
      extensionPublicConfiguration({
        audience: "ai-job-apply-api",
        clientId: "public-client",
        domain: "https://tenant.example.test",
      }).configured,
    ).toBe(false);
    expect(
      extensionPublicConfiguration({
        audience: "ai-job-apply-api",
        clientId: "public-client",
        domain: "tenant.example.test",
      }).configured,
    ).toBe(true);
  });
});
