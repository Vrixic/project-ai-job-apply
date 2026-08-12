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
    const platformFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("sensitive upstream failure");
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
        random: () => 1,
        retryDelaysMilliseconds: [1, 2, 3],
        sleep: async () => undefined,
      },
    );

    expect(response.status).toBe(503);
    expect(platformFetch).toHaveBeenCalledTimes(4);
    expect(await response.text()).not.toContain("sensitive upstream failure");
  });

  it("retries transient authenticated reads before returning the upstream response", async () => {
    const platformFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("transient connection failure"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const wait = vi.fn(async () => undefined);

    const response = await forwardPlatformRequest(
      "/v1/profile/facts",
      { method: "GET" },
      {
        auth0: {
          getSession: async () => ({ user: { sub: "synthetic-user" } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        random: () => 1,
        retryDelaysMilliseconds: [100, 300],
        sleep: wait,
      },
    );

    expect(response.status).toBe(200);
    expect(platformFetch).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 300);
  });

  it("does not implicitly retry authenticated mutations", async () => {
    const platformFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const response = await forwardPlatformRequest(
      "/v1/me/job-preferences",
      { method: "PUT", body: "{}" },
      {
        auth0: {
          getSession: async () => ({ user: { sub: "synthetic-user" } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        retryDelaysMilliseconds: [1, 2, 3],
        sleep: async () => undefined,
      },
    );

    expect(response.status).toBe(503);
    expect(platformFetch).toHaveBeenCalledTimes(1);
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
