import { describe, expect, it, vi } from "vitest";
import { forwardPlatformRequest } from "./platform-api";

describe("platform BFF", () => {
  it("rejects missing sessions without contacting the platform API", async () => {
    const platformFetch = vi.fn<typeof fetch>();
    const response = await forwardPlatformRequest(
      "/v1/me",
      { method: "GET" },
      {
        auth0: {
          getSession: async () => null,
          getAccessToken: async () => ({ token: "should-not-be-used" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
      },
    );

    expect(response.status).toBe(401);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("adds the server-held token and returns only approved response headers", async () => {
    const platformFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-token");
      return new Response(JSON.stringify({ id: "candidate-id" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "must-not-cross-the-bff=1",
          "x-correlation-id": "correlation-id",
        },
      });
    });
    const response = await forwardPlatformRequest(
      "/v1/me",
      { method: "GET" },
      {
        auth0: {
          getSession: async () => ({ user: { sub: "synthetic-user" } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("correlation-id");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ id: "candidate-id" });
  });

  it("returns a sanitized unavailable response when the platform cannot be reached", async () => {
    const response = await forwardPlatformRequest(
      "/v1/me",
      { method: "GET" },
      {
        auth0: {
          getSession: async () => ({ user: { sub: "synthetic-user" } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: async () => {
          throw new Error("sensitive upstream failure");
        },
      },
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive upstream failure");
  });

  it("preserves a preference not-found response without leaking upstream headers", async () => {
    const response = await forwardPlatformRequest(
      "/v1/me/job-preferences",
      { method: "GET" },
      {
        auth0: {
          getSession: async () => ({ user: { sub: "synthetic-user" } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          new Response(
            JSON.stringify({
              type: "urn:ai-job-apply:problem:not_found",
              title: "Not found",
              status: 404,
              code: "not_found",
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/problem+json",
                "set-cookie": "must-not-cross-the-bff=1",
              },
            },
          ),
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
