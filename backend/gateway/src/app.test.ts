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
import type { PendingOutboxEvent, ProfileStore } from "@ai-job-apply/profile-service";
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
  private user: CurrentUser | undefined;
  private preferences: JobPreferenceSet | undefined;
  private readonly operations = new Map<string, Operation>();
  private readonly idempotency = new Map<
    string,
    { hash: string; response: PutJobPreferencesResponse }
  >();

  async resolveUser(principal: AuthPrincipal): Promise<CurrentUser> {
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

  async getPendingOutboxEvents(): Promise<PendingOutboxEvent[]> {
    return [];
  }
  async markOutboxPublished(): Promise<void> {}
  async getPreferencesById(): Promise<JobPreferenceSet | null> {
    return this.preferences ?? null;
  }
  async markOperationRunning(): Promise<void> {}
  async completeReadinessOperation(
    _operationId: string,
    _preferenceSetId: string,
    _readiness: ProfileReadiness,
  ): Promise<void> {}
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

async function createApp() {
  const issuer = await createTestTokenIssuer();
  const store = new MemoryProfileStore();
  const app = await createGatewayApplication({
    store,
    verifier: issuer.verifier,
    releaseSha: "test",
  });
  return { app, issuer };
}

describe("candidate API", () => {
  let app: NestFastifyApplication;
  let issuer: Awaited<ReturnType<typeof createTestTokenIssuer>>;

  beforeAll(async () => {
    const setup = await createApp();
    app = setup.app;
    issuer = setup.issuer;
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
