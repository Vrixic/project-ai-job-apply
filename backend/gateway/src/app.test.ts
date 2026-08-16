import "reflect-metadata";
import type {
  CreateProfileFactRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CurrentUser,
  JobPreferenceSet,
  Operation,
  ProfileFact,
  ProfileFactCollection,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ResumeDocument,
  ResumeDocumentCollection,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import { type DocumentStore, ResumeUploadRegistrationError } from "@ai-job-apply/documents-service";
import {
  type ActiveJobRecord,
  type ActiveJobSearchInput,
  type JobCatalogReader,
  JobSearchCatalogChangedError,
} from "@ai-job-apply/jobs-service";
import {
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
  type SavedJobs,
} from "@ai-job-apply/matching-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privacySafeRequestFailure } from "./app.module.js";
import { createGatewayApplication } from "./application.js";
import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
} from "./lambda.js";

class MemoryProfileStore implements ProfileStore {
  resolveUserCalls = 0;
  private user: CurrentUser | undefined;
  private preferences: JobPreferenceSet | undefined;
  private readonly operations = new Map<string, Operation>();
  private readonly facts = new Map<string, ProfileFact>();
  private readonly idempotency = new Map<
    string,
    { hash: string; response: PutJobPreferencesResponse }
  >();

  seedFact(fact: ProfileFact): void {
    this.facts.set(fact.id, fact);
  }

  async resolveUser(principal: AuthPrincipal): Promise<CurrentUser> {
    this.resolveUserCalls += 1;
    this.user ??= { id: uuidv7(), ...(principal.email ? { email: principal.email } : {}) };
    return this.user;
  }

  async getPreferences(): Promise<JobPreferenceSet | null> {
    return this.preferences ?? null;
  }

