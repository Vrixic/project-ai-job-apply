import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEntitlements } from "../app/api/platform/entitlements/route";
import {
  GET as getJobPreferences,
  PUT as putJobPreferences,
} from "../app/api/platform/job-preferences/route";
import { GET as getOperation } from "../app/api/platform/operations/[operationId]/route";
import { PATCH as patchProfileEntry } from "../app/api/platform/profile/[section]/[recordId]/route";
import {
  GET as getProfileSection,
  POST as postProfileSection,
} from "../app/api/platform/profile/[section]/route";
import { GET as getResumes, POST as postResume } from "../app/api/platform/resumes/route";
import { POST as createSavedJob } from "../app/api/platform/saved-jobs/route";
import { POST as searchSavedJobs } from "../app/api/platform/saved-jobs/search/route";
import {
  type FoundationResponseSchemaName,
  validateFoundationResponse,
} from "./foundation-response-bff";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
  getLazyAuth0Session: vi.fn(() => ({ synthetic: "auth0-client" })),
}));

vi.mock("./platform-api", () => ({
  forwardPlatformRequest: mocks.forwardPlatformRequest,
}));

vi.mock("./auth0", () => ({
  getLazyAuth0Session: mocks.getLazyAuth0Session,
}));

const encoder = new TextEncoder();
const idempotencyKey = "foundation-response-0001";
const documentId = "019b4e12-7ea3-7c36-9357-aea35ab542c3";
const factId = "019b4e12-7ea3-7c36-9357-aea35ab542c4";
const preferenceSetId = "019b4e12-7ea3-7c36-9357-aea35ab542c8";
const operationId = "019b4e12-7ea3-7c36-9357-aea35ab542c9";
const operation = {
  id: operationId,
  kind: "profile_readiness",
  state: "succeeded",
  result: {
    completionPercent: 100,
    missingFields: [],
    calculatedAt: "2026-08-17T12:00:00.000Z",
  },
  errorCode: "profile_readiness_pending",
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};
const operationWithoutErrorCode = {
  id: operation.id,
  kind: operation.kind,
  state: operation.state,
  result: operation.result,
  createdAt: operation.createdAt,
  updatedAt: operation.updatedAt,
};

const preferenceFields = {
  targetRoles: ["Software Engineer"],
  locations: ["Remote - US"],
  workModes: ["remote"],
  employmentTypes: ["full_time"],
  salaryMinimum: 120000,
  salaryCurrency: "USD",
};
const preferenceSet = {
  id: preferenceSetId,
  version: 1,
  updatedAt: "2026-08-17T12:00:00.000Z",
  ...preferenceFields,
};
const putPreferenceResponse = { preferences: preferenceSet, operationId };

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
  name: "TypeScript",
  version: 1,
  origin: "entered",
  displayOrder: 0,
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};
const factCollection = { entries: [profileFact] };
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
const savedJobSnapshot = {
  jobIdAtSave: "019b4e12-7ea3-7c36-9357-aea35ab542c5",
  company: {
    id: "019b4e12-7ea3-7c36-9357-aea35ab542c6",
    name: "Synthetic Company",
    verifiedDomain: "example.test",
  },
  title: "Software Engineer",
  locations: ["Remote - US"],
  department: "Engineering",
  firstObservedAt: "2026-08-01T12:00:00.000Z",
  lastVerifiedAt: "2026-08-17T12:00:00.000Z",
  expiresAt: "2026-09-17T12:00:00.000Z",
};
const savedJob = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542c7",
  requestedJobId: savedJobSnapshot.jobIdAtSave,
  snapshot: savedJobSnapshot,
  availability: {
    state: "available",
    currentJob: {
      id: savedJobSnapshot.jobIdAtSave,
      company: savedJobSnapshot.company,
      title: savedJobSnapshot.title,
      locations: savedJobSnapshot.locations,
      department: savedJobSnapshot.department,
      status: "active",
      firstObservedAt: savedJobSnapshot.firstObservedAt,
      lastVerifiedAt: savedJobSnapshot.lastVerifiedAt,
      expiresAt: savedJobSnapshot.expiresAt,
    },
  },
  savedAt: "2026-08-17T12:00:00.000Z",
};
const unavailableSavedJob = {
  ...savedJob,
  availability: { state: "unavailable" },
};
const savedJobPage = {
  items: [savedJob, unavailableSavedJob],
  nextCursor: "saved_jobs_cursor.signature",
};
const candidateDataExport = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542d1",
  schemaVersion: 1,
  format: "candidate-data-export-v1",
  policyVersion: "policy-2026-08",
  state: "queued",
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};
const candidateDataExportAccess = { export: candidateDataExport };
const accountDeletionRequest = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542d2",
  schemaVersion: 1,
  policyVersion: "policy-2026-08",
  state: "requested",
  version: 1,
  requestedAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
};
const restrictedAnswer = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542d3",
  fieldKey: "authorization.us_authorized",
  valueType: "boolean",
  sensitivity: "restricted",
  state: "active",
  version: 1,
  confirmedAt: "2026-09-29T12:00:00.000Z",
};

