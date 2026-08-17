import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET as getJobPreferences,
  PUT as putJobPreferences,
} from "../app/api/platform/job-preferences/route";
import { PATCH as patchProfileFact } from "../app/api/platform/profile-facts/[factId]/route";
import {
  GET as getProfileFacts,
  POST as postProfileFact,
} from "../app/api/platform/profile-facts/route";
import { GET as getResumes, POST as postResume } from "../app/api/platform/resumes/route";
import { type FoundationWriteSchemaName, readFoundationWriteRequest } from "./foundation-write-bff";

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

beforeEach(() => {
  vi.clearAllMocks();
});

const encoder = new TextEncoder();
const idempotencyKey = "foundation-write-0001";
const factId = "019b4e12-7ea3-7c36-9357-aea35ab542cc";
const validBodies: Record<FoundationWriteSchemaName, Record<string, unknown>> = {
  PutJobPreferencesRequest: {
    targetRoles: ["Software Engineer"],
    locations: [],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
  },
  CreateResumeUploadRequest: {
    fileName: "synthetic-resume.pdf",
    mediaType: "application/pdf",
    sizeBytes: 4096,
    sha256: "a".repeat(64),
  },
  CreateProfileFactRequest: {
    kind: "skill",
    key: "programming_language",
    value: "TypeScript",
    sensitivity: "standard",
  },
  UpdateProfileFactRequest: {
    expectedVersion: 1,
    value: "TypeScript and JavaScript",
  },
};
const responseDocument = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542c2",
  ...validBodies.CreateResumeUploadRequest,
  status: "awaiting_upload",
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};
const responseFact = {
  id: factId,
  ...validBodies.CreateProfileFactRequest,
  verification: "confirmed",
  source: { type: "user", reference: "direct-entry" },
  version: 1,
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};

function request(
  body: BodyInit | null,
  overrides: {
    headers?: HeadersInit;
    method?: string;
    signal?: AbortSignal;
    url?: string;
  } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  });
  new Headers(overrides.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return new Request(overrides.url ?? "http://localhost/api/platform/foundation", {
    method: overrides.method ?? "POST",
    body,
    headers,
    signal: overrides.signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function expectProblem(
  result: Awaited<ReturnType<typeof readFoundationWriteRequest>>,
  status: number,
  code: string,
): Promise<Record<string, unknown>> {
  expect(result).toHaveProperty("failure");
  if (!("failure" in result)) throw new Error("Expected a fixed failure response");
  expect(result.failure.status).toBe(status);
  expect(result.failure.headers.get("cache-control")).toBe("no-store");
  expect(result.failure.headers.get("content-type")).toContain("application/problem+json");
  const body = (await result.failure.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status, code });
  expect(Object.keys(body).sort()).toEqual(["code", "status", "title", "type"]);
  return body;
}

describe("foundation write request boundary", () => {
  it.each(Object.entries(validBodies))(
    "preserves an exact valid %s body and idempotency key",
    async (schemaName, value) => {
      const body = JSON.stringify(value);
      const result = await readFoundationWriteRequest(
        request(body),
        schemaName as FoundationWriteSchemaName,
      );

      expect(result).toEqual({ body, idempotencyKey });
    },
  );

  it("rejects schema-invalid and private extra fields with fixed copy", async () => {
    const privateCanary = "candidate-private-field-never-reflected";
    const result = await readFoundationWriteRequest(
      request(
        JSON.stringify({
          ...validBodies.CreateProfileFactRequest,
          interviewOutcome: privateCanary,
        }),
      ),
      "CreateProfileFactRequest",
    );

    const problemBody = await expectProblem(result, 400, "invalid_request");
    expect(JSON.stringify(problemBody)).not.toContain(privateCanary);
  });

  it.each([
    ["query", { url: "http://localhost/api/platform/foundation?private=1" }, 400],
    ["media", { headers: { "content-type": "text/plain" } }, 415],
    ["transfer framing", { headers: { "transfer-encoding": "chunked" } }, 400],
    ["missing key", { headers: { "idempotency-key": "" } }, 400],
    ["short key", { headers: { "idempotency-key": "short" } }, 400],
    ["long key", { headers: { "idempotency-key": "x".repeat(129) } }, 400],
    ["empty declared length", { headers: { "content-length": "" } }, 413],
    ["malformed declared length", { headers: { "content-length": "private" } }, 413],
    ["oversize declared length", { headers: { "content-length": String(64 * 1024 + 1) } }, 413],
  ])("rejects %s before pulling the request body", async (_label, overrides, status) => {
    let pulls = 0;
    let cancellationRequested = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls += 1;
        },
        cancel() {
          cancellationRequested = true;
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const result = await readFoundationWriteRequest(
      request(stream, overrides),
      "CreateProfileFactRequest",
    );

    await expectProblem(
      result,
      status as number,
      status === 413
        ? "payload_too_large"
        : status === 415
          ? "unsupported_media_type"
          : "invalid_request",
    );
    expect(pulls).toBe(0);
    expect(cancellationRequested).toBe(true);
  });

  it("accepts the byte ceiling for reading but rejects an invalid schema", async () => {
    const result = await readFoundationWriteRequest(
      request(new Uint8Array(64 * 1024).fill("x".charCodeAt(0))),
      "CreateProfileFactRequest",
    );

    await expectProblem(result, 400, "invalid_request");
  });

  it("stops on the first byte beyond the ceiling and does not pull later chunks", async () => {
    let pulls = 0;
    let cancellationRequested = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(new Uint8Array(64 * 1024 + 1));
          else controller.enqueue(encoder.encode("private-later-chunk"));
        },
        cancel() {
          cancellationRequested = true;
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const result = await readFoundationWriteRequest(request(stream), "CreateProfileFactRequest");

    await expectProblem(result, 413, "payload_too_large");
    expect(pulls).toBe(1);
    expect(cancellationRequested).toBe(true);
  });

  it("times out a stalled body without awaiting hostile cancellation", async () => {
    let cancellationRequested = false;
    const stream = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancellationRequested = true;
        return new Promise<void>(() => undefined);
      },
    });
    const result = await readFoundationWriteRequest(request(stream), "CreateProfileFactRequest", 1);

    await expectProblem(result, 400, "invalid_request");
    expect(cancellationRequested).toBe(true);
  });

  it("contains aborts, stream failures, invalid UTF-8, malformed JSON, and length mismatches", async () => {
    const controller = new AbortController();
    controller.abort();
    const cases = [
      request(new ReadableStream<Uint8Array>({ start() {} }), { signal: controller.signal }),
      request(
        new ReadableStream<Uint8Array>({
          pull(bodyController) {
            bodyController.error(new Error("candidate-private-stream-error"));
          },
        }),
      ),
      request(new Uint8Array([0xc3, 0x28])),
      request('{"private":"candidate-private-malformed"'),
      request(JSON.stringify(validBodies.CreateProfileFactRequest), {
        headers: { "content-length": "1" },
      }),
    ];

    for (const candidate of cases) {
      const result = await readFoundationWriteRequest(candidate, "CreateProfileFactRequest", 5);
      const problemBody = await expectProblem(result, 400, "invalid_request");
      expect(JSON.stringify(problemBody)).not.toContain("candidate-private");
    }
  });
});

