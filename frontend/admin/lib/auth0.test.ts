import { describe, expect, it } from "vitest";
import {
  adminAbsoluteSessionSeconds,
  adminMfaAcr,
  adminReauthenticationSeconds,
  getAuth0Client,
  isAuth0Configured,
  requestedAuthScopes,
  requireAdminMfa,
  validateAppBaseUrl,
  validateAuth0Domain,
} from "./auth0.js";

const configuredEnvironment = {
  AUTH0_DOMAIN: "development.example.auth0.com",
  AUTH0_CLIENT_ID: "admin-client-id",
  AUTH0_CLIENT_SECRET: "admin-client-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3001",
  AUTH0_AUDIENCE: "ai-job-apply-api",
};

describe("admin Auth0 policy constants", () => {
  it("freezes the least-privilege short-session MFA candidate", () => {
    expect(requestedAuthScopes).toBe("openid profile jobs:moderate");
    expect(requestedAuthScopes).not.toContain("offline_access");
    expect(adminMfaAcr).toBe("http://schemas.openid.net/pape/policies/2007/06/multi-factor");
    expect(adminReauthenticationSeconds).toBe(900);
    expect(adminAbsoluteSessionSeconds).toBe(3_600);
  });

  it("fails closed unless the identity-provider session proves MFA", () => {
    expect(() => requireAdminMfa({ user: {} })).toThrow("did not prove MFA");
    expect(() => requireAdminMfa({ user: { amr: ["pwd"] } })).toThrow("did not prove MFA");
    const session = { user: { amr: ["pwd", "mfa"] } };
    expect(requireAdminMfa(session)).toBe(session);
  });

  it("accepts a complete localhost configuration", () => {
    expect(isAuth0Configured(configuredEnvironment)).toBe(true);
    expect(getAuth0Client(configuredEnvironment)).toBeDefined();
  });

  it("accepts only an exact canonical Auth0 HTTPS issuer hostname", () => {
    expect(validateAuth0Domain("development.example.auth0.com")).toBe(
      "development.example.auth0.com",
    );
    for (const domain of [
      "https://development.example.auth0.com",
      "development.example.auth0.com/tenant",
      "development.example.auth0.com?connection=test",
      "development.example.auth0.com#fragment",
      "operator@development.example.auth0.com",
      "development.example.auth0.com:443",
      "development.example.auth0.com.",
      "Development.example.auth0.com",
      "bad_host.example.auth0.com",
      " development.example.auth0.com",
    ]) {
      expect(() => validateAuth0Domain(domain), domain).toThrow(
        "AUTH0_DOMAIN must be an exact HTTPS issuer hostname",
      );
    }
  });

  it("accepts only an exact canonical application origin", () => {
    expect(validateAppBaseUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(validateAppBaseUrl("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(validateAppBaseUrl("https://admin.example.test")).toBe("https://admin.example.test");
    for (const origin of [
      "http://admin.example.test",
      "https://operator:secret@admin.example.test",
      "https://admin.example.test/path",
      "https://admin.example.test?mode=test",
      "https://admin.example.test#fragment",
      "https://admin.example.test/",
      "https://admin.example.test.",
      "https://bad_host.example.test",
      " https://admin.example.test",
    ]) {
      expect(() => validateAppBaseUrl(origin), origin).toThrow(
        "APP_BASE_URL must be an exact HTTP(S) origin",
      );
    }
  });
});
