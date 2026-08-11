import { describe, expect, it, vi } from "vitest";
import { verifyJobReadAuthorization } from "./job-read-conformance";

const request = new Request("http://localhost:3000/api/auth-conformance/job-read", {
  method: "POST",
  headers: { origin: "http://localhost:3000" },
});

function dependencies(status: number) {
  return {
    appBaseUrl: "http://localhost:3000",
    auth0: {
      getSession: vi.fn(async () => ({ user: { sub: "synthetic-user" } })),
      getAccessToken: vi.fn(async () => ({ token: "must-remain-server-held" })),
    },
    enabled: true,
    fetch: vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        "https://api.example.test/v1/jobs/00000000-0000-0000-8000-000000000000",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer must-remain-server-held",
      );
      return new Response(JSON.stringify({ restricted: "must-not-cross" }), { status });
    }),
    platformBaseUrl: "https://api.example.test",
  };
}

describe("deployed job-read authorization conformance", () => {
  it("hides the check when local conformance is disabled", async () => {
    const configured = dependencies(404);
    const response = await verifyJobReadAuthorization(request, {
      ...configured,
      enabled: false,
    });

    expect(response.status).toBe(404);
    expect(configured.auth0.getSession).not.toHaveBeenCalled();
    expect(configured.fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before reading the session", async () => {
    const configured = dependencies(404);
    const response = await verifyJobReadAuthorization(
      new Request(request.url, {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      }),
      configured,
    );

    expect(response.status).toBe(403);
    expect(configured.auth0.getSession).not.toHaveBeenCalled();
    expect(configured.fetch).not.toHaveBeenCalled();
  });

  it("passes only when the protected job route returns not found", async () => {
    const response = await verifyJobReadAuthorization(request, dependencies(404));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "jobs_read_authorized",
      message: "The server-held session has the jobs:read permission",
    });
  });

  it("does not wait for an ignored upstream response body to finish cancelling", async () => {
    let cancellationRequested = false;
    const configured = dependencies(404);
    configured.fetch.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            cancel: () => {
              cancellationRequested = true;
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 404 },
        ),
    );

    const response = await verifyJobReadAuthorization(request, configured);

    expect(response.status).toBe(200);
    expect(cancellationRequested).toBe(true);
  });

  it("distinguishes a missing scope without returning token or upstream content", async () => {
    const response = await verifyJobReadAuthorization(request, dependencies(403));
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain("jobs_read_scope_missing");
    expect(body).not.toContain("must-remain-server-held");
    expect(body).not.toContain("must-not-cross");
  });

  it("fails closed if the guaranteed-missing identifier unexpectedly resolves", async () => {
    const response = await verifyJobReadAuthorization(request, dependencies(200));
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain("probe_record_collision");
    expect(body).not.toContain("must-not-cross");
  });
});
