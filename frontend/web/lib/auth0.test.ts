import { describe, expect, it } from "vitest";
import {
  AuthConfigurationError,
  auth0CallbackResponse,
  getAuth0Client,
  isAuth0Configured,
  requestedAuthScopes,
} from "./auth0";

const configuredEnvironment = {
  AUTH0_DOMAIN: "development.example.auth0.com",
  AUTH0_CLIENT_ID: "client-id",
  AUTH0_CLIENT_SECRET: "client-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3000",
  AUTH0_AUDIENCE: "ai-job-apply-api",
};

describe("Auth0 web configuration", () => {
  it("fails closed when a required secret is missing", () => {
    expect(isAuth0Configured({})).toBe(false);
    expect(() => getAuth0Client({})).toThrow(AuthConfigurationError);
  });

  it("accepts a complete localhost development configuration", () => {
    expect(isAuth0Configured(configuredEnvironment)).toBe(true);
    expect(getAuth0Client(configuredEnvironment)).toBeDefined();
  });

  it("requests distinct read and write permissions for candidate job state", () => {
    expect(requestedAuthScopes.split(" ")).toEqual(
      expect.arrayContaining(["jobs:read", "jobs:write"]),
    );
  });

  it("rejects unsafe domains, weak session secrets, and non-local HTTP origins", () => {
    expect(() =>
      getAuth0Client({
        ...configuredEnvironment,
        AUTH0_DOMAIN: "https://development.example.auth0.com",
      }),
    ).toThrow(AuthConfigurationError);
    expect(() => getAuth0Client({ ...configuredEnvironment, AUTH0_SECRET: "too-short" })).toThrow(
      AuthConfigurationError,
    );
    expect(() =>
      getAuth0Client({ ...configuredEnvironment, APP_BASE_URL: "http://example.com" }),
    ).toThrow(AuthConfigurationError);
  });

  it("redirects callback failures without reflecting provider error details", async () => {
    const response = auth0CallbackResponse(
      new Error("provider-controlled error containing sensitive or reflected input"),
      "http://localhost:3000",
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?auth_error=authentication_failed",
    );
    expect(await response.text()).not.toContain("provider-controlled error");
  });
});
