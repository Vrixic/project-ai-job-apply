import type { Context, Handler } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  createDatabase: vi.fn(() => ({})),
  resolveDatabaseUrl: vi.fn(async () => "postgres://synthetic.invalid/unused"),
  loadPolicy: vi.fn(() => ({ subprocessorInventory: [] })),
  resolveIdentitySecret: vi.fn(async () => ({
    clientId: "synthetic-unused-client",
    clientSecret: "synthetic-unused-secret",
    revocationMode: "delete_user_only",
  })),
  createRightsStore: vi.fn(),
  createProfileStore: vi.fn(),
  expireDueExports: vi.fn(async () => ({ scanned: 2, expired: 2 })),
  purgeDeletedResumes: vi.fn(async () => ({ scanned: 1, purged: 1, failed: 0, heldWaiting: 0 })),
  beginExport: vi.fn(async () => undefined),
  markOperationRunning: vi.fn(async () => undefined),
  fetch: vi.fn(async () => {
    throw new Error("UnexpectedExternalRequest");
  }),
}));

vi.mock("@ai-job-apply/profile-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ai-job-apply/profile-service")>()),
  createDatabase: runtime.createDatabase,
  resolveLambdaDatabaseUrl: runtime.resolveDatabaseUrl,
  loadCandidateRightsPolicy: runtime.loadPolicy,
  PostgresProfileStore: class {
    constructor() {
      runtime.createProfileStore();
    }

    markOperationRunning = runtime.markOperationRunning;
  },
}));

vi.mock("./candidate-rights-activities.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./candidate-rights-activities.js")>()),
  PostgresCandidateRightsActivityStore: class {
    constructor(dependencies: unknown) {
      runtime.createRightsStore(dependencies);
    }

    expireDueExports = runtime.expireDueExports;
    purgeDeletedResumes = runtime.purgeDeletedResumes;
    beginExport = runtime.beginExport;
  },
}));

vi.mock("./candidate-rights-secret.js", () => ({
  resolveCandidateRightsAuth0Secret: runtime.resolveIdentitySecret,
}));

const ruleArn =
  "arn:aws:events:us-east-2:123456789012:rule/ai-job-apply-development-candidate-rights-maintenance";

function scheduledEvent() {
  return {
    version: "0",
    id: "019c2b89-79b2-7000-8000-000000000009",
    source: "aws.events",
    "detail-type": "Scheduled Event",
    account: "123456789012",
    region: "us-east-2",
    time: "2026-09-09T00:00:00Z",
    resources: [ruleArn],
    detail: {},
  };
}

async function invoke<Result>(handler: Handler<unknown, Result>, event: unknown) {
  return handler(event, {} as Context, () => undefined);
}

function expectNoRuntimeEffects() {
  expect(runtime.loadPolicy).not.toHaveBeenCalled();
  expect(runtime.resolveIdentitySecret).not.toHaveBeenCalled();
  expect(runtime.resolveDatabaseUrl).not.toHaveBeenCalled();
  expect(runtime.createDatabase).not.toHaveBeenCalled();
  expect(runtime.createRightsStore).not.toHaveBeenCalled();
  expect(runtime.createProfileStore).not.toHaveBeenCalled();
  expect(runtime.expireDueExports).not.toHaveBeenCalled();
  expect(runtime.beginExport).not.toHaveBeenCalled();
  expect(runtime.markOperationRunning).not.toHaveBeenCalled();
  expect(runtime.fetch).not.toHaveBeenCalled();
}

const rejectedActivity = {
  schemaVersion: 1,
  action: "mark_running",
  outcome: "non_retryable_failure",
  errorCode: "ActivityInputRejected",
};