  async putPreferences(
    _userId: string,
    input: PutJobPreferencesRequest,
    idempotencyKey: string,
  ): Promise<PutJobPreferencesResponse> {
    const hash = JSON.stringify(input);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.hash !== hash) {
        const { IdempotencyConflictError } = await import("@ai-job-apply/profile-service");
        throw new IdempotencyConflictError();
      }
      return existing.response;
    }
    this.preferences = {
      id: this.preferences?.id ?? uuidv7(),
      version: (this.preferences?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      ...input,
    };
    const operationId = uuidv7();
    this.operations.set(operationId, {
      id: operationId,
      kind: "profile_readiness",
      state: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const response = { preferences: this.preferences, operationId };
    this.idempotency.set(idempotencyKey, { hash, response });
    return response;
  }

  async getOperation(_userId: string, operationId: string): Promise<Operation | null> {
    return this.operations.get(operationId) ?? null;
  }

  async listProfileFacts(): Promise<ProfileFactCollection> {
    const facts = [...this.facts.values()];
    return {
      facts,
      confirmedCount: facts.filter(
        (fact) => fact.verification === "confirmed" && fact.availability?.state !== "invalidated",
      ).length,
      proposedCount: facts.filter(
        (fact) => fact.verification === "proposed" && fact.availability?.state !== "invalidated",
      ).length,
    };
  }

  async createProfileFact(_userId: string, input: CreateProfileFactRequest): Promise<ProfileFact> {
    const timestamp = new Date().toISOString();
    const fact: ProfileFact = {
      id: uuidv7(),
      ...input,
      verification: "confirmed",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.facts.set(fact.id, fact);
    return fact;
  }

  async updateProfileFact(
    _userId: string,
    factId: string,
    input: UpdateProfileFactRequest,
  ): Promise<ProfileFact | null> {
    const current = this.facts.get(factId);
    if (!current) {
      return null;
    }
    if (current.version !== input.expectedVersion) {
      const { ProfileFactVersionConflictError } = await import("@ai-job-apply/profile-service");
      throw new ProfileFactVersionConflictError();
    }
    const next: ProfileFact = {
      ...current,
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.verification ? { verification: input.verification } : {}),
      ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
      ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.facts.set(factId, next);
    return next;
  }

  async getPreferencesById(): Promise<JobPreferenceSet | null> {
    return this.preferences ?? null;
  }
  async markOperationRunning(): Promise<void> {}
  async completeReadinessOperation(
    _operationId: string,
    _preferenceSetId: string,
    _readiness: ProfileReadiness,
  ): Promise<void> {}
  async failReadinessOperation(): Promise<void> {}
  async failDurableReadinessOperation(): Promise<void> {}
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

class MemoryJobCatalog implements JobCatalogReader {
  lastSearchInput: ActiveJobSearchInput | undefined;
  catalogChanged = false;
  readonly job: ActiveJobRecord = {
    id: uuidv7(),
    company: {
      id: uuidv7(),
      name: "Synthetic Company",
      verifiedDomain: "example.test",
    },
    title: "Software Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    description: "A synthetic active job used for gateway verification.",
    status: "active",
    firstObservedAt: new Date("2026-08-11T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-08-11T12:00:00.000Z"),
    expiresAt: new Date("2026-09-10T12:00:00.000Z"),
    sources: [
      {
        provider: "greenhouse",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.example.test/synthetic/1",
        firstObservedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastVerifiedAt: new Date("2026-08-11T12:00:00.000Z"),
      },
    ],
  };

  async getActiveJob(jobId: string): Promise<ActiveJobRecord | null> {
    return jobId === this.job.id ? this.job : null;
  }

  async getCatalogRevision(): Promise<string> {
    return "1";
  }

  async resolveActiveJobSummaries(jobIds: readonly string[]) {
    return {
      catalogRevision: "1",
      items: jobIds.includes(this.job.id)
        ? [
            {
              requestedJobId: this.job.id,
              job: {
                id: this.job.id,
                company: this.job.company,
                title: this.job.title,
                locations: this.job.locations,
                ...(this.job.department ? { department: this.job.department } : {}),
                status: "active" as const,
                firstObservedAt: this.job.firstObservedAt,
                lastVerifiedAt: this.job.lastVerifiedAt,
                expiresAt: this.job.expiresAt,
              },
            },
          ]
        : [],
    };
  }

  async searchActiveJobs(input: ActiveJobSearchInput) {
    this.lastSearchInput = input;
    if (this.catalogChanged) {
      throw new JobSearchCatalogChangedError();
    }
    return {
      items: [
        {
          id: this.job.id,
          company: this.job.company,
          title: this.job.title,
          locations: this.job.locations,
          ...(this.job.department ? { department: this.job.department } : {}),
          status: "active" as const,
          firstObservedAt: this.job.firstObservedAt,
          lastVerifiedAt: this.job.lastVerifiedAt,
          expiresAt: this.job.expiresAt,
        },
      ],
      ...(input.cursor ? {} : { nextCursor: "opaque_cursor_v1.signature_v1" }),
    };
  }

  async ping(): Promise<void> {}
}

class MemorySavedJobs implements SavedJobs {
  readonly items = new Map<string, SavedJob[]>();
  createFailure: Error | undefined;

  async create(ownerUserId: string, requestedJobId: string): Promise<SavedJob> {
    if (this.createFailure) throw this.createFailure;
    const saved: SavedJob = {
      id: uuidv7(),
      requestedJobId,
      snapshot: {
        jobIdAtSave: requestedJobId,
        company: { id: uuidv7(), name: "Synthetic Company" },
        title: "Software Engineer",
        locations: ["Remote - US"],
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-09-10T12:00:00.000Z",
      },
      availability: { state: "unavailable" },
      savedAt: "2026-08-15T12:00:00.000Z",
    };
    this.items.set(ownerUserId, [saved, ...(this.items.get(ownerUserId) ?? [])]);
    return saved;
  }

  async list(ownerUserId: string, _input: SavedJobSearchRequest): Promise<SavedJobPage> {
    return { items: this.items.get(ownerUserId) ?? [] };
  }

  async delete(ownerUserId: string, savedJobId: string): Promise<void> {
    this.items.set(
      ownerUserId,
      (this.items.get(ownerUserId) ?? []).filter((item) => item.id !== savedJobId),
    );
  }

  async ping(): Promise<void> {}
}

class MemoryDocumentStore implements DocumentStore {
  private readonly documents: ResumeDocument[] = [];
  private readonly responses = new Map<string, CreateResumeUploadResponse>();

  async listResumeDocuments(): Promise<ResumeDocumentCollection> {
    return { documents: [...this.documents] };
  }

  async createResumeUpload(
    _userId: string,
    input: CreateResumeUploadRequest,
    idempotencyKey: string,
  ): Promise<CreateResumeUploadResponse> {
    const existing = this.responses.get(idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const document: ResumeDocument = {
      id: uuidv7(),
      ...input,
      status: "awaiting_upload",
      createdAt: now,
      updatedAt: now,
    };
    const response: CreateResumeUploadResponse = {
      document,
      upload: {
        url: "https://candidate-documents.example.test/",
        method: "POST",
        fields: { key: `quarantine/${document.id}/source`, policy: "signed-policy" },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    };
    this.documents.unshift(document);
    this.responses.set(idempotencyKey, response);
    return response;
  }

  async close(): Promise<void> {}
}

async function createApp() {
  const issuer = await createTestTokenIssuer();
  const store = new MemoryProfileStore();
  const catalog = new MemoryJobCatalog();
  const documents = new MemoryDocumentStore();
  const savedJobs = new MemorySavedJobs();
  const app = await createGatewayApplication({
    store,
    catalog,
    savedJobs,
    documents,
    verifier: issuer.verifier,
    releaseSha: "test",
  });
  return { app, issuer, catalog, store, savedJobs };
}

describe("candidate API", () => {
  let app: NestFastifyApplication;
  let issuer: Awaited<ReturnType<typeof createTestTokenIssuer>>;
  let catalog: MemoryJobCatalog;
  let store: MemoryProfileStore;
  let savedJobs: MemorySavedJobs;

  beforeAll(async () => {
    const setup = await createApp();
    app = setup.app;
    issuer = setup.issuer;
    catalog = setup.catalog;
    store = setup.store;
    savedJobs = setup.savedJobs;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_required");
  });

  it("classifies internal failures without retaining messages, stacks, or unknown routes", () => {
    const failure = Object.assign(
      new Error("Bearer secret-token for candidate@example.test in Atlanta"),
      {
        code: "42P01",
        stack: "sensitive stack and filesystem path",
      },
    );

    const diagnostic = privacySafeRequestFailure(failure, "/v1/jobs/:jobId");
    expect(diagnostic).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/jobs/:jobId",
      error_type: "Error",
      error_code: "42P01",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-token");
    expect(JSON.stringify(diagnostic)).not.toContain("candidate@example.test");
    expect(JSON.stringify(diagnostic)).not.toContain("Atlanta");
    expect(JSON.stringify(diagnostic)).not.toContain("filesystem");
    expect(privacySafeRequestFailure({ name: "bad value", code: "secret-value" }, "/raw")).toEqual({
      event: "unhandled_request_failure",
      route: "unknown",
      error_type: "UnknownError",
      error_code: "UNKNOWN",
    });

    const registrationFailure = new ResumeUploadRegistrationError(
      "GRANT_SIGN",
      new Error("temporary credential and candidate content must remain private"),
    );
    expect(privacySafeRequestFailure(registrationFailure, "/v1/resumes/uploads")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/resumes/uploads",
      error_type: "ResumeUploadRegistrationError",
      error_code: "DOCUMENT_GRANT_SIGN",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(registrationFailure, "/v1/resumes/uploads")),
    ).not.toContain("candidate content");
  });

  it("preserves an API Gateway principal through the real Fastify injection lifecycle", async () => {
    const issuerUrl = "https://identity.example.test/";
    const audience = "ai-job-apply-api";
    const principalBridge = createInvocationPrincipalBridge();
    const lambdaApp = await createGatewayApplication({
      store: new MemoryProfileStore(),
      catalog: new MemoryJobCatalog(),
      savedJobs: new MemorySavedJobs(),
      documents: new MemoryDocumentStore(),
      verifier: principalBridge.verifier,
      releaseSha: "lambda-principal-bridge-test",
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve(lambdaApp),
      issuer: issuerUrl,
      audience,
      principalBridge,
    });
    const input = {
      version: "2.0",
      routeKey: "GET /v1/me",
      rawPath: "/v1/me",
      rawQueryString: "",
      headers: { authorization: "Bearer caller-token-must-not-reach-fastify" },
      requestContext: {
        accountId: "123456789012",
        apiId: "api-id",
        domainName: "api.example.test",
        domainPrefix: "api",
        http: {
          method: "GET",
          path: "/v1/me",
          protocol: "HTTP/1.1",
          sourceIp: "203.0.113.1",
          userAgent: "test",
        },
        requestId: "request-id-fastify-bridge",
        routeKey: "GET /v1/me",
        stage: "$default",
        time: "02/Aug/2026:00:00:00 +0000",
        timeEpoch: 1_775_000_000_000,
        authorizer: {
          jwt: {
            claims: {
              iss: issuerUrl,
              sub: "auth0|candidate-fastify",
              aud: [audience],
              scope: "profile:read profile:write",
            },
            scopes: ["profile:read", "profile:write"],
          },
        },
      },
      isBase64Encoded: false,
    } as AuthorizedHttpApiEvent;

    try {
      const response = await handler(input);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body ?? "{}").id).toBeTypeOf("string");
    } finally {
      await lambdaApp.close();
    }
  });

  it("persists preferences idempotently and exposes an owned operation", async () => {
    const token = await issuer.issue("candidate-1", { email: "candidate@example.test" });
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: ["New York, NY"],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "foundation-test-key-0001",
    };
    const first = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    const replay = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());

    const preferences = await app.inject({
      method: "GET",
      url: "/v1/me/job-preferences",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preferences.statusCode).toBe(200);
    expect(preferences.json()).toMatchObject(payload);

    const operation = await app.inject({
      method: "GET",
      url: `/v1/operations/${first.json().operationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(operation.statusCode).toBe(200);
    expect(operation.json().state).toBe("queued");
  });

  it("creates, lists, and corrects owned profile facts through explicit versions", async () => {
    const token = await issuer.issue("candidate-profile-facts");
    const authorization = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/v1/profile/facts",
      headers: { ...authorization, "idempotency-key": "profile-fact-create-0001" },
      payload: {
        kind: "skill",
        key: "programming_language",
        value: "TypeScript",
        sensitivity: "standard",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      verification: "confirmed",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/profile/facts",
      headers: authorization,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ confirmedCount: 1, proposedCount: 0 });

    const corrected = await app.inject({
      method: "PATCH",
      url: `/v1/profile/facts/${created.json().id}`,
      headers: { ...authorization, "idempotency-key": "profile-fact-update-0001" },
      payload: { expectedVersion: 1, value: "TypeScript and JavaScript" },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ version: 2, value: "TypeScript and JavaScript" });

    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/profile/facts/${created.json().id}`,
      headers: { ...authorization, "idempotency-key": "profile-fact-update-0002" },
      payload: { expectedVersion: 1, value: "stale correction" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("version_conflict");
  });

  it("returns proposal evidence and additive system availability without sensitive source data", async () => {
    const token = await issuer.issue("candidate-profile-proposal");
    const factId = uuidv7();
    const documentId = uuidv7();
    store.seedFact({
      id: factId,
      kind: "skill",
      key: "skill",
      value: "TypeScript",
      verification: "confirmed",
      availability: { state: "invalidated", reasonCode: "source_security_hold" },
      sensitivity: "standard",
      source: { type: "resume", reference: `resume:${documentId}:v1:resume-parser-v1` },
      evidence: {
        supportingSpans: [
          {
            documentId,
            documentVersion: 1,
            parserVersion: "resume-parser-v1",
            blockIndex: 0,
            startOffset: 8,
            endOffset: 18,
            page: 1,
          },
        ],
      },
      version: 2,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:05:00.000Z",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile/facts",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      facts: expect.arrayContaining([
        expect.objectContaining({
          id: factId,
          verification: "confirmed",
          availability: { state: "invalidated", reasonCode: "source_security_hold" },
          evidence: { supportingSpans: [expect.objectContaining({ documentId, blockIndex: 0 })] },
        }),
      ]),
    });
    expect(response.body).not.toContain("objectKey");
    expect(response.body).not.toContain("sha256");
    expect(response.body).not.toContain("excerpt");
  });

  it("returns an active redacted job only with the dedicated read scope", async () => {
    const jobToken = await issuer.issue("candidate-job-reader", { scope: "jobs:read" });
    const profileToken = await issuer.issue("candidate-profile-reader", {
      scope: "profile:read",
    });

    const identityWritesBeforeJobReads = store.resolveUserCalls;
    const accepted = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id}`,
      headers: { authorization: `Bearer ${jobToken}` },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id}`,
      headers: { authorization: `Bearer ${profileToken}` },
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/jobs/${uuidv7()}`,
      headers: { authorization: `Bearer ${jobToken}` },
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/jobs/not-a-uuid",
      headers: { authorization: `Bearer ${jobToken}` },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      id: catalog.job.id,
      status: "active",
      company: { name: "Synthetic Company" },
      sources: [{ provenance: "authorized_fixture" }],
    });
    expect(accepted.json().sources[0]).not.toHaveProperty("rawSnapshot");
    expect(accepted.json().sources[0]).not.toHaveProperty("externalJobId");
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("forbidden");
    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
    expect(store.resolveUserCalls).toBe(identityWritesBeforeJobReads);
  });

  it("searches active jobs through a strict privacy-safe body and dedicated read scope", async () => {
    const jobToken = await issuer.issue("candidate-job-search", { scope: "jobs:read" });
    const profileToken = await issuer.issue("candidate-job-search-wrong-scope", {
      scope: "profile:read",
    });
    const payload = {
      query: "software engineer",
      filters: {
        title: "Software Engineer",
        company: "Synthetic Company",
        location: "Remote - US",
        verifiedWithinDays: 30,
      },
      sort: "relevance",
      pageSize: 10,
    };
    const identityWritesBeforeSearch = store.resolveUserCalls;
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload,
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${profileToken}` },
      payload,
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload: { ...payload, sort: "match", pageSize: 26 },
    });
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      payload,
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: {
        authorization: `Bearer ${jobToken}`,
        "content-type": "application/json",
      },
      payload: '{"query":"must-not-leak"',
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.json()).toEqual({
      items: [
        expect.objectContaining({
          id: catalog.job.id,
          status: "active",
          company: {
            id: catalog.job.company.id,
            name: "Synthetic Company",
            verifiedDomain: "example.test",
          },
        }),
      ],
      nextCursor: "opaque_cursor_v1.signature_v1",
    });
    expect(accepted.json().items[0]).not.toHaveProperty("description");
    expect(catalog.lastSearchInput).toEqual(payload);
    expect(forbidden.statusCode).toBe(403);
    expect(unauthenticated.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("must-not-leak");
    expect(invalid.json().detail).not.toContain("software engineer");
    expect(store.resolveUserCalls).toBe(identityWritesBeforeSearch);

    catalog.catalogChanged = true;
    const changed = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload: { ...payload, cursor: "opaque_cursor_v1.signature_v1" },
    });
    catalog.catalogChanged = false;
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({
      code: "job_search_catalog_changed",
      title: "Job catalog changed",
    });
    expect(changed.json().detail).toContain("restart the search");
  });

  it("keeps saved-job mutations behind jobs:write and reads owner-scoped with jobs:read", async () => {
    const readToken = await issuer.issue("candidate-saved-reader", { scope: "jobs:read" });
    const writeToken = await issuer.issue("candidate-saved-writer", { scope: "jobs:write" });
    const createPayload = { jobId: catalog.job.id };
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs",
      headers: {
        authorization: `Bearer ${readToken}`,
        "idempotency-key": "saved-job-gateway-forbidden-0001",
      },
      payload: createPayload,
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "idempotency-key": "saved-job-gateway-create-0001",
      },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json()).toMatchObject({ requestedJobId: catalog.job.id });
    expect(created.json()).not.toHaveProperty("ownerUserId");

    const listed = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs/search",
      headers: { authorization: `Bearer ${readToken}` },
      payload: { pageSize: 25 },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().items).toHaveLength(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/saved-jobs/${created.json().id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    const repeated = await app.inject({
      method: "DELETE",
      url: `/v1/saved-jobs/${created.json().id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers["cache-control"]).toBe("no-store");
    expect(repeated.statusCode).toBe(204);
    expect(repeated.headers["cache-control"]).toBe("no-store");

    for (const [failure, code] of [
      [new SavedJobLimitError(), "saved_job_limit_reached"],
      [new SavedJobIdempotencyLimitError(), "saved_job_command_limit_reached"],
    ] as const) {
      savedJobs.createFailure = failure;
      const limited = await app.inject({
        method: "POST",
        url: "/v1/saved-jobs",
        headers: {
          authorization: `Bearer ${writeToken}`,
          "idempotency-key": `saved-job-gateway-limit-${code}`,
        },
        payload: createPayload,
      });
      expect(limited.statusCode).toBe(409);
      expect(limited.headers["cache-control"]).toBe("no-store");
      expect(limited.json()).toMatchObject({ code });
    }
    savedJobs.createFailure = undefined;
  });

  it("registers and lists resume uploads without proxying candidate bytes", async () => {
    const token = await issuer.issue("candidate-resume", {
      scope: "documents:read documents:write",
    });
    const authorization = { authorization: `Bearer ${token}` };
    const payload: CreateResumeUploadRequest = {
      fileName: "synthetic-resume.pdf",
      mediaType: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/resumes/uploads",
      headers: { ...authorization, "idempotency-key": "resume-upload-test-0001" },
      payload,
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/resumes",
      headers: authorization,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      document: { ...payload, status: "awaiting_upload" },
      upload: { method: "POST" },
    });
    expect(created.json().document).not.toHaveProperty("sourceObjectKey");
    expect(listed.statusCode).toBe(200);
    expect(listed.json().documents).toHaveLength(1);

    const missingScope = await issuer.issue("candidate-resume-no-scope", {
      scope: "profile:read",
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/resumes",
      headers: { authorization: `Bearer ${missingScope}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("enforces read and write scopes at the application boundary", async () => {
    const readOnlyToken = await issuer.issue("candidate-read-only", { scope: "profile:read" });
    const writeOnlyToken = await issuer.issue("candidate-write-only", { scope: "profile:write" });
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };

    const write = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: {
        authorization: `Bearer ${readOnlyToken}`,
        "idempotency-key": "scope-denial-test-0001",
      },
      payload,
    });
    const read = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${writeOnlyToken}` },
    });

    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe("forbidden");
    expect(write.headers["cache-control"]).toBe("no-store");
    expect(read.statusCode).toBe(403);
    expect(read.json().code).toBe("forbidden");
    expect(read.headers["cache-control"]).toBe("no-store");
  });

  it("rejects conflicting idempotency replays and incomplete command metadata", async () => {
    const token = await issuer.issue("candidate-idempotency");
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "conflict-test-key-0001",
    };
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const accepted = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload: { ...payload, targetRoles: ["Platform Engineer"] },
    });
    const missingKey = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(accepted.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("idempotency_conflict");
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().code).toBe("invalid_request");
  });

  it("rejects removed post-submission fields", async () => {
    const token = await issuer.issue("candidate-1");
    const response = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "foundation-test-key-0002",
      },
      payload: {
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        interviewStatus: "scheduled",
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
