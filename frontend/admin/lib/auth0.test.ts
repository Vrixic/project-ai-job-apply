import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminMfaRequiredError,
  adminAbsoluteSessionSeconds,
  adminMfaAcr,
  adminReauthenticationSeconds,
  appealAuthScopes,
  getAdminAuthorizationProfile,
  getAuth0Client,
  isAuth0Configured,
  requestedAuthScopes,
  requireAdminMfa,
  validateAppBaseUrl,
  validateAuth0Domain,
} from "./auth0.js";

const { auth0Constructor } = vi.hoisted(() => ({
  auth0Constructor: vi.fn(function (this: object, _options: unknown) {
    return this;
  }),
}));
vi.mock("@auth0/nextjs-auth0/server", () => ({ Auth0Client: auth0Constructor }));

const configuredEnvironment = {
  AUTH0_DOMAIN: "development.example.auth0.com",
  AUTH0_CLIENT_ID: "admin-client-id",
  AUTH0_CLIENT_SECRET: "admin-client-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3001",
  AUTH0_AUDIENCE: "ai-job-apply-api",
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("admin Auth0 policy constants", () => {
  it("preserves the standard short-session MFA candidate", () => {
    expect(requestedAuthScopes).toBe(
      "openid profile jobs:moderate trust:review trust:case:open trust:case:decide trust:case:takedown trust:appeal:resolve",
    );
    expect(requestedAuthScopes).not.toContain("offline_access");
    expect(requestedAuthScopes).not.toContain("trust:requester:takedown");
    expect(adminMfaAcr).toBe("http://schemas.openid.net/pape/policies/2007/06/multi-factor");
    expect(adminReauthenticationSeconds).toBe(900);
    expect(adminAbsoluteSessionSeconds).toBe(3_600);
  });

  it("fails closed unless the identity-provider session proves MFA", () => {
    expect(() => requireAdminMfa({ user: {} })).toThrow(AdminMfaRequiredError);
    expect(() => requireAdminMfa({ user: {} })).toThrow("did not prove MFA");
    expect(() => requireAdminMfa({ user: { amr: ["pwd"] } })).toThrow("did not prove MFA");
    const session = { user: { amr: ["pwd", "mfa"] } };
    expect(requireAdminMfa(session)).toBe(session);
  });

  it.each([undefined, null, "mfa", [], ["pwd"], ["MFA"]])(
    "returns only a fixed typed failure for missing or invalid MFA proof %j",
    (amr) => {
      try {
        requireAdminMfa({ user: { amr, sub: "synthetic-private-subject" } });
        expect.fail("Missing MFA must not create an admin session");
      } catch (error) {
        expect(error).toBeInstanceOf(AdminMfaRequiredError);
        expect((error as Error).message).toBe("Admin authentication did not prove MFA");
        expect(String(error)).not.toContain("synthetic-private-subject");
      }
    },
  );

  it("accepts a complete localhost configuration", () => {
    expect(isAuth0Configured(configuredEnvironment)).toBe(true);
    expect(getAuth0Client(configuredEnvironment)).toBeDefined();
  });

  it.each([
    [undefined, "standard", requestedAuthScopes],
    ["standard", "standard", requestedAuthScopes],
    ["appeals", "appeals", "openid profile trust:review trust:appeal:resolve"],
  ] as const)(
    "passes the exact %s authorization profile and unchanged MFA controls to Auth0",
    async (configuredProfile, expectedProfile, expectedScopes) => {
      const environment = {
        ...configuredEnvironment,
        ADMIN_AUTHORIZATION_PROFILE: configuredProfile,
      };
      expect(getAdminAuthorizationProfile(environment)).toBe(expectedProfile);
      getAuth0Client(environment);
      expect(auth0Constructor).toHaveBeenCalledOnce();
      const options = auth0Constructor.mock.calls[0]?.[0] as {
        beforeSessionSaved(session: { user: Record<string, unknown> }): Promise<unknown>;
      };
      expect(options).toMatchObject({
        authorizationParameters: {
          audience: "ai-job-apply-api",
          scope: expectedScopes,
          acr_values: adminMfaAcr,
          max_age: 900,
        },
        session: { rolling: true, inactivityDuration: 900, absoluteDuration: 3600 },
        enableAccessTokenEndpoint: false,
        logoutStrategy: "oidc",
      });
      await expect(options.beforeSessionSaved({ user: { amr: ["pwd"] } })).rejects.toThrow(
        "did not prove MFA",
      );
      const mfaSession = { user: { amr: ["pwd", "mfa"] } };
      await expect(options.beforeSessionSaved(mfaSession)).resolves.toBe(mfaSession);
    },
  );

  it("requests no initial, takedown, case-opening, moderator, or offline scopes for appeals", () => {
    expect(appealAuthScopes.split(" ")).toEqual([
      "openid",
      "profile",
      "trust:review",
      "trust:appeal:resolve",
    ]);
  });

  it.each(["", "APPEALS", "appeals ", " standard", "all", "initial_reviewer"])(
    "fails closed for invalid authorization profile %j",
    (profile) => {
      const environment = { ...configuredEnvironment, ADMIN_AUTHORIZATION_PROFILE: profile };
      for (const resolve of [getAdminAuthorizationProfile, isAuth0Configured, getAuth0Client]) {
        expect(() => resolve(environment)).toThrow(
          "ADMIN_AUTHORIZATION_PROFILE must be standard or appeals",
        );
      }
      expect(auth0Constructor).not.toHaveBeenCalled();
    },
  );

  it("does not reuse a broader cached client when the server profile changes or becomes invalid", () => {
    for (const [key, value] of Object.entries(configuredEnvironment)) vi.stubEnv(key, value);
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "standard");
    const standard = getAuth0Client();
    expect(getAuth0Client()).toBe(standard);
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "appeals");
    expect(getAuth0Client()).not.toBe(standard);
    expect(auth0Constructor).toHaveBeenCalledTimes(2);
    expect(auth0Constructor.mock.calls[1]?.[0]).toMatchObject({
      authorizationParameters: { scope: appealAuthScopes },
    });
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "invalid");
    expect(() => getAuth0Client()).toThrow(
      "ADMIN_AUTHORIZATION_PROFILE must be standard or appeals",
    );
    expect(auth0Constructor).toHaveBeenCalledTimes(2);
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
