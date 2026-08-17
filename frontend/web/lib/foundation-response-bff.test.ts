import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEntitlements } from "../app/api/platform/entitlements/route";
import { PATCH as patchProfileFact } from "../app/api/platform/profile-facts/[factId]/route";
import {
  GET as getProfileFacts,
  POST as postProfileFact,
} from "../app/api/platform/profile-facts/route";
import { GET as getResumes, POST as postResume } from "../app/api/platform/resumes/route";
import {
  type FoundationResponseSchemaName,
  validateFoundationResponse,
} from "./foundation-response-bff";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
  getAuth0Client: vi.fn(() => ({ synthetic: "auth0-client" })),
}));

vi.mock("./platform-api", () => ({
  forwardPlatformRequest: mocks.forwardPlatformRequest,
}));

vi.mock("./auth0", () => ({
  getAuth0Client: mocks.getAuth0Client,
}));

const encoder = new TextEncoder();
const idempotencyKey = "foundation-response-0001";
const documentId = "019b4e12-7ea3-7c36-9357-aea35ab542c3";
const factId = "019b4e12-7ea3-7c36-9357-aea35ab542c4";

const resumeDocument = {
  id: documentId,
  fileName: "synthetic-resume.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4096,
  sha256: "a".repeat(64),
  status: "awaiting_upload",
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};
const resumeCollection = { documents: [resumeDocument] };
const resumeUploadResponse = {
  document: resumeDocument,
  upload: {
    url: "https://uploads.example.test/synthetic",
    method: "POST",
    fields: { key: "synthetic/quarantine/object" },
    expiresAt: "2099-08-17T12:00:00.000Z",
  },
};
const profileFact = {
  id: factId,
  kind: "skill",
  key: "programming_language",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "confidential",
  source: { type: "user", reference: "direct-entry" },
  version: 1,
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};
const factCollection = { facts: [profileFact], confirmedCount: 1, proposedCount: 0 };
const freeEntitlement = {
  plan: "free",
  accessState: "active",
  grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
  version: 0,
  evaluatedAt: "2026-08-17T12:00:00.000Z",
};
const activeProEntitlement = {
  ...freeEntitlement,
  plan: "pro",
  version: 1,
  accessThrough: "2026-09-17T12:00:00.000Z",
};
const graceProEntitlement = {
  ...activeProEntitlement,
  accessState: "grace",
  graceThrough: "2026-09-24T12:00:00.000Z",
};