describe("foundation write route composition", () => {
  it.each([
    [getJobPreferences, "/v1/me/job-preferences", {}],
    [getResumes, "/v1/resumes", { documents: [responseDocument] }],
    [
      getProfileFacts,
      "/v1/profile/facts",
      { facts: [responseFact], confirmedCount: 1, proposedCount: 0 },
    ],
  ])("leaves the existing authenticated GET forward unchanged", async (handler, path, value) => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(Response.json(value));

    const response = await handler();

    expect(response.status).toBe(200);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      path,
      { method: "GET" },
      expect.objectContaining({
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
      }),
    );
  });

  it.each([
    [
      "job preferences",
      putJobPreferences,
      "PUT",
      "/v1/me/job-preferences",
      validBodies.PutJobPreferencesRequest,
      204,
      undefined,
    ],
    [
      "resume upload",
      postResume,
      "POST",
      "/v1/resumes/uploads",
      validBodies.CreateResumeUploadRequest,
      201,
      {
        document: responseDocument,
        upload: {
          url: "https://uploads.example.test/synthetic",
          method: "POST",
          fields: { key: "synthetic/quarantine/object" },
          expiresAt: "2099-08-17T12:00:00.000Z",
        },
      },
    ],
    [
      "profile fact create",
      postProfileFact,
      "POST",
      "/v1/profile/facts",
      validBodies.CreateProfileFactRequest,
      201,
      responseFact,
    ],
  ])(
    "forwards an exact validated %s mutation with the caller signal",
    async (_label, handler, method, path, value, responseStatus, responseValue) => {
      mocks.forwardPlatformRequest.mockResolvedValueOnce(
        responseStatus === 204
          ? new Response(null, { status: 204 })
          : Response.json(responseValue, { status: responseStatus as number }),
      );
      const body = JSON.stringify(value);
      const candidate = request(body, { method: method as string });

      const response = await (handler as (request: Request) => Promise<Response>)(candidate);

      expect(response.status).toBe(responseStatus);
      expect(mocks.forwardPlatformRequest).toHaveBeenCalledTimes(1);
      const [forwardedPath, init, dependencies] = mocks.forwardPlatformRequest.mock.calls[0] ?? [];
      expect(forwardedPath).toBe(path);
      expect(init).toEqual({
        method,
        body,
        signal: candidate.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
      });
      expect(dependencies).toMatchObject({
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
      });
    },
  );

  it("forwards an exact validated profile-fact correction", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(Response.json(responseFact));
    const body = JSON.stringify(validBodies.UpdateProfileFactRequest);
    const candidate = request(body, { method: "PATCH" });

    const response = await patchProfileFact(candidate, { params: Promise.resolve({ factId }) });

    expect(response.status).toBe(200);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      `/v1/profile/facts/${factId}`,
      {
        method: "PATCH",
        body,
        signal: candidate.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
      },
      expect.objectContaining({ baseUrl: "http://localhost:4000" }),
    );
  });

  it.each([
    [putJobPreferences, "PUT"],
    [postResume, "POST"],
    [postProfileFact, "POST"],
  ])("does not authenticate or forward an invalid mutation", async (handler, method) => {
    const response = await (handler as (request: Request) => Promise<Response>)(
      request('{"private":"candidate-private-invalid"}', { method }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("candidate-private");
    expect(mocks.getAuth0Client).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("preserves the existing invalid profile-fact identifier response before body processing", async () => {
    const response = await patchProfileFact(request(null, { method: "PATCH" }), {
      params: Promise.resolve({ factId: "candidate-private-invalid-id" }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("candidate-private-invalid-id");
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
