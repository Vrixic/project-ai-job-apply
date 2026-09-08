import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AwsD2IdentifierOnlyNudgeTransport,
  createConfiguredD2CommunityLambdaConfiguration,
  createConfiguredD2TrustSignalLambdaConfiguration,
  parseD2CommunityRuntimePolicy,
  parseD2ProviderVerificationRegistrations,
} from "./d2-community-runtime.js";

function runtimePolicy() {
  return {
    processing: {
      version: "d2-processing.v1",
      workerId: "d2:processing",
      batchLimit: 5,
      maxAttempts: 3,
      claimLeaseMilliseconds: 30_000,
      retryDelayMilliseconds: [1_000, 2_000],
    },
    contributionDelivery: {
      workerId: "d2:jobs-delivery",
      batchLimit: 5,
      maxAttempts: 3,
      claimLeaseMilliseconds: 30_000,
      retryDelayMilliseconds: [1_000, 2_000],
    },
    trustDelivery: {
      workerId: "d2:trust-delivery",
      batchLimit: 5,
      maxAttempts: 3,
      claimLeaseMilliseconds: 30_000,
      retryDelayMilliseconds: [1_000, 2_000],
    },
  };
}

function environment(): NodeJS.ProcessEnv {
  const { publicKey } = generateKeyPairSync("ed25519");
  return {
    NODE_ENV: "test",
    AWS_REGION: "us-east-2",
    DATABASE_URL: "postgres://candidate:local@localhost:5432/ai_job_apply",
    D2_COMMUNITY_RUNTIME_ENABLED: "true",
    D2_COMMUNITY_ACCOUNT_ID: "123456789012",
    D2_COMMUNITY_REGION: "us-east-2",
    D2_COMMUNITY_SCHEDULE_RULE_ARN:
      "arn:aws:events:us-east-2:123456789012:rule/development-d2-community-batch",
    D2_TRUST_SIGNAL_QUEUE_ARN: "arn:aws:sqs:us-east-2:123456789012:development-d2-trust-signals",
    D2_TRUST_SIGNAL_QUEUE_URL:
      "https://sqs.us-east-2.amazonaws.com/123456789012/development-d2-trust-signals",
    D2_COMMUNITY_RUNTIME_POLICY_JSON: JSON.stringify(runtimePolicy()),
    JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: JSON.stringify({ configured: true }),
    JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON: JSON.stringify({
      "d2-test-key": publicKey.export({ format: "pem", type: "spki" }).toString(),
    }),
    D2_TRUST_REVIEWER_ASSIGNMENTS_JSON: JSON.stringify([
      {
        issuer: "https://identity.example.test/",
        subject: "auth0|d2-case-opener",
        roles: ["case_opener"],
        verifiedRequesterTakedown: false,
      },
    ]),
    D2_TRUST_EVIDENCE_ALLOWLIST_JSON: "[]",
    D2_TRUST_POLICY_VERSION: "d2-trust.v1",
    D2_TRUST_APPEAL_WINDOW_MILLISECONDS: "86400000",
    D2_TRUST_SYSTEM_ACTOR_ID: "019d04cf-1f80-7000-8000-000000000099",
  };
}