const validValues: Record<FoundationResponseSchemaName, unknown> = {
  EntitlementSummary: freeEntitlement,
  ResumeDocumentCollection: resumeCollection,
  CreateResumeUploadResponse: resumeUploadResponse,
  ProfileFactCollection: factCollection,
  ProfileFact: profileFact,
};

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mutationRequest(method: string, value: unknown): Request {
  return new Request("http://localhost/api/platform/foundation", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(value),
  });
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(await response.json()).toEqual({
    type: "urn:ai-job-apply:problem:platform_unavailable",
    title: "The platform API is unavailable",
    status: 503,
    code: "platform_unavailable",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("foundation response boundary", () => {
  it.each(Object.entries(validValues))(
    "accepts and projects an exact valid %s response",
    async (schemaName, value) => {
      const expectedStatus = schemaName === "CreateResumeUploadResponse" ? 201 : 200;
      const response = await validateFoundationResponse(
        jsonResponse(value, expectedStatus, { "x-correlation-id": "synthetic-correlation" }),
        expectedStatus,
        schemaName as FoundationResponseSchemaName,
      );

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("x-correlation-id")).toBe("synthetic-correlation");
      expect(await response.json()).toEqual(value);
    },
  );

  it("passes an already-sanitized non-success response through unchanged", async () => {
    const upstream = Response.json(
      {
        type: "urn:ai-job-apply:problem:authentication_required",
        title: "Authentication required",
        status: 401,
        code: "authentication_required",
      },
      {
        status: 401,
        headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      },
    );

    expect(await validateFoundationResponse(upstream, 200, "ResumeDocumentCollection")).toBe(
      upstream,
    );
  });

  it.each([freeEntitlement, activeProEntitlement, graceProEntitlement])(
    "accepts and reprojects an exact provider-neutral entitlement shape",
    async (entitlement) => {
      const response = await validateFoundationResponse(
        jsonResponse(entitlement),
        200,
        "EntitlementSummary",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(entitlement);
    },
  );

  it.each([
    { ...freeEntitlement, provider: "candidate-private-entitlement-provider" },
    { ...freeEntitlement, accessState: "grace" },
    { ...activeProEntitlement, accessThrough: undefined },
    { ...freeEntitlement, grants: ["profile.manage", "candidate-private-entitlement-grant"] },
    { ...freeEntitlement, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...freeEntitlement, evaluatedAt: "not-a-date-candidate-private-entitlement" },
  ])("rejects contract-invalid or private entitlement success bytes", async (entitlement) => {
    const response = await validateFoundationResponse(
      jsonResponse(entitlement),
      200,
      "EntitlementSummary",
    );
    const body = await response.clone().text();

    await expectUnavailable(response);
    expect(body).not.toContain("candidate-private-entitlement");
  });

  it.each([
    ["wrong status", { status: 202 }],
    ["wrong media", { headers: { "content-type": "text/plain" } }],
    ["transfer framing", { headers: { "transfer-encoding": "chunked" } }],
    ["empty declared length", { headers: { "content-length": "" } }],
    ["malformed declared length", { headers: { "content-length": "private" } }],
    ["oversize declared length", { headers: { "content-length": String(1024 * 1024 + 1) } }],
  ])("rejects %s before pulling the success body", async (_label, override) => {
    const { status = 200, headers = {} } = override as {
      status?: number;
      headers?: HeadersInit;
    };
    let pulls = 0;
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls += 1;
        },
        cancel() {
          cancellations += 1;
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const response = new Response(body, {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

    await expectUnavailable(
      await validateFoundationResponse(response, 200, "ResumeDocumentCollection"),
    );
    expect(pulls).toBe(0);
    expect(cancellations).toBe(1);
  });

  it("reads the exact byte ceiling before failing closed on schema", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024).fill("x".charCodeAt(0)));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await expectUnavailable(
      await validateFoundationResponse(response, 200, "ResumeDocumentCollection"),
    );
    expect(cancelled).toBe(false);
  });

  it("cancels at the first byte beyond the cap without pulling later data", async () => {
    let pulls = 0;
    let cancellations = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (pulls === 1) controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            else controller.enqueue(encoder.encode("candidate-private-later-chunk"));
          },
          cancel() {
            cancellations += 1;
            return new Promise<void>(() => undefined);
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await expectUnavailable(
      await validateFoundationResponse(response, 200, "ResumeDocumentCollection"),
    );
    expect(pulls).toBe(1);
    expect(cancellations).toBe(1);
  });

  it("contains timeout and abort without awaiting hostile cancellation", async () => {
    for (const mode of ["timeout", "abort"] as const) {
      let cancellations = 0;
      const controller = new AbortController();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start() {},
          cancel() {
            cancellations += 1;
            return new Promise<void>(() => undefined);
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      if (mode === "abort") controller.abort();

      await expectUnavailable(
        await validateFoundationResponse(
          response,
          200,
          "ResumeDocumentCollection",
          controller.signal,
          mode === "timeout" ? 1 : 10_000,
        ),
      );
      expect(cancellations).toBe(1);
    }
  });

  it("contains empty, read-error, non-UTF8, malformed JSON, length mismatch, and schema failures", async () => {
    const privateCanary = "candidate-private-response-canary";
    const cases = [
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error(privateCanary));
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(new Uint8Array([0xc3, 0x28]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(`{"private":"${privateCanary}"`, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify(resumeCollection), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "1" },
      }),
      jsonResponse({ ...resumeCollection, privateDetail: privateCanary }),
    ];

    for (const candidate of cases) {
      const response = await validateFoundationResponse(candidate, 200, "ResumeDocumentCollection");
      const body = await response.clone().text();
      await expectUnavailable(response);
      expect(body).not.toContain(privateCanary);
    }
  });

  it("reserializes a valid parsed value without retaining duplicate raw values", async () => {
    const privateCanary = "candidate-private-duplicate-value";
    const raw = JSON.stringify(profileFact).replace(
      '"key":"programming_language"',
      `"key":"${privateCanary}","key":"programming_language"`,
    );
    const response = await validateFoundationResponse(
      new Response(raw, { status: 200, headers: { "content-type": "application/json" } }),
      200,
      "ProfileFact",
    );
    const projected = await response.text();

    expect(response.status).toBe(200);
    expect(projected).not.toContain(privateCanary);
    expect(JSON.parse(projected)).toEqual(profileFact);
  });
});

describe("foundation route response composition", () => {
  it.each([
    [
      "entitlement GET",
      () =>
        getEntitlements(
          new Request("http://localhost/api/platform/entitlements", { method: "GET" }),
        ),
      200,
      freeEntitlement,
    ],
    [
      "resume GET",
      () => getResumes(new Request("http://localhost/api/platform/resumes")),
      200,
      resumeCollection,
    ],
    [
      "resume POST",
      () =>
        postResume(
          mutationRequest("POST", {
            fileName: "synthetic-resume.pdf",
            mediaType: "application/pdf",
            sizeBytes: 4096,
            sha256: "a".repeat(64),
          }),
        ),
      201,
      resumeUploadResponse,
    ],
    [
      "profile-fact GET",
      () => getProfileFacts(new Request("http://localhost/api/platform/profile-facts")),
      200,
      factCollection,
    ],
    [
      "profile-fact POST",
      () =>
        postProfileFact(
          mutationRequest("POST", {
            kind: "skill",
            key: "programming_language",
            value: "TypeScript",
            sensitivity: "confidential",
          }),
        ),
      201,
      profileFact,
    ],
    [
      "profile-fact PATCH",
      () =>
        patchProfileFact(mutationRequest("PATCH", { expectedVersion: 1, value: "TypeScript" }), {
          params: Promise.resolve({ factId }),
        }),
      200,
      profileFact,
    ],
  ])("validates the exact %s success status and schema", async (_label, run, status, value) => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(jsonResponse(value, status as number));

    const response = await (run as () => Promise<Response>)();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(value);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a route receives a contract-invalid private success", async () => {
    const privateCanary = "candidate-private-upstream-success";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ ...resumeCollection, privateDetail: privateCanary }),
    );

    const response = await getResumes(new Request("http://localhost/api/platform/resumes"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain(privateCanary);
  });

  it("forwards the entitlement request signal and contains a private success", async () => {
    const privateCanary = "candidate-private-entitlement-route-success";
    const controller = new AbortController();
    const request = new Request("http://localhost/api/platform/entitlements", {
      signal: controller.signal,
    });
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ ...freeEntitlement, provider: privateCanary }),
    );

    const response = await getEntitlements(request);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain(privateCanary);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      "/v1/entitlements",
      { method: "GET", signal: request.signal },
      expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
    );
  });
});