function profileEntry(fields: Record<string, unknown>) {
  return {
    id: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
    ...fields,
    version: 1,
    origin: "entered",
    displayOrder: 0,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  };
}

function profileAnswer() {
  return {
    id: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
    question: "Why us?",
    answer: "Synthetic reason.",
    questionKey: "why us",
    version: 1,
    origin: "entered",
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  };
}

const validValues: Record<FoundationResponseSchemaName, unknown> = {
  NotificationDeliveryStatus: {
    email: { address: "person@example.com", state: "verified", codePending: false },
    pushSubscriptions: [
      {
        id: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
        state: "active",
        createdAt: "2026-10-22T12:00:00.000Z",
      },
    ],
  },
  ConfirmNotificationEmailResult: { result: "verified" },
  NotificationPushSubscriptionCreated: { id: "019b4e12-7ea3-7c36-9357-aea35ab542cc" },
  NotificationTestSent: { id: "019b4e12-7ea3-7c36-9357-aea35ab542cc" },
  CanonicalJobDetail: {
    id: "00000000-0000-7000-8000-000000000002",
    company: { id: "00000000-0000-7000-8000-000000000003", name: "Synthetic" },
    title: "Synthetic Engineer",
    locations: ["Synthetic location"],
    description: "Synthetic description",
    status: "active",
    firstObservedAt: "2026-10-09T12:00:00Z",
    lastVerifiedAt: "2026-10-09T12:00:00Z",
    expiresAt: "2026-10-10T12:00:00Z",
    sources: [
      {
        provider: "other",
        provenance: "authorized_fixture",
        canonicalUrl: "https://employer.example/jobs/1",
        firstObservedAt: "2026-10-09T12:00:00Z",
        lastVerifiedAt: "2026-10-09T12:00:00Z",
      },
    ],
  },
  EntitlementSummary: freeEntitlement,
  JobPreferenceSet: preferenceSet,
  PutJobPreferencesResponse: putPreferenceResponse,
  Operation: operationWithoutErrorCode,
  SavedJob: savedJob,
  SavedJobPage: savedJobPage,
  ResumeDocumentCollection: resumeCollection,
  CreateResumeUploadResponse: resumeUploadResponse,
  ProfilePersonal: {
    fullName: "Synthetic Person",
    version: 1,
    origin: "entered",
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
  ProfileEntryReference: {
    section: "skill",
    entryId: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
    version: 1,
  },
  ProfileImportDraftCollection: { drafts: [] },
  ProfileEducationEntry: profileEntry({ school: "Synthetic University" }),
  ProfileEducationEntryCollection: { entries: [profileEntry({ school: "Synthetic University" })] },
  ProfileWorkExperienceEntry: profileEntry({
    company: "Synthetic Systems",
    title: "Engineer",
    startDate: "2020-01-01",
  }),
  ProfileWorkExperienceEntryCollection: {
    entries: [
      profileEntry({ company: "Synthetic Systems", title: "Engineer", startDate: "2020-01-01" }),
    ],
  },
  ProfileSkillEntry: profileEntry({ name: "TypeScript" }),
  ProfileSkillEntryCollection: { entries: [profileEntry({ name: "TypeScript" })] },
  ProfileApplicationAnswer: profileAnswer(),
  ProfileApplicationAnswerCollection: { answers: [profileAnswer()] },
  RestrictedAnswerCollection: { answers: [restrictedAnswer] },
  RestrictedAnswer: restrictedAnswer,
  CandidateDataExport: candidateDataExport,
  CandidateDataExportAccess: candidateDataExportAccess,
  AccountDeletionRequest: accountDeletionRequest,
  BillingSessionLink: { url: "https://checkout.stripe.com/c/pay/cs_test" },
  BillingSubscriptionSync: { changed: true },
  NotificationItem: {
    id: "019d04cf-1f80-7000-8000-00000000a111",
    kind: "application_review_needed",
    urgency: "normal",
    state: "unread",
    applicationId: "019d04cf-1f80-7000-8000-00000000a222",
    sourceRevision: 3,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
    expiresAt: "2026-10-23T12:00:00.000Z",
  },
  NotificationInboxPage: { items: [], unreadCount: 0 },
  NotificationPreferences: {
    version: 0,
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    quietHours: { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
};
const validUpstreamValues: Record<FoundationResponseSchemaName, unknown> = {
  ...validValues,
  Operation: operation,
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
      const expectedStatus =
        schemaName === "CreateResumeUploadResponse" || schemaName === "SavedJob" ? 201 : 200;
      const response = await validateFoundationResponse(
        jsonResponse(
          validUpstreamValues[schemaName as FoundationResponseSchemaName],
          expectedStatus,
          { "x-correlation-id": "synthetic-correlation" },
        ),
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

  it.each([false, true])(
    "accepts and reprojects the exact legacy sponsorship boolean %s for a preference GET",
    async (requiresSponsorship) => {
      const legacy = { ...preferenceSet, requiresSponsorship };
      const response = await validateFoundationResponse(
        jsonResponse(legacy),
        200,
        "JobPreferenceSet",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(legacy);
    },
  );

  it.each([
    { ...preferenceSet, privateDetail: "candidate-private-preference-field" },
    { ...preferenceSet, id: "candidate-private-preference-id" },
    { ...preferenceSet, version: 0, privateDetail: "candidate-private-preference-version" },
    { ...preferenceSet, requiresSponsorship: "candidate-private-preference-legacy" },
    { ...preferenceSet, workModes: ["candidate-private-preference-mode"] },
  ])("rejects a private or malformed preference GET success", async (candidate) => {
    const response = await validateFoundationResponse(
      jsonResponse(candidate),
      200,
      "JobPreferenceSet",
    );
    const body = await response.clone().text();

    await expectUnavailable(response);
    expect(body).not.toContain("candidate-private-preference");
  });

  it("strictly rejects a private preference PUT success without the GET compatibility branch", async () => {
    const privateCanary = "candidate-private-preference-put";
    const response = await validateFoundationResponse(
      jsonResponse({
        ...putPreferenceResponse,
        preferences: { ...preferenceSet, privateDetail: privateCanary },
      }),
      200,
      "PutJobPreferencesResponse",
    );
    const body = await response.clone().text();

    await expectUnavailable(response);
    expect(body).not.toContain(privateCanary);
  });

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
    ["saved job", { ...savedJob, ownerId: "candidate-private-saved-job-owner" }, 201, "SavedJob"],
    [
      "saved-job page",
      { ...savedJobPage, privateCursorState: "candidate-private-saved-job-cursor" },
      200,
      "SavedJobPage",
    ],
    [
      "nested saved-job snapshot",
      {
        ...savedJobPage,
        items: [
          {
            ...savedJob,
            snapshot: {
              ...savedJobSnapshot,
              source: "candidate-private-saved-job-source",
            },
          },
        ],
      },
      200,
      "SavedJobPage",
    ],
  ])("rejects a contract-invalid or private %s success", async (_label, value, status, schema) => {
    const response = await validateFoundationResponse(
      jsonResponse(value, status as number),
      status as number,
      schema as FoundationResponseSchemaName,
    );
    const body = await response.clone().text();

    await expectUnavailable(response);
    expect(body).not.toContain("candidate-private-saved-job");
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
      '"name":"TypeScript"',
      `"name":"${privateCanary}","name":"TypeScript"`,
    );
    const response = await validateFoundationResponse(
      new Response(raw, { status: 200, headers: { "content-type": "application/json" } }),
      200,
      "ProfileSkillEntry",
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
    ["job-preference GET", () => getJobPreferences(), 200, preferenceSet],
    [
      "job-preference PUT",
      () => putJobPreferences(mutationRequest("PUT", preferenceFields)),
      200,
      putPreferenceResponse,
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
      "profile-section GET",
      () =>
        getProfileSection(new Request("http://localhost/api/platform/profile/skill-entries"), {
          params: Promise.resolve({ section: "skill-entries" }),
        }),
      200,
      factCollection,
    ],
    [
      "profile-section POST",
      () =>
        postProfileSection(mutationRequest("POST", { name: "TypeScript" }), {
          params: Promise.resolve({ section: "skill-entries" }),
        }),
      201,
      profileFact,
    ],
    [
      "profile-section PATCH",
      () =>
        patchProfileEntry(mutationRequest("PATCH", { expectedVersion: 1, category: "Languages" }), {
          params: Promise.resolve({ section: "skill-entries", recordId: factId }),
        }),
      200,
      profileFact,
    ],
    [
      "saved-job POST",
      () => createSavedJob(mutationRequest("POST", { jobId: savedJob.requestedJobId })),
      201,
      savedJob,
    ],
    [
      "saved-job search POST",
      () => searchSavedJobs(mutationRequest("POST", { limit: 25 })),
      200,
      savedJobPage,
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

  it.each([false, true])(
    "preserves legacy sponsorship boolean %s only on the exact preference GET response",
    async (requiresSponsorship) => {
      const legacy = { ...preferenceSet, requiresSponsorship };
      mocks.forwardPlatformRequest.mockResolvedValueOnce(jsonResponse(legacy));

      const response = await getJobPreferences();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(legacy);
      expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
        "/v1/me/job-preferences",
        { method: "GET" },
        expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
      );
    },
  );

  it.each([
    ["GET", () => getJobPreferences(), { ...preferenceSet, privateDetail: "private" }],
    [
      "PUT",
      () => putJobPreferences(mutationRequest("PUT", preferenceFields)),
      { ...putPreferenceResponse, privateDetail: "private" },
    ],
  ])("contains a private preference %s success", async (_method, run, invalid) => {
    const privateCanary = "candidate-private-preference-route-success";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ ...invalid, privateDetail: privateCanary }),
    );

    const response = await (run as () => Promise<Response>)();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain(privateCanary);
  });

  it("preserves the exact preference PUT body, idempotency key, caller signal, and auth", async () => {
    const request = mutationRequest("PUT", preferenceFields);
    mocks.forwardPlatformRequest.mockResolvedValueOnce(jsonResponse(putPreferenceResponse));

    const response = await putJobPreferences(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(putPreferenceResponse);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      "/v1/me/job-preferences",
      {
        method: "PUT",
        body: JSON.stringify(preferenceFields),
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
      },
      expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
    );
  });

  it.each([
    [
      "saved-job create",
      createSavedJob,
      { jobId: savedJob.requestedJobId },
      "/v1/saved-jobs",
      "SavedJob",
      201,
    ],
    [
      "saved-job search",
      searchSavedJobs,
      { limit: 25 },
      "/v1/saved-jobs/search",
      "SavedJobPage",
      200,
    ],
  ])(
    "forwards the exact %s request and contains a private success",
    async (_label, run, requestBody, path, _schema, status) => {
      const privateCanary = "candidate-private-saved-job-route-success";
      const request = mutationRequest("POST", requestBody);
      const invalid =
        status === 201
          ? { ...savedJob, ownerId: privateCanary }
          : { ...savedJobPage, privateCursorState: privateCanary };
      mocks.forwardPlatformRequest.mockResolvedValueOnce(jsonResponse(invalid, status as number));

      const response = await (run as (request: Request) => Promise<Response>)(request);
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).not.toContain(privateCanary);
      expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
        path,
        {
          method: "POST",
          body: JSON.stringify(requestBody),
          signal: request.signal,
          headers:
            status === 201
              ? { "content-type": "application/json", "idempotency-key": idempotencyKey }
              : { "content-type": "application/json" },
        },
        expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
      );
    },
  );

  it("forwards the exact operation request and contains a private failure", async () => {
    const request = new Request(`http://localhost/api/platform/operations/${operationId}`);
    const privateCanary = "candidate-private-operation-route-success";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ ...operation, privateCanary }),
    );

    const response = await getOperation(request, { params: Promise.resolve({ operationId }) });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain(privateCanary);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      `/v1/operations/${operationId}`,
      { method: "GET", signal: request.signal },
      expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
    );
  });

  it("projects an exact valid operation response without leaking errorCode", async () => {
    const privateCanary = "candidate-private-operation-error-code";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ ...operation, errorCode: privateCanary }),
    );

    const response = await getOperation(
      new Request(`http://localhost/api/platform/operations/${operationId}`),
      { params: Promise.resolve({ operationId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(operationWithoutErrorCode);
    expect(body).not.toHaveProperty("errorCode");
    expect(JSON.stringify(body)).not.toContain(privateCanary);
  });
});
