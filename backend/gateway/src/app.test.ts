import "reflect-metadata";
import type {
  CurrentUser,
  JobPreferenceSet,
  Operation,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import type { ActiveJobRecord, JobCatalogReader } from "@ai-job-apply/jobs-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  private readonly idempotency = new Map<
    string,
    { hash: string; response: PutJobPreferencesResponse }
  >();

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

  async ping(): Promise<void> {}
}

async function createApp() {
  const issuer = await createTestTokenIssuer();
  const store = new MemoryProfileStore();
  const catalog = new MemoryJobCatalog();
  const app = await createGatewayApplication({
    store,
    catalog,
    verifier: issuer.verifier,
    releaseSha: "test",
  });
  return { app, issuer, catalog, store };
}

describe("candidate API", () => {
  let app: NestFastifyApplication;
  let issuer: Awaited<ReturnType<typeof createTestTokenIssuer>>;
  let catalog: MemoryJobCatalog;
  let store: MemoryProfileStore;

  beforeAll(async () => {
    const setup = await createApp();
    app = setup.app;
    issuer = setup.issuer;
    catalog = setup.catalog;
    store = setup.store;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_required");
  });

  it("preserves an API Gateway principal through the real Fastify injection lifecycle", async () => {
    const issuerUrl = "https://identity.example.test/";
    const audience = "ai-job-apply-api";
    const principalBridge = createInvocationPrincipalBridge();
    const lambdaApp = await createGatewayApplication({
      store: new MemoryProfileStore(),
      catalog: new MemoryJobCatalog(),
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
