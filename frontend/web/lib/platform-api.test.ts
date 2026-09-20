import { describe, expect, it, vi } from "vitest";
import { validateJobReportResponse } from "./job-report-bff";
import { validateMatchAssessmentResponse } from "./match-assessment-bff";
import { forwardPlatformRequest } from "./platform-api";

const privateCanary = "synthetic-private-upstream-detail-never-cross";

const authenticated = {
  getSession: async () => ({ user: { sub: "synthetic-user" } }),
  getAccessToken: async () => ({ token: "synthetic-token" }),
};

function upstreamProblem(
  status: number,
  code: string,
  overrides: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:ai-job-apply:problem:${code}`,
      title: `Private title ${privateCanary}`,
      status,
      code,
      traceId: `private-trace-${privateCanary}`,
      detail: `Private detail ${privateCanary}`,
      ...overrides,
    }),
    {
      status,
      headers: { "content-type": "application/problem+json", ...headers },
    },
  );
}

describe("platform BFF", () => {
  it("fails closed when identity-dark session construction is unavailable", async () => {
    const platformFetch = vi.fn<typeof fetch>();
    const response = await forwardPlatformRequest(
      "/v1/me",
      { method: "GET" },
      {
        auth0: {
          getSession: () => {
            throw new Error("private identity configuration detail");
          },
          getAccessToken: async () => ({ token: "should-not-be-used" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private identity configuration detail");
    expect(platformFetch).not.toHaveBeenCalled();
  });

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
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("adds the server-held token and returns only approved response headers", async () => {
    const platformFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-token");
      expect(init?.redirect).toBe("error");
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
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("correlation-id");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ id: "candidate-id" });
  });

  it("forwards a bounded server-session ID token only for explicit reauthentication", async () => {
    const idToken = "headerheader.payloadpayload.signaturesignature";
    const platformFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-token");
      expect(headers.get("x-ai-job-apply-reauthentication")).toBe(idToken);
      return Response.json({ state: "quarantined" }, { status: 202 });
    });
    const response = await forwardPlatformRequest(
      "/v1/me/account-deletion-requests/synthetic/confirm",
      {
        method: "POST",
        headers: { "x-ai-job-apply-reauthentication": "caller-controlled.must.not-cross" },
      },
      {
        auth0: {
          getSession: async () => ({ tokenSet: { idToken } }),
          getAccessToken: async () => ({ token: "synthetic-token" }),
        },
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        includeReauthenticationProof: true,
      },
    );

    expect(response.status).toBe(202);
    expect(platformFetch).toHaveBeenCalledOnce();
  });

  it("fails before the platform call when a reauthentication proof is unavailable", async () => {
    const platformFetch = vi.fn<typeof fetch>();
    const response = await forwardPlatformRequest(
      "/v1/me/account-deletion-requests/synthetic/confirm",
      { method: "POST" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        includeReauthenticationProof: true,
      },
    );

    expect(response.status).toBe(401);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("returns a sanitized unavailable response when the platform cannot be reached", async () => {
    const platformFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("sensitive upstream failure");
    });
    const response = await forwardPlatformRequest(
      "/v1/me",
      { method: "GET" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        random: () => 1,
        retryDelaysMilliseconds: [1, 2, 3],
        sleep: async () => undefined,
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
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
        auth0: authenticated,
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
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        retryDelaysMilliseconds: [1, 2, 3],
        sleep: async () => undefined,
      },
    );

    expect(response.status).toBe(503);
    expect(platformFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts an upstream mutation at the server timeout boundary", async () => {
    let observedSignal: AbortSignal | undefined;
    const response = await forwardPlatformRequest(
      "/v1/jobs/search",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async (_input, init) => {
          observedSignal = init?.signal ?? undefined;
          await new Promise<void>((_resolve, reject) => {
            observedSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
          return new Response(null, { status: 200 });
        },
        timeoutMilliseconds: 1,
      },
    );

    expect(response.status).toBe(503);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("preserves a preference not-found response without leaking upstream headers", async () => {
    const response = await forwardPlatformRequest(
      "/v1/me/job-preferences",
      { method: "GET" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          upstreamProblem(404, "not_found", {}, { "set-cookie": "must-not-cross-the-bff=1" }),
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "urn:ai-job-apply:problem:not_found",
      title: "Not found",
      status: 404,
      code: "not_found",
    });
    expect(body.traceId).not.toBe(`private-trace-${privateCanary}`);
    expect(body).not.toHaveProperty("detail");
  });

  it("projects an exact declared problem with fixed copy and a local trace", async () => {
    const response = await forwardPlatformRequest(
      "/v1/jobs/search",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          upstreamProblem(
            409,
            "job_search_catalog_changed",
            {},
            {
              "set-cookie": `private=${privateCanary}`,
              "x-correlation-id": privateCanary,
            },
          ),
      },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-correlation-id")).toBeNull();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "urn:ai-job-apply:problem:job_search_catalog_changed",
      title: "Job catalog changed",
      status: 409,
      code: "job_search_catalog_changed",
    });
    expect(body.traceId).not.toBe(`private-trace-${privateCanary}`);
    expect(JSON.stringify(body)).not.toContain(privateCanary);
    expect(body).not.toHaveProperty("detail");
  });

  it.each([
    [409, "resume_upload_in_progress", "A resume is still being processed"],
    [409, "resume_document_limit", "Resume limit reached"],
    [503, "entitlement_unavailable", "Entitlement status unavailable"],
  ])(
    "preserves the declared resume upload refusal without upstream values: %s %s (ADR-032)",
    async (status, code, title) => {
      const response = await forwardPlatformRequest(
        "/v1/resumes/uploads",
        { method: "POST", body: "{}" },
        {
          auth0: authenticated,
          baseUrl: "http://localhost:4000",
          fetch: async () => upstreamProblem(status, code),
        },
      );
      expect(response.status).toBe(status);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ type: `urn:ai-job-apply:problem:${code}`, title, status, code });
      expect(JSON.stringify(body)).not.toContain(privateCanary);
      expect(body).not.toHaveProperty("detail");
    },
  );

  it.each([
    ["report", 404, "job_report_target_unavailable", "Job is unavailable"],
    ["report", 409, "job_already_reported", "Job already reported"],
    ["report", 409, "job_report_limit_reached", "Job-report limit reached"],
    ["report", 503, "job_reporting_unavailable", "Job reporting unavailable"],
    ["match", 404, "match_job_unavailable", "Job is unavailable"],
    ["match", 409, "match_preferences_required", "Job preferences are required"],
    ["match", 409, "match_preferences_require_review", "Job preferences require review"],
    ["match", 503, "match_assessment_unavailable", "Match assessment unavailable"],
  ])(
    "preserves declared report and match controls without upstream values: %s %s %s",
    async (surface, status, code, title) => {
      const response = await forwardPlatformRequest(
        surface === "report" ? "/v1/jobs/synthetic/reports" : "/v1/jobs/synthetic/match-assessment",
        { method: "POST", body: "{}" },
        {
          auth0: authenticated,
          baseUrl: "http://localhost:4000",
          fetch: async () => upstreamProblem(status, code),
        },
      );
      const downstream =
        surface === "report"
          ? await validateJobReportResponse(response.clone(), "synthetic", "job_closed")
          : await validateMatchAssessmentResponse(response.clone(), "synthetic");

      expect(response.status).toBe(status);
      expect(downstream.status).toBe(status);
      expect(await downstream.json()).toMatchObject({ status, code, title });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        type: `urn:ai-job-apply:problem:${code}`,
        title,
        status,
        code,
      });
      expect(body.traceId).not.toBe(`private-trace-${privateCanary}`);
      expect(JSON.stringify(body)).not.toContain(privateCanary);
      expect(body).not.toHaveProperty("detail");
    },
  );

  it.each([
    ["unknown code", () => upstreamProblem(409, "private_database_conflict")],
    [
      "mismatched status",
      () => upstreamProblem(409, "job_search_catalog_changed", { status: 400 }),
    ],
    [
      "mismatched type",
      () =>
        upstreamProblem(409, "job_search_catalog_changed", {
          type: "urn:ai-job-apply:problem:private_database_conflict",
        }),
    ],
    [
      "wrong content type",
      () =>
        new Response(privateCanary, {
          status: 409,
          headers: { "content-type": "text/plain" },
        }),
    ],
    [
      "malformed JSON",
      () =>
        new Response(`{${privateCanary}`, {
          status: 409,
          headers: { "content-type": "application/problem+json" },
        }),
    ],
    [
      "missing required fields",
      () =>
        new Response(JSON.stringify({ code: "job_search_catalog_changed" }), {
          status: 409,
          headers: { "content-type": "application/problem+json" },
        }),
    ],
  ])("replaces an invalid upstream problem: %s", async (_label, responseFactory) => {
    const response = await forwardPlatformRequest(
      "/v1/jobs/search",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () => responseFactory(),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain(privateCanary);
  });

  it("cancels a problem whose declared content length is too large", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(privateCanary));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = await forwardPlatformRequest(
      "/v1/profile/facts",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          new Response(body, {
            status: 409,
            headers: {
              "content-type": "application/problem+json",
              "content-length": String(16 * 1024 + 1),
            },
          }),
      },
    );

    expect(response.status).toBe(503);
    expect(cancelled).toBe(true);
    expect(await response.text()).not.toContain(privateCanary);
  });

  it("cancels a streamed problem that exceeds the byte bound", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = await forwardPlatformRequest(
      "/v1/profile/facts",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          new Response(body, {
            status: 409,
            headers: { "content-type": "application/problem+json" },
          }),
      },
    );

    expect(response.status).toBe(503);
    expect(cancelled).toBe(true);
  });

  it("times out and cancels a stalled upstream problem body", async () => {
    let cancelled = false;
    const response = await forwardPlatformRequest(
      "/v1/profile/facts",
      { method: "POST", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start() {},
              cancel() {
                cancelled = true;
                return new Promise<void>(() => undefined);
              },
            }),
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        timeoutMilliseconds: 1,
      },
    );

    expect(response.status).toBe(503);
    expect(cancelled).toBe(true);
  });

  it("refuses upstream redirects instead of forwarding the server-held token", async () => {
    const platformFetch = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      throw new Error("redirect refused");
    });
    const response = await forwardPlatformRequest(
      "/v1/me/job-preferences",
      { method: "PUT", body: "{}" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
      },
    );

    expect(response.status).toBe(503);
    expect(platformFetch).toHaveBeenCalledTimes(1);
  });

  it("does not wait for hostile transient-body cancellation before retrying a read", async () => {
    let cancellationRequested = false;
    const platformFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start() {},
            cancel() {
              cancellationRequested = true;
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const response = await forwardPlatformRequest(
      "/v1/profile/facts",
      { method: "GET" },
      {
        auth0: authenticated,
        baseUrl: "http://localhost:4000",
        fetch: platformFetch,
        random: () => 1,
        retryDelaysMilliseconds: [1],
        sleep: async () => undefined,
      },
    );

    expect(response.status).toBe(200);
    expect(platformFetch).toHaveBeenCalledTimes(2);
    expect(cancellationRequested).toBe(true);
  });
});
