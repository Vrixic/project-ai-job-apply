import { describe, expect, it, vi } from "vitest";
import { applicationsRoute, formatSearch, historySearch } from "./applications-bff";

const APP = "019d04cf-1f80-7000-8000-000000000001";
const ATTEMPT = "019d04cf-1f80-7000-8000-000000000002";
const JOB = "019d04cf-1f80-7000-8000-000000000003";
const KEY = "idempotency-key-0000001";
const AT = "2026-09-18T12:00:00.000Z";

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: APP,
    canonicalJobId: JOB,
    status: "preparing",
    revision: 1,
    currentAction: "prepare_packet",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function harness(upstream: () => Response, signedIn = true) {
  const fetch = vi.fn(async () => upstream());
  const auth0 = {
    getSession: vi.fn(async () => (signedIn ? { user: {} } : null)),
    getAccessToken: vi.fn(async () => ({ token: "synthetic-token" })),
  };
  return {
    fetch,
    auth0,
    deps: {
      auth0,
      baseUrl: "http://localhost:4000",
      fetch: fetch as unknown as typeof globalThis.fetch,
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const problem = (status: number, code: string) =>
  new Response(
    JSON.stringify({
      type: `urn:ai-job-apply:problem:${code}`,
      title: "upstream",
      status,
      code,
      traceId: "trace-1",
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY, ...headers },
    body: JSON.stringify(body),
  });
}

describe("Applications browser boundary", () => {
  it("forwards only exact generation queries and current scalar locations", async () => {
    const completedAtMs = Date.now();
    const material = {
      schemaVersion: 1,
      kind: "tailored_resume",
      generationId: ATTEMPT,
      version: 1,
      contentSha256: "a".repeat(64),
      completedAtMs,
      expiresAtMs: completedAtMs + 1_800_000,
    };
    const location = {
      schemaVersion: 1,
      packetId: JOB,
      packetHash: "b".repeat(64),
      temporaryMaterial: material,
      origin: `https://${ATTEMPT}.materials.example.test:8443`,
    };
    for (const operation of ["resumeLocation", "coverLetterLocation"] as const) {
      const body = {
        ...location,
        temporaryMaterial: {
          ...material,
          kind: operation === "resumeLocation" ? "tailored_resume" : "cover_letter",
        },
      };
      const { deps, fetch } = harness(() => json(body));
      const response = await applicationsRoute(
        operation,
        new Request(`http://localhost:3000/x?generationId=${ATTEMPT}`),
        { applicationId: APP },
        deps,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(String((fetch.mock.calls[0] as unknown as [URL])[0])).toBe(
        `http://localhost:4000/v1/applications/${APP}/${operation === "resumeLocation" ? "resume" : "cover-letter"}/location?generationId=${ATTEMPT}`,
      );
    }
    for (const query of [
      "",
      "?generationId=wrong",
      `?generationId=${ATTEMPT}&generationId=${ATTEMPT}`,
      `?generationId=${ATTEMPT}&token=forbidden`,
    ]) {
      const { deps, fetch } = harness(() => json(location));
      const response = await applicationsRoute(
        "resumeLocation",
        new Request(`http://localhost:3000/x${query}`),
        { applicationId: APP },
        deps,
      );
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
    for (const changed of [
      { generationId: JOB },
      { kind: "cover_letter" },
      { expiresAtMs: material.expiresAtMs + 1 },
      { completedAtMs: 0, expiresAtMs: 1_800_000 },
    ]) {
      const { deps } = harness(() =>
        json({ ...location, temporaryMaterial: { ...material, ...changed } }),
      );
      const response = await applicationsRoute(
        "resumeLocation",
        new Request(`http://localhost:3000/x?generationId=${ATTEMPT}`),
        { applicationId: APP },
        deps,
      );
      expect(response.status).toBe(503);
    }
  });
  it("accepts only disclosure-bound, owner-matching asynchronous preparation", async () => {
    const preparation = {
      id: ATTEMPT,
      applicationId: APP,
      state: "queued",
      createdAt: AT,
      updatedAt: AT,
    };
    const request = {
      expectedRevision: 1,
      coverLetter: { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true } },
    };
    for (const [body, upstream, expected] of [
      [request, preparation, 202],
      [{ expectedRevision: 1 }, preparation, 503],
      [request, { ...preparation, applicationId: JOB }, 503],
    ] as const) {
      const { deps } = harness(() => json(upstream, 202));
      const response = await applicationsRoute(
        "preparePacket",
        post("/x", body),
        { applicationId: APP },
        deps,
      );
      expect(response.status).toBe(expected);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("polls exactly the addressed preparation and refuses substituted results", async () => {
    for (const upstreamId of [ATTEMPT, JOB]) {
      const { deps, fetch } = harness(() =>
        json({
          id: upstreamId,
          applicationId: APP,
          state: "running",
          createdAt: AT,
          updatedAt: AT,
        }),
      );
      const response = await applicationsRoute(
        "preparation",
        new Request("http://localhost:3000/x"),
        { applicationId: APP, preparationId: ATTEMPT },
        deps,
      );
      expect(response.status).toBe(upstreamId === ATTEMPT ? 200 : 503);
      expect(String((fetch.mock.calls[0] as unknown as [URL])[0])).toBe(
        `http://localhost:4000/v1/applications/${APP}/preparations/${ATTEMPT}`,
      );
    }
  });
  it("creates an application through one fixed path with the exact validated body and key", async () => {
    const { fetch, deps } = harness(() => json(application(), 201));
    const response = await applicationsRoute(
      "create",
      post("/api/platform/applications", { jobId: JOB }),
      {},
      deps,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: APP, status: "preparing" });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://localhost:4000/v1/applications");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ jobId: JOB }));
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(KEY);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-token");
  });

  it("requires a session before contacting the platform", async () => {
    const { fetch, deps } = harness(() => json(application(), 201), false);
    const response = await applicationsRoute(
      "create",
      post("/api/platform/applications", { jobId: JOB }),
      {},
      deps,
    );
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing key", { "idempotency-key": "" }],
    ["short key", { "idempotency-key": "short" }],
    ["key with spaces", { "idempotency-key": "has spaces in the key 123" }],
  ])("rejects a command with a %s before the platform is called", async (_label, headers) => {
    const { fetch, deps } = harness(() => json(application(), 201));
    const response = await applicationsRoute(
      "create",
      post("/api/platform/applications", { jobId: JOB }, headers),
      {},
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "text/plain", "canonicalJobId=1", 415],
    ["empty", "application/json", "", 400],
    ["malformed", "application/json", "{", 400],
    ["unknown field", "application/json", JSON.stringify({ jobId: JOB, extra: 1 }), 400],
    ["wrong type", "application/json", JSON.stringify({ jobId: 7 }), 400],
    ["oversized", "application/json", JSON.stringify({ padding: "x".repeat(40_000) }), 413],
  ])("refuses a %s body without contacting the platform", async (_l, type, body, status) => {
    const { fetch, deps } = harness(() => json(application(), 201));
    const response = await applicationsRoute(
      "create",
      new Request("http://localhost:3000/api/platform/applications", {
        method: "POST",
        headers: { "content-type": type, "idempotency-key": KEY },
        body,
      }),
      {},
      deps,
    );
    expect(response.status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards an uploaded-resume preparation and refuses any other resume option", async () => {
    const forwarded = harness(() => json(application({ status: "review_required" }), 201));
    const accepted = await applicationsRoute(
      "preparePacket",
      post(`/api/platform/applications/${APP}/packets`, {
        expectedRevision: 1,
        resume: "uploaded",
      }),
      { applicationId: APP },
      forwarded.deps,
    );
    expect(accepted.status).toBe(201);
    const init = (forwarded.fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 1, resume: "uploaded" });
    for (const resume of ["docx", "tailored", 1, null]) {
      const refused = harness(() => json(application(), 201));
      const response = await applicationsRoute(
        "preparePacket",
        post(`/api/platform/applications/${APP}/packets`, { expectedRevision: 1, resume }),
        { applicationId: APP },
        refused.deps,
      );
      expect(response.status).toBe(400);
      expect(refused.fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed identifiers and any query outside the history allowlist", async () => {
    const { fetch, deps } = harness(() => json(application()));
    const get = (url: string) => new Request(url, { method: "GET" });
    for (const id of ["nope", APP.replace("-7", "-4"), `${APP}/x`, "../../etc"]) {
      const response = await applicationsRoute(
        "get",
        get(`http://localhost:3000/api/platform/applications/${id}`),
        { applicationId: id },
        deps,
      );
      expect(response.status).toBe(400);
    }
    const withQuery = await applicationsRoute(
      "get",
      get(`http://localhost:3000/api/platform/applications/${APP}?debug=1`),
      { applicationId: APP },
      deps,
    );
    expect(withQuery.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards only a strict bounded history query", async () => {
    const page = { entries: [], hasMore: false };
    const { fetch, deps } = harness(() => json(page));
    const ok = await applicationsRoute(
      "history",
      new Request(`http://localhost:3000/x?afterSeq=3&limit=50`, { method: "GET" }),
      { applicationId: APP },
      deps,
    );
    expect(ok.status).toBe(200);
    expect(String((fetch.mock.calls[0] as unknown as [URL])[0])).toBe(
      `http://localhost:4000/v1/applications/${APP}/history?afterSeq=3&limit=50`,
    );
    for (const search of ["?limit=0", "?limit=201", "?afterSeq=-1", "?limit=1&limit=2", "?x=1"]) {
      expect(historySearch(search), search).toBeUndefined();
    }
    expect(historySearch("")).toBe("");
  });

  it("sends body-less commands without a body and refuses one", async () => {
    const attempt = {
      id: ATTEMPT,
      sequence: 1,
      status: "dispatched",
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
      startedAt: AT,
      dispatchedAt: AT,
    };
    const { fetch, deps } = harness(() => json(attempt));
    const ok = await applicationsRoute(
      "dispatch",
      new Request("http://localhost:3000/x", { method: "POST" }),
      { applicationId: APP, attemptId: ATTEMPT },
      deps,
    );
    expect(ok.status).toBe(200);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      `http://localhost:4000/v1/applications/${APP}/attempts/${ATTEMPT}/dispatch`,
    );
    expect(init.body).toBeUndefined();
    const refused = await applicationsRoute(
      "dispatch",
      new Request("http://localhost:3000/x", {
        method: "POST",
        headers: { "content-length": "5" },
        body: "hello",
      }),
      { applicationId: APP, attemptId: ATTEMPT },
      deps,
    );
    expect(refused.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts a manual attempt through the fixed validated path and checks nested ownership", async () => {
    const attempt = {
      id: ATTEMPT,
      sequence: 1,
      status: "taken_over",
      adapterId: "manual",
      adapterVersion: "none",
      startedAt: AT,
      resolvedAt: AT,
    };
    const started = {
      outcome: "started",
      attemptId: ATTEMPT,
      application: application({
        status: "takeover",
        revision: 2,
        currentAction: "complete_manually",
        attempts: [attempt],
      }),
    };
    const { fetch, deps } = harness(() => json(started));
    const response = await applicationsRoute(
      "startManualSubmission",
      post("/x", { expectedRevision: 1 }),
      { applicationId: APP },
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(started);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`http://localhost:4000/v1/applications/${APP}/manual-submissions`);
    expect(init.body).toBe(JSON.stringify({ expectedRevision: 1 }));
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(KEY);

    const invalid = harness(() => json(started));
    const refusedBody = await applicationsRoute(
      "startManualSubmission",
      post("/x", { expectedRevision: 1, adapterId: "manual" }),
      { applicationId: APP },
      invalid.deps,
    );
    expect(refusedBody.status).toBe(400);
    expect(invalid.fetch).not.toHaveBeenCalled();

    const foreign = harness(() => json({ ...started, application: application({ id: JOB }) }));
    const refusedOwner = await applicationsRoute(
      "startManualSubmission",
      post("/x", { expectedRevision: 1 }),
      { applicationId: APP },
      foreign.deps,
    );
    expect(refusedOwner.status).toBe(503);
  });

  it("projects declared upstream problems to fixed value-free bodies", async () => {
    const { deps } = harness(() => problem(409, "application_packet_stale"));
    const response = await applicationsRoute(
      "cancel",
      post(`/x`, { expectedRevision: 1 }),
      { applicationId: APP },
      deps,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "application_packet_stale",
      title: "Packet is stale",
    });
    const missing = harness(() => problem(404, "application_not_found"));
    const notFound = await applicationsRoute(
      "get",
      new Request("http://localhost:3000/x", { method: "GET" }),
      { applicationId: APP },
      missing.deps,
    );
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ code: "application_not_found" });
  });

  it("serves the tailored resume preview through one fixed path and validates it strictly", async () => {
    const preview = {
      status: "ready",
      matchesPacket: true,
      baseDocument: { id: JOB, fileName: "resume.pdf" },
      tailoringVersion: "tailoring.v1",
      contentSha256: "a".repeat(64),
      matchedTerms: ["typescript"],
      sections: [
        {
          kind: "experience",
          heading: "Experience",
          entries: [
            {
              lines: ["Engineer - Acme"],
              bullets: [{ text: "Built APIs in TypeScript", change: "moved_up" }],
            },
          ],
        },
      ],
    };
    const ok = harness(() => json(preview));
    const response = await applicationsRoute(
      "resumePreview",
      new Request("http://localhost:3000/x", { method: "GET" }),
      { applicationId: APP },
      ok.deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(String((ok.fetch.mock.calls[0] as unknown[])[0])).toBe(
      `http://localhost:4000/v1/applications/${APP}/resume`,
    );

    // Anything outside the contract never reaches the browser.
    for (const bad of [
      { ...preview, recruiterNotes: "x" },
      { ...preview, status: "interview_scheduled" },
      { status: "ready" },
      {
        ...preview,
        sections: [
          {
            kind: "experience",
            entries: [{ lines: [], bullets: [{ text: "x", change: "rewritten" }] }],
          },
        ],
      },
    ]) {
      const { deps } = harness(() => json(bad));
      const refused = await applicationsRoute(
        "resumePreview",
        new Request("http://localhost:3000/x", { method: "GET" }),
        { applicationId: APP },
        deps,
      );
      expect(refused.status).toBe(503);
      expect(JSON.stringify(await refused.json())).not.toContain("recruiterNotes");
    }
  });

  it("forwards only a strict single format query for the resume file", async () => {
    const file = {
      format: "pdf",
      mediaType: "application/pdf",
      fileName: "resume-tailored.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 3,
      contentSha256: "b".repeat(64),
      contentBase64: "YWJj",
    };
    const ok = harness(() => json(file));
    const response = await applicationsRoute(
      "resumeFile",
      new Request("http://localhost:3000/x?format=pdf", { method: "GET" }),
      { applicationId: APP },
      ok.deps,
    );
    expect(response.status).toBe(200);
    expect(String((ok.fetch.mock.calls[0] as unknown[])[0])).toBe(
      `http://localhost:4000/v1/applications/${APP}/resume/file?format=pdf`,
    );
    for (const search of [
      "",
      "?format=exe",
      "?format=docx",
      "?format=pdf&format=docx",
      "?format=pdf&x=1",
      "?x=pdf",
    ]) {
      expect(formatSearch(search), search).toBeUndefined();
      const { deps, fetch } = harness(() => json(file));
      const refused = await applicationsRoute(
        "resumeFile",
        new Request(`http://localhost:3000/x${search}`, { method: "GET" }),
        { applicationId: APP },
        deps,
      );
      expect(refused.status, search).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
    // A file that breaks the contract (for example a size above the ceiling) never reaches the browser.
    const oversize = harness(() => json({ ...file, sizeBytes: 300_001 }));
    const refused = await applicationsRoute(
      "resumeFile",
      new Request("http://localhost:3000/x?format=pdf", { method: "GET" }),
      { applicationId: APP },
      oversize.deps,
    );
    expect(refused.status).toBe(503);
  });

  it("never passes an invalid, oversized, mistyped, or foreign success body to the browser", async () => {
    const cases: Array<[string, () => Response]> = [
      ["wrong status", () => json(application(), 200)],
      [
        "not JSON",
        () => new Response("<html>", { status: 201, headers: { "content-type": "text/html" } }),
      ],
      ["schema violation", () => json({ ...application(), status: "interview_scheduled" }, 201)],
      ["another application", () => json(application({ id: JOB }), 201)],
      ["extra property", () => json({ ...application(), recruiterNotes: "x" }, 201)],
    ];
    for (const [label, upstream] of cases) {
      const { deps } = harness(upstream);
      const response = await applicationsRoute(
        "preparePacket",
        post("/x", { expectedRevision: 1 }),
        { applicationId: APP },
        deps,
      );
      expect(response.status, label).toBe(503);
      expect(JSON.stringify(await response.json()), label).not.toContain("recruiterNotes");
    }
  });

  it("does not echo a body or identifier when an unexpected upstream problem appears", async () => {
    const { deps } = harness(() => problem(500, "leaky_internal_code"));
    const response = await applicationsRoute(
      "get",
      new Request("http://localhost:3000/x", { method: "GET" }),
      { applicationId: APP },
      { ...deps },
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("leaky_internal_code");
  });
});
