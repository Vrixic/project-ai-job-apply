import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { describe, expect, it, vi } from "vitest";
import {
  type CandidateRightsActivityDependencies,
  createCandidateRightsActivityHandler,
  PostgresCandidateRightsActivityStore,
} from "./candidate-rights-activities.js";

const USER = "019c2b89-79b2-7000-8000-000000000004";
const REQUEST = "019c2b89-79b2-7000-8000-000000000002";
const OPERATION = "019c2b89-79b2-7000-8000-000000000003";
const AT = "2026-09-18T12:00:00.000Z";
const BASE = ["identity", "profile", "documents", "jobs", "matching", "billing", "trust"];
const WITH_APPLICATIONS = [...BASE, "applications"];

const applicationsSection = {
  schemaVersion: 1,
  applications: [],
  packets: [],
  approvals: [],
  attempts: [],
  history: [],
};

function ownerExport(text: string) {
  const owner = /SELECT (\w+)\.export_candidate_data/u.exec(text)?.[1];
  switch (owner) {
    case "profile":
      return {
        candidate: { email: "candidate@example.test", createdAt: AT, connectedAccounts: [] },
        profile: { preferences: null, facts: [] },
        audit: { events: [] },
      };
    case "documents":
      return { documents: { resumes: [] }, audit: { events: [] } };
    case "jobs":
      return { jobs: { reports: [] }, audit: { events: [] } };
    case "matching":
      return { matching: { savedJobs: [] }, audit: { events: [] } };
    case "billing":
      return {
        billing: { entitlement: { plan: "free", version: 0, effectiveAt: AT } },
        audit: { events: [] },
      };
    case "trust":
      return {
        trust: { schemaVersion: 1, cases: [], caseEvents: [], contributorReputationEvidence: [] },
        audit: { events: [] },
      };
    case "applications":
      return {
        applications: applicationsSection,
        audit: {
          events: [
            {
              owner: "applications",
              action: "applications.application_created",
              resourceType: "application",
              resourceId: "019c2b89-79b2-7000-8000-0000000000a1",
              occurredAt: AT,
            },
          ],
        },
      };
    default:
      throw new Error(`unexpected export query: ${text}`);
  }
}

function harness(
  ownerInventory: readonly string[],
  applicationsData?: unknown,
  restrictedAnswers?: unknown,
  restrictedAnswerExport?: CandidateRightsActivityDependencies["restrictedAnswerExport"],
) {
  const queries: string[] = [];
  const stored: { body?: Buffer } = {};
  const exportRow = {
    userId: USER,
    resourceId: REQUEST,
    operationId: OPERATION,
    policyVersion: "d3-development-synthetic-v1",
    state: "building",
  };
  const deletionRow = {
    ...exportRow,
    state: "quarantined",
    confirmedAt: new Date("2026-09-18T11:00:00.000Z"),
    completedAt: null,
    backupExpiresAt: new Date("2026-10-23T11:00:00.000Z"),
    subjectDigest: "b".repeat(64),
  };
  const client = vi.fn(async (query: TemplateStringsArray) => {
    const text = query.join("?");
    queries.push(text);
    if (text.includes("applications.export_candidate_data") && applicationsData !== undefined) {
      return [{ data: applicationsData }];
    }
    if (text.includes("export_candidate_data")) {
      const data = ownerExport(text);
      if (text.includes("profile.export_candidate_data") && restrictedAnswers !== undefined) {
        Object.assign(data.profile ?? {}, { restrictedAnswers });
      }
      return [{ data }];
    }
    if (text.includes("FROM profile.candidate_data_exports")) return [exportRow];
    if (text.includes("FROM profile.account_deletion_requests")) return [deletionRow];
    if (text.includes("identity.external_identities")) return [];
    if (text.includes("candidate_object_inventory")) return [{ data: [] }];
    throw new Error(`unexpected query: ${text}`);
  });
  const transaction = vi.fn(async (query: TemplateStringsArray) => {
    const text = query.join("?");
    queries.push(text);
    if (text.includes("FROM profile.candidate_data_exports")) return [exportRow];
    return [];
  });
  const begin = vi.fn(async (run: (sql: typeof transaction) => Promise<void>) => run(transaction));
  const dependencies = {
    database: { client: Object.assign(client, { begin }) } as unknown as DatabaseHandle,
    policy: {
      version: "d3-development-synthetic-v1",
      accountablePolicySha256: "c".repeat(64),
      exportArtifactLifetimeSeconds: 3600,
      ownerInventory,
      subprocessorInventory: [],
    },
    artifactStore: {
      putIfAbsent: vi.fn(async (value: { body: Buffer }) => {
        stored.body = value.body;
        return { objectVersion: "version-1" };
      }),
    },
    restrictedAnswerExport,
    documentObjectStore: {
      deleteAllVersionsAndMarkers: vi.fn(async () => ({ exactInventoryEmpty: true })),
    },
    identityProvider: { revokeAndDelete: vi.fn(async () => {}) },
    subprocessors: [],
    recoveryLedger: { recordConfirmed: vi.fn(), markCompleted: vi.fn() },
    clock: () => new Date(AT),
  } as unknown as CandidateRightsActivityDependencies;
  return { store: new PostgresCandidateRightsActivityStore(dependencies), queries, stored };
}