describe("D2 community runtime composition", () => {
  it("composes the exact development authority without signed policy and preserves the runtime kill switch", async () => {
    const values: NodeJS.ProcessEnv = {
      ...environment(),
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
    };
    delete values.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON;
    delete values.JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON;
    const resolveDatabaseUrl = vi.fn(async () => "postgres://resolved/private");
    const configured = await createConfiguredD2CommunityLambdaConfiguration(values, {
      resolveDatabaseUrl,
      createDatabase: () => Object.assign(vi.fn(), { begin: vi.fn() }) as never,
      createSqsSender: () => ({ send: vi.fn() }),
      now: () => new Date("2050-09-08T12:00:00.000Z"),
    });
    expect(configured.enabled).toBe(true);
    if (!configured.enabled || !configured.jobs.runtime.enabled) throw new Error("fixture");
    expect(configured.jobs.runtime.capability).toHaveProperty("mode", "development");
    expect(configured.jobs.runtime.independentVerifier).toBeDefined();
    expect(configured.jobs.runtime.trust).toBeDefined();
    await expect(
      createConfiguredD2CommunityLambdaConfiguration({
        ...values,
        D2_DEPLOYMENT_ENVIRONMENT: "production",
      }),
    ).rejects.toThrow("development environment");
    resolveDatabaseUrl.mockClear();
    expect(
      await createConfiguredD2CommunityLambdaConfiguration(
        { ...values, D2_COMMUNITY_RUNTIME_ENABLED: "false" },
        { resolveDatabaseUrl },
      ),
    ).toEqual({ enabled: false });
    expect(resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("stays inert without the exact enabled value and does not resolve a secret", async () => {
    const resolveDatabaseUrl = vi.fn();
    await expect(
      createConfiguredD2CommunityLambdaConfiguration(
        { D2_COMMUNITY_RUNTIME_ENABLED: "false" },
        { resolveDatabaseUrl },
      ),
    ).resolves.toEqual({ enabled: false });
    expect(resolveDatabaseUrl).not.toHaveBeenCalled();
  });

  it("parses only exact, bounded and monotonic delivery policies", () => {
    expect(parseD2CommunityRuntimePolicy(JSON.stringify(runtimePolicy()))).toMatchObject({
      processing: { version: "d2-processing.v1", batchLimit: 5 },
      trustDelivery: { maxAttempts: 3, retryDelayMilliseconds: [1_000, 2_000] },
    });
    expect(() =>
      parseD2CommunityRuntimePolicy(
        JSON.stringify({
          ...runtimePolicy(),
          trustDelivery: {
            ...runtimePolicy().trustDelivery,
            retryDelayMilliseconds: [2_000, 1_000],
          },
        }),
      ),
    ).toThrow("D2CommunityRuntimePolicyRejected");
    expect(() =>
      parseD2CommunityRuntimePolicy(
        JSON.stringify({ ...runtimePolicy(), unexpectedActivation: true }),
      ),
    ).toThrow("D2CommunityRuntimePolicyRejected");
  });

  it("keeps provider verification empty by default and rejects inferred or mismatched variants", () => {
    expect(parseD2ProviderVerificationRegistrations("[]")).toEqual([]);
    expect(
      parseD2ProviderVerificationRegistrations(
        JSON.stringify([
          {
            sourceId: "greenhouse-acme",
            provider: "greenhouse",
            pageVariant: "greenhouse-board-v1",
            atsTenant: "acme",
            sourcePolicyVersion: "provider-policy.v1",
          },
        ]),
      ),
    ).toHaveLength(1);
    expect(() =>
      parseD2ProviderVerificationRegistrations(
        JSON.stringify([
          {
            sourceId: "greenhouse-acme",
            provider: "greenhouse",
            pageVariant: "lever-posting-v1",
            atsTenant: "acme",
            sourcePolicyVersion: "provider-policy.v1",
          },
        ]),
      ),
    ).toThrow("D2CommunityProviderVerificationConfigurationRejected");
  });

  it("composes Postgres-backed authorities only after the complete explicit boundary", async () => {
    const resolveDatabaseUrl = vi.fn(async () => "postgres://resolved/private");
    const client = Object.assign(vi.fn(), { begin: vi.fn() });
    const createDatabase = vi.fn(() => client as never);
    const createSqsSender = vi.fn(() => ({ send: vi.fn() }));
    const configured = await createConfiguredD2CommunityLambdaConfiguration(environment(), {
      resolveDatabaseUrl,
      createDatabase,
      createSqsSender,
      now: () => new Date("2026-09-02T18:00:00.000Z"),
    });

    expect(configured.enabled).toBe(true);
    if (!configured.enabled) throw new Error("synthetic configuration did not activate");
    expect(configured.jobs.input).toEqual({
      processingWorkerId: "d2:processing",
      processingLimit: 5,
    });
    expect(configured.jobs.runtime).toMatchObject({
      enabled: true,
      processingPolicy: { version: "d2-processing.v1" },
    });
    expect(configured.trustDelivery).toMatchObject({ workerId: "d2:trust-delivery", limit: 5 });
    expect(resolveDatabaseUrl).toHaveBeenCalledOnce();
    expect(createDatabase).toHaveBeenCalledWith("postgres://resolved/private");
    expect(createSqsSender).toHaveBeenCalledWith("us-east-2");
    expect(client).not.toHaveBeenCalled();
  });

  it("rejects activation without Trust authority before opening a database", async () => {
    const candidate = environment();
    delete candidate.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON;
    const resolveDatabaseUrl = vi.fn();
    await expect(
      createConfiguredD2CommunityLambdaConfiguration(candidate, { resolveDatabaseUrl }),
    ).rejects.toThrow();
    expect(resolveDatabaseUrl).not.toHaveBeenCalled();
  });

  it("composes the receive-only signal runtime without scheduled or provider authority", async () => {
    const resolveDatabaseUrl = vi.fn(async () => "postgres://resolved/private");
    const client = Object.assign(vi.fn(), { begin: vi.fn() });
    const configured = await createConfiguredD2TrustSignalLambdaConfiguration(
      {
        AWS_REGION: "us-east-2",
        DATABASE_SECRET_ID: "development/database-url",
        AWS_SESSION_TOKEN: "runtime-token",
        D2_COMMUNITY_RUNTIME_ENABLED: "true",
        D2_COMMUNITY_ACCOUNT_ID: "123456789012",
        D2_COMMUNITY_REGION: "us-east-2",
        D2_TRUST_SIGNAL_QUEUE_ARN:
          "arn:aws:sqs:us-east-2:123456789012:development-d2-trust-signals",
        D2_COMMUNITY_PROCESSING_POLICY_VERSION: "d2-processing.v1",
      },
      {
        resolveDatabaseUrl,
        createDatabase: () => client as never,
        now: () => new Date("2026-09-02T18:00:00.000Z"),
      },
    );
    expect(configured).toMatchObject({
      enabled: true,
      boundary: {
        accountId: "123456789012",
        region: "us-east-2",
      },
    });
    expect(resolveDatabaseUrl).toHaveBeenCalledWith(
      { DATABASE_SECRET_ID: "development/database-url" },
      { sessionToken: "runtime-token" },
    );
    expect(client).not.toHaveBeenCalled();
  });

  it("publishes identifier-only nudges and requires an accepted SQS message identity", async () => {
    const send = vi.fn().mockResolvedValueOnce({ MessageId: "accepted" }).mockResolvedValueOnce({});
    const transport = new AwsD2IdentifierOnlyNudgeTransport(
      "https://sqs.us-east-2.amazonaws.com/123456789012/d2-signals",
      { send },
    );
    const nudge = {
      schemaVersion: 1,
      eventId: "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9",
      eventType: "trust.contribution-decision.changed.v1",
      integrity: { algorithm: "sha256", digest: "a".repeat(64) },
    } as const;
    await expect(transport.publish(nudge)).resolves.toBeUndefined();
    await expect(transport.publish(nudge)).rejects.toThrow("D2CommunityNudgeNotAccepted");
    expect(JSON.stringify(send.mock.calls)).not.toContain("contributor");
  });
});
