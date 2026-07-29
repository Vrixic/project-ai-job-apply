import { describe, expect, it, vi } from "vitest";
import { forceWebSessionRenewal, isLocalAuth0ConformanceEnabled } from "./auth0-conformance";

const request = new Request("http://localhost:3000/api/auth-conformance/refresh", {
  method: "POST",
  headers: { origin: "http://localhost:3000" },
});

describe("Auth0 web refresh conformance", () => {
  it("is available only while the web application runs in development mode", () => {
    expect(isLocalAuth0ConformanceEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isLocalAuth0ConformanceEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isLocalAuth0ConformanceEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("hides the route when conformance mode is disabled", async () => {
    const response = await forceWebSessionRenewal(request, {
      appBaseUrl: "http://localhost:3000",
      auth0: {
        getSession: vi.fn(),
        getAccessToken: vi.fn(),
      },
      enabled: false,
    });

    expect(response.status).toBe(404);
  });

  it("rejects a cross-origin request before reading the session", async () => {
    const getSession = vi.fn();
    const response = await forceWebSessionRenewal(
      new Request(request.url, {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      }),
      {
        appBaseUrl: "http://localhost:3000",
        auth0: {
          getSession,
          getAccessToken: vi.fn(),
        },
        enabled: true,
      },
    );

    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("forces a server-side refresh without returning token material", async () => {
    const getAccessToken = vi.fn(async () => ({
      token: "must-not-cross-the-server-boundary",
      expiresAt: 123,
    }));
    const response = await forceWebSessionRenewal(request, {
      appBaseUrl: "http://localhost:3000",
      auth0: {
        getSession: async () => ({ user: { sub: "synthetic-user" } }),
        getAccessToken,
      },
      enabled: true,
    });

    expect(response.status).toBe(200);
    expect(getAccessToken).toHaveBeenCalledWith({ refresh: true });
    expect(await response.json()).toEqual({
      state: "renewed",
      message: "The server-held session renewed successfully",
    });
  });

  it("fails closed with a sanitized reauthentication response after revocation", async () => {
    const response = await forceWebSessionRenewal(request, {
      appBaseUrl: "http://localhost:3000",
      auth0: {
        getSession: async () => ({ user: { sub: "synthetic-user" } }),
        getAccessToken: async () => {
          throw new Error("provider response containing restricted token details");
        },
      },
      enabled: true,
    });

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("restricted token details");
  });
});