const input = (action: "export_assemble" | "deletion_delete_active_systems") =>
  ({
    schemaVersion: 1 as const,
    workflowDefinitionVersion: 1 as const,
    action,
    eventId: "019c2b89-79b2-7000-8000-000000000001",
    resourceId: REQUEST,
    operationId: OPERATION,
    policyVersion: "d3-development-synthetic-v1",
  }) as never;

const restrictedAnswer = {
  id: "019c2b89-79b2-7000-8000-0000000000b1",
  fieldKey: "authorization.us_authorized",
  version: 1,
  valueType: "boolean",
  sensitivity: "restricted",
  state: "active",
  confirmedAt: AT,
  createdAt: AT,
};

describe("Restricted Answer Vault portable metadata compatibility", () => {
  it("exports the exact active and expired values, but never decrypts tombstones", async () => {
    const reader = { readValue: vi.fn(async () => "false") };
    const metadata = [
      restrictedAnswer,
      { ...restrictedAnswer, id: REQUEST, context: "us", expiresAt: "2026-09-01T12:00:00.000Z" },
      { ...restrictedAnswer, id: OPERATION, state: "deleted", version: 2 },
    ];
    const run = harness(WITH_APPLICATIONS, undefined, metadata, reader);
    await run.store.assembleExport(input("export_assemble"));
    const exported = JSON.parse(run.stored.body?.toString("utf8") ?? "{}");
    expect(exported.profile.restrictedAnswers).toEqual([
      { ...metadata[0], value: "false" },
      { ...metadata[1], value: "false" },
      metadata[2],
    ]);
    expect(reader.readValue.mock.calls).toEqual([
      [USER, { id: restrictedAnswer.id, version: 1, fieldKey: restrictedAnswer.fieldKey }],
      [USER, { id: REQUEST, version: 1, fieldKey: restrictedAnswer.fieldKey, context: "us" }],
    ]);
  });

  it("writes no partial artifact if decryption or snapshot verification fails", async () => {
    const reader = {
      readValue: vi.fn(async () => {
        throw new Error("RestrictedAnswerExportSnapshotChanged");
      }),
    };
    const run = harness(BASE, undefined, [restrictedAnswer], reader);
    await expect(run.store.assembleExport(input("export_assemble"))).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    expect(run.stored.body).toBeUndefined();
    await expect(
      createCandidateRightsActivityHandler(run.store)(input("export_assemble")),
    ).resolves.toMatchObject({
      outcome: "retryable_failure",
      errorCode: "RestrictedAnswerExportSnapshotChanged",
    });
  });

  it("refuses missing inventory when value export is enabled", async () => {
    const reader = { readValue: vi.fn(async () => "false") };
    const run = harness(BASE, undefined, undefined, reader);
    await expect(run.store.assembleExport(input("export_assemble"))).rejects.toThrow(
      "RestrictedAnswerExportInventoryMissing",
    );
    expect(reader.readValue).not.toHaveBeenCalled();
    expect(run.stored.body).toBeUndefined();
  });
  it.each([BASE, WITH_APPLICATIONS])(
    "assembles empty, active and deleted vault metadata under owner inventory %j",
    async (...ownerInventory) => {
      for (const metadata of [
        [],
        [restrictedAnswer],
        [{ ...restrictedAnswer, context: "us", expiresAt: AT, version: 2, state: "deleted" }],
      ]) {
        const run = harness(ownerInventory, undefined, metadata);
        await run.store.assembleExport(input("export_assemble"));
        const exported = JSON.parse(run.stored.body?.toString("utf8") ?? "{}");
        expect(exported.profile.restrictedAnswers).toEqual(metadata);
        expect(validateCandidateDataExportV1(exported)).toBe(true);
      }
    },
  );

  it("refuses sensitive or internal fields before writing an artifact", async () => {
    for (const forbidden of [
      "value",
      "plaintext",
      "ciphertext",
      "kmsKeyId",
      "encryptionAlgorithm",
      "sourceReference",
      "userId",
    ]) {
      const run = harness(BASE, undefined, [{ ...restrictedAnswer, [forbidden]: "synthetic" }]);
      await expect(run.store.assembleExport(input("export_assemble"))).rejects.toThrow(
        "CandidateExportSchemaRejected",
      );
      expect(run.stored.body).toBeUndefined();
    }
  });

  it("refuses malformed vault metadata before writing an artifact", async () => {
    for (const invalid of [
      null,
      {},
      [{ ...restrictedAnswer, version: 0 }],
      [{ ...restrictedAnswer, sensitivity: "standard" }],
      [{ ...restrictedAnswer, valueType: "object" }],
      [{ ...restrictedAnswer, state: "expired" }],
      [{ ...restrictedAnswer, fieldKey: "" }],
      [{ ...restrictedAnswer, context: "x".repeat(121) }],
      [{ ...restrictedAnswer, confirmedAt: "not-a-date" }],
      [{ ...restrictedAnswer, id: "not-a-uuid" }],
      [{ ...restrictedAnswer, createdAt: undefined }],
    ]) {
      const run = harness(BASE, undefined, invalid);
      await expect(run.store.assembleExport(input("export_assemble"))).rejects.toThrow(
        "CandidateExportSchemaRejected",
      );
      expect(run.stored.body).toBeUndefined();
    }
  });
});

