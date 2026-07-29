import { describe, expect, it } from "vitest";
import { mobilePublicConfiguration } from "../lib/config";
import { sanitizedAuthMessage } from "../lib/errors";

describe("mobile public authentication configuration", () => {
  it("fails closed without the exact public client settings", () => {
    expect(mobilePublicConfiguration({}).configured).toBe(false);
    expect(
      mobilePublicConfiguration({
        EXPO_PUBLIC_AUTH0_AUDIENCE: "wrong-api",
        EXPO_PUBLIC_AUTH0_CLIENT_ID: "public-client",
        EXPO_PUBLIC_AUTH0_DOMAIN: "tenant.example.test",
      }).configured,
    ).toBe(false);
  });

  it("accepts a domain, public client ID, and exact API audience", () => {
    expect(
      mobilePublicConfiguration({
        EXPO_PUBLIC_AUTH0_AUDIENCE: "ai-job-apply-api",
        EXPO_PUBLIC_AUTH0_CLIENT_ID: "public-client",
        EXPO_PUBLIC_AUTH0_DOMAIN: "tenant.example.test",
      }),
    ).toMatchObject({
      audience: "ai-job-apply-api",
      configured: true,
    });
  });

  it("does not echo provider error details into the UI", () => {
    expect(sanitizedAuthMessage(new Error("token abc candidate@example.test"), "login")).toBe(
      "Auth0 login did not complete.",
    );
    expect(sanitizedAuthMessage({ code: "a0.session.user_cancelled" }, "login")).toBe(
      "Login cancelled.",
    );
  });
});
