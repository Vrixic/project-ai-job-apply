import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { describe, expect, it, vi } from "vitest";
import {
  type CandidateRightsActivityDependencies,
  PostgresCandidateRightsActivityStore,
} from "./candidate-rights-activities.js";

const input = {
  schemaVersion: 1 as const,
  workflowDefinitionVersion: 1 as const,
  action: "deletion_record_recovery" as const,
  eventId: "019c2b89-79b2-7000-8000-000000000001",
  resourceId: "019c2b89-79b2-7000-8000-000000000002",
  operationId: "019c2b89-79b2-7000-8000-000000000003",
  policyVersion: "synthetic-v1",
};

describe("candidate-rights activity persistence boundary", () => {
  it("normalizes PostgreSQL timestamp strings before writing the recovery ledger", async () => {
    const recordConfirmed = vi.fn(async (entry) => entry);
    const client = vi.fn(async () => [
      {
        userId: "019c2b89-79b2-7000-8000-000000000004",
        resourceId: input.resourceId,
        operationId: input.operationId,
        policyVersion: input.policyVersion,
        state: "quarantined",
        confirmedAt: "2026-08-31T15:00:00.000Z",
        backupExpiresAt: "2026-10-05T15:00:00.000Z",
        subjectDigest: "b".repeat(64),
      },
    ]);
    const dependencies = {
      database: { client } as unknown as DatabaseHandle,
      policy: {
        version: input.policyVersion,
        accountablePolicySha256: "a".repeat(64),
        exportArtifactLifetimeSeconds: 3_600,
        downloadGrantLifetimeSeconds: 300,
        backupRetentionDays: 35,
        recentAuthenticationMaxAgeSeconds: 900,
        ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing"],
        subprocessorInventory: [],
      },
      artifactStore: { putIfAbsent: vi.fn() },
      documentObjectStore: { deleteAllVersionsAndMarkers: vi.fn() },
      identityProvider: { revokeAndDelete: vi.fn() },
      subprocessors: [],
      recoveryLedger: { recordConfirmed, markCompleted: vi.fn() },
    } as unknown as CandidateRightsActivityDependencies;
    const store = new PostgresCandidateRightsActivityStore(dependencies);

    await store.recordDeletionRecovery(input);

    expect(recordConfirmed).toHaveBeenCalledOnce();
    expect(recordConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedAt: new Date("2026-08-31T15:00:00.000Z"),
        backupExpiresAt: new Date("2026-10-05T15:00:00.000Z"),
      }),
    );
  });

  it("rejects an invalid persisted deletion timestamp", async () => {
    const client = vi.fn(async () => [
      {
        userId: "019c2b89-79b2-7000-8000-000000000004",
        resourceId: input.resourceId,
        operationId: input.operationId,
        policyVersion: input.policyVersion,
        state: "quarantined",
        confirmedAt: "not-a-timestamp",
        backupExpiresAt: "2026-10-05T15:00:00.000Z",
        subjectDigest: "b".repeat(64),
      },
    ]);
    const dependencies = {
      database: { client } as unknown as DatabaseHandle,
      policy: {
        ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing"],
        subprocessorInventory: [],
      },
      artifactStore: {},
      documentObjectStore: {},
      identityProvider: {},
      subprocessors: [],
      recoveryLedger: { recordConfirmed: vi.fn(), markCompleted: vi.fn() },
    } as unknown as CandidateRightsActivityDependencies;
    const store = new PostgresCandidateRightsActivityStore(dependencies);

    await expect(store.recordDeletionRecovery(input)).rejects.toThrow(
      "CandidateRightsContextDateRejected",
    );
  });
});