describe("Applications as an optional eighth candidate-rights owner", () => {
  it("accepts exactly the seven-owner or eight-owner inventory and nothing else", () => {
    expect(() => harness(BASE)).not.toThrow();
    expect(() => harness(WITH_APPLICATIONS)).not.toThrow();
    for (const inventory of [
      BASE.slice(0, 6),
      [...BASE.slice(0, 6), "applications", "trust"],
      [...WITH_APPLICATIONS, "outcomes"],
      ["applications"],
    ]) {
      expect(() => harness(inventory)).toThrow("CandidateRightsOwnerInventoryMismatch");
    }
  });

  it("exports the Applications section and its audit events only under the eight-owner policy", async () => {
    const eight = harness(WITH_APPLICATIONS);
    await eight.store.assembleExport(input("export_assemble"));
    expect(eight.queries.some((text) => text.includes("applications.export_candidate_data"))).toBe(
      true,
    );
    const exported = JSON.parse(eight.stored.body?.toString("utf8") ?? "{}");
    expect(exported.applications).toEqual(applicationsSection);
    expect(exported.audit.events.map((event: { owner: string }) => event.owner)).toEqual([
      "applications",
    ]);
    expect(validateCandidateDataExportV1(exported)).toBe(true);

    const seven = harness(BASE);
    await seven.store.assembleExport(input("export_assemble"));
    expect(seven.queries.some((text) => text.includes("applications."))).toBe(false);
    const legacy = JSON.parse(seven.stored.body?.toString("utf8") ?? "{}");
    expect(legacy).not.toHaveProperty("applications");
    expect(validateCandidateDataExportV1(legacy)).toBe(true);
  });

  it("refuses an export when the Applications owner returns no section", async () => {
    for (const data of [{}, { applications: null }, { applications: [] }]) {
      const eight = harness(WITH_APPLICATIONS, data);
      await expect(eight.store.assembleExport(input("export_assemble"))).rejects.toThrow(
        "CandidateExportInventoryIncomplete",
      );
      expect(eight.stored.body).toBeUndefined();
    }
  });

  it("deletes Applications data first, in the same transaction, only under the eight-owner policy", async () => {
    const eight = harness(WITH_APPLICATIONS);
    await eight.store.deleteActiveSystems(input("deletion_delete_active_systems"));
    const owners = eight.queries
      .filter((text) => text.includes(".delete_candidate_data"))
      .map((text) => /SELECT (\w+)\.delete_candidate_data/u.exec(text)?.[1]);
    expect(owners).toEqual([
      "applications",
      "jobs",
      "matching",
      "billing",
      "trust",
      "documents",
      "profile",
    ]);

    const seven = harness(BASE);
    await seven.store.deleteActiveSystems(input("deletion_delete_active_systems"));
    const legacyOwners = seven.queries
      .filter((text) => text.includes(".delete_candidate_data"))
      .map((text) => /SELECT (\w+)\.delete_candidate_data/u.exec(text)?.[1]);
    expect(legacyOwners).toEqual(["jobs", "matching", "billing", "trust", "documents", "profile"]);
  });
});