const invalidEvents = [
  ["another source", { ...scheduledEvent(), source: "aws.lambda" }],
  ["another detail type", { ...scheduledEvent(), "detail-type": "Other Event" }],
  ["another account", { ...scheduledEvent(), account: "999999999999" }],
  ["missing account", { ...scheduledEvent(), account: undefined }],
  ["another Region", { ...scheduledEvent(), region: "us-east-1" }],
  ["missing Region", { ...scheduledEvent(), region: undefined }],
  ["another rule", { ...scheduledEvent(), resources: [`${ruleArn}-other`] }],
  ["no rule", { ...scheduledEvent(), resources: [] }],
  ["multiple rules", { ...scheduledEvent(), resources: [ruleArn, ruleArn] }],
  ["string resource", { ...scheduledEvent(), resources: ruleArn }],
  ["nonempty detail", { ...scheduledEvent(), detail: { owner: "must-not-dispatch" } }],
  ["array detail", { ...scheduledEvent(), detail: [] }],
  ["null detail", { ...scheduledEvent(), detail: null }],
  ["missing detail", { ...scheduledEvent(), detail: undefined }],
  ["detail type alone", { "detail-type": "Scheduled Event" }],
  ["null event", null],
] as const;

describe("deployed profile-readiness activity entrypoints", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", runtime.fetch);
    for (const [name, value] of Object.entries({
      CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN: ruleArn,
      CANDIDATE_DATA_EXPORT_BUCKET: "synthetic-export-bucket",
      CANDIDATE_DATA_EXPORT_KMS_KEY_ARN: "synthetic-unused-kms",
      CANDIDATE_DOCUMENT_BUCKET: "synthetic-document-bucket",
      CANDIDATE_DELETION_RECOVERY_BUCKET: "synthetic-recovery-bucket",
      CANDIDATE_RIGHTS_AUTH0_SECRET_ID: "synthetic-unused-secret-id",
      DATABASE_SECRET_ID: "synthetic-unused-database-id",
      OIDC_ISSUER: "https://synthetic.invalid/",
    })) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes the exact EventBridge schedule through the deployed index.activity entrypoint", async () => {
    const { activity } = await import("./profile-readiness-lambda.js");
    await expect(invoke(activity, scheduledEvent())).resolves.toEqual({
      schemaVersion: 1,
      scanned: 2,
      expired: 2,
      resumePurge: { scanned: 1, purged: 1, failed: 0, heldWaiting: 0 },
    });
    expect(runtime.expireDueExports).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.purgeDeletedResumes).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.createRightsStore).toHaveBeenCalledOnce();
    expect(runtime.createProfileStore).not.toHaveBeenCalled();
    expect(runtime.beginExport).not.toHaveBeenCalled();
    expect(runtime.markOperationRunning).not.toHaveBeenCalled();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it.each(invalidEvents)(
    "rejects %s before secret, database or maintenance setup",
    async (_name, event) => {
      const { activity } = await import("./profile-readiness-lambda.js");
      await expect(invoke(activity, event)).resolves.toEqual(rejectedActivity);
      expectNoRuntimeEffects();
    },
  );

  it.each([undefined, "", "false", ruleArn.replace(":events:", ":lambda:")])(
    "rejects absent or malformed enabled-rule configuration %s",
    async (configuredRule) => {
      vi.stubEnv("CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN", configuredRule);
      const { activity } = await import("./profile-readiness-lambda.js");
      await expect(invoke(activity, scheduledEvent())).resolves.toEqual(rejectedActivity);
      expectNoRuntimeEffects();
    },
  );

  it("does not reuse a warmed maintenance store after its rule is disabled", async () => {
    const { activity } = await import("./profile-readiness-lambda.js");
    await invoke(activity, scheduledEvent());
    vi.clearAllMocks();
    vi.stubEnv("CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN", undefined);
    await expect(invoke(activity, scheduledEvent())).resolves.toEqual(rejectedActivity);
    expectNoRuntimeEffects();
  });

  it("keeps the exported maintenance entrypoint bound to the same validated schedule", async () => {
    const { maintenance } = await import("./profile-readiness-lambda.js");
    await expect(invoke(maintenance, scheduledEvent())).resolves.toEqual({
      schemaVersion: 1,
      scanned: 2,
      expired: 2,
      resumePurge: { scanned: 1, purged: 1, failed: 0, heldWaiting: 0 },
    });
    expect(runtime.expireDueExports).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.purgeDeletedResumes).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it.each(invalidEvents)(
    "direct maintenance rejects %s before runtime setup",
    async (_name, event) => {
      const { maintenance } = await import("./profile-readiness-lambda.js");
      await expect(invoke(maintenance, event)).rejects.toThrow(
        "CandidateRightsMaintenanceEventRejected",
      );
      expectNoRuntimeEffects();
    },
  );

  it("direct maintenance remains disabled without the configured rule", async () => {
    vi.stubEnv("CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN", undefined);
    const { maintenance } = await import("./profile-readiness-lambda.js");
    await expect(invoke(maintenance, scheduledEvent())).rejects.toThrow(
      "CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN is required",
    );
    expectNoRuntimeEffects();
  });

  it("continues to dispatch a strict candidate-rights activity without scheduling maintenance", async () => {
    const { activity } = await import("./profile-readiness-lambda.js");
    await expect(
      invoke(activity, {
        schemaVersion: 1,
        workflowDefinitionVersion: 1,
        eventId: "019c2b89-79b2-7000-8000-000000000001",
        operationId: "019c2b89-79b2-7000-8000-000000000002",
        resourceId: "019c2b89-79b2-7000-8000-000000000004",
        policyVersion: "policy-synthetic-v1",
        action: "export_begin",
      }),
    ).resolves.toEqual({ schemaVersion: 1, action: "export_begin", outcome: "completed" });
    expect(runtime.beginExport).toHaveBeenCalledOnce();
    expect(runtime.expireDueExports).not.toHaveBeenCalled();
    expect(runtime.createProfileStore).not.toHaveBeenCalled();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it("wires vault decryption only under complete exact export activation", async () => {
    vi.stubEnv("RESTRICTED_ANSWER_EXPORT_ENABLED", "enabled");
    vi.stubEnv(
      "RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
    );
    const { activity } = await import("./profile-readiness-lambda.js");
    await invoke(activity, scheduledEvent());
    expect(runtime.createRightsStore).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictedAnswerExport: expect.objectContaining({ readValue: expect.any(Function) }),
      }),
    );
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it("refuses malformed export activation before constructing the rights store", async () => {
    vi.stubEnv("RESTRICTED_ANSWER_EXPORT_ENABLED", "true");
    const { activity } = await import("./profile-readiness-lambda.js");
    await expect(invoke(activity, scheduledEvent())).rejects.toThrow(
      "RestrictedAnswerExportConfigurationRejected",
    );
    expect(runtime.createRightsStore).not.toHaveBeenCalled();
    expect(runtime.resolveIdentitySecret).not.toHaveBeenCalled();
  });

  it("continues to dispatch ordinary readiness when candidate-rights maintenance is disabled", async () => {
    vi.stubEnv("CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN", undefined);
    const { activity } = await import("./profile-readiness-lambda.js");
    await expect(
      invoke(activity, {
        schemaVersion: 1,
        workflowDefinitionVersion: 1,
        eventId: "019c2b89-79b2-7000-8000-000000000001",
        operationId: "019c2b89-79b2-7000-8000-000000000002",
        preferenceSetId: "019c2b89-79b2-7000-8000-000000000003",
        action: "mark_running",
      }),
    ).resolves.toEqual({ schemaVersion: 1, action: "mark_running", outcome: "completed" });
    expect(runtime.markOperationRunning).toHaveBeenCalledExactlyOnceWith(
      "019c2b89-79b2-7000-8000-000000000002",
      "019c2b89-79b2-7000-8000-000000000003",
    );
    expect(runtime.createRightsStore).not.toHaveBeenCalled();
    expect(runtime.expireDueExports).not.toHaveBeenCalled();
    expect(runtime.resolveIdentitySecret).not.toHaveBeenCalled();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });
});
