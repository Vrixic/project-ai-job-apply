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

function completionFixture(state: string, completedAt: unknown) {
  const confirmedAt = new Date("2026-08-31T15:00:00.000Z");
  const context = {
    userId: "019c2b89-79b2-7000-8000-000000000004",
    resourceId: input.resourceId,
    operationId: input.operationId,
    policyVersion: input.policyVersion,
    state,
    confirmedAt,
    completedAt,
    backupExpiresAt: new Date("2026-10-05T15:00:00.000Z"),
    subjectDigest: "b".repeat(64),
  };
  const client = vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => [context]);
  const transaction = vi.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
    if (query.join("").includes("UPDATE profile.account_deletion_requests")) {
      context.state = "completed";
      context.completedAt = values[0];
    }
    return [];
  });
  const begin = vi.fn(async (run: (sql: typeof transaction) => Promise<void>) => run(transaction));
  const markCompleted = vi.fn(async (_requestId: string, _completedAt: Date) => {});
  const clock = vi.fn(() => new Date("2026-08-31T15:05:00.000Z"));
  const dependencies = {
    database: { client: Object.assign(client, { begin }) } as unknown as DatabaseHandle,
    policy: {
      ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing", "trust"],
      subprocessorInventory: [],
    },
    artifactStore: {},
    documentObjectStore: {},
    identityProvider: {},
    subprocessors: [],
    recoveryLedger: { recordConfirmed: vi.fn(), markCompleted },
    clock,
  } as unknown as CandidateRightsActivityDependencies;
  return {
    store: new PostgresCandidateRightsActivityStore(dependencies),
    context,
    client,
    begin,
    transaction,
    markCompleted,
    clock,
  };
}

describe("candidate-rights activity persistence boundary", () => {
  it.each([
    ["completed", new Date("2026-08-31T15:02:00.000Z")],
    ["completed", "2026-08-31 15:02:00+00"],
    ["backup_expired", new Date("2026-08-31T15:02:00.000Z")],
    ["backup_expired", "2026-08-31 15:02:00+00"],
  ])("retains the authoritative completion time on a %s retry (%s)", async (state, at) => {
    const fixture = completionFixture(String(state), at);
    await fixture.store.completeDeletion(input);
    await fixture.store.completeDeletion(input);
    expect(fixture.markCompleted.mock.calls).toEqual([
      [input.resourceId, new Date("2026-08-31T15:02:00.000Z")],
      [input.resourceId, new Date("2026-08-31T15:02:00.000Z")],
    ]);
    expect(fixture.client.mock.calls[0]?.[0].join("")).toContain(
      'request.completed_at AS "completedAt"',
    );
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.clock).not.toHaveBeenCalled();
    expect(fixture.context.state).toBe(state);
  });

  it.each([undefined, null, "not-a-timestamp", new Date("invalid")])(
    "refuses a terminal row without a valid persisted completion (%s)",
    async (completedAt) => {
      for (const state of ["completed", "backup_expired"]) {
        const fixture = completionFixture(state, completedAt);
        await expect(fixture.store.completeDeletion(input)).rejects.toThrow(
          "CandidateRightsContextDateRejected",
        );
        expect(fixture.markCompleted).not.toHaveBeenCalled();
        expect(fixture.begin).not.toHaveBeenCalled();
        expect(fixture.clock).not.toHaveBeenCalled();
      }
    },
  );

  it("recovers a marker-tag failure after SQL commit without changing completion or rewriting SQL", async () => {
    const fixture = completionFixture("subprocessors_pending", null);
    fixture.markCompleted.mockRejectedValueOnce(new Error("SyntheticMarkerWriteFailure"));
    await expect(fixture.store.completeDeletion(input)).rejects.toThrow(
      "SyntheticMarkerWriteFailure",
    );
    expect(fixture.begin).toHaveBeenCalledOnce();
    expect(fixture.transaction).toHaveBeenCalledTimes(3);
    expect(fixture.context.state).toBe("completed");
    fixture.clock.mockReturnValue(new Date("2026-08-31T15:06:00.000Z"));
    await fixture.store.completeDeletion(input);
    expect(fixture.begin).toHaveBeenCalledOnce();
    expect(fixture.clock).toHaveBeenCalledOnce();
    expect(fixture.markCompleted.mock.calls).toEqual([
      [input.resourceId, new Date("2026-08-31T15:05:00.000Z")],
      [input.resourceId, new Date("2026-08-31T15:05:00.000Z")],
    ]);
  });

  it("keeps exact operation/policy binding and nonterminal state refusal on completion", async () => {
    for (const field of ["operationId", "policyVersion"] as const) {
      const fixture = completionFixture("completed", new Date("2026-08-31T15:02:00.000Z"));
      fixture.context[field] = "different-synthetic-binding";
      await expect(fixture.store.completeDeletion(input)).rejects.toThrow(
        "CandidateRightsContextMismatch",
      );
      expect(fixture.markCompleted).not.toHaveBeenCalled();
    }
    const fixture = completionFixture("quarantined", null);
    await expect(fixture.store.completeDeletion(input)).rejects.toThrow(
      "AccountDeletionStateConflict",
    );
    expect(fixture.markCompleted).not.toHaveBeenCalled();
    expect(fixture.begin).not.toHaveBeenCalled();
  });

  it("uses the persisted winner when another completion commits after the initial read", async () => {
    const fixture = completionFixture("subprocessors_pending", null);
    const persistedAt = new Date("2026-08-31T15:04:00.000Z");
    fixture.transaction.mockImplementation(async () => {
      // A concurrent winner committed before this attempt's conditional updates;
      // all three local writes return no request completion to adopt.
      fixture.context.state = "completed";
      fixture.context.completedAt = persistedAt.toISOString();
      return [];
    });
    await fixture.store.completeDeletion(input);
    expect(fixture.client).toHaveBeenCalledTimes(2);
    expect(fixture.markCompleted).toHaveBeenCalledExactlyOnceWith(input.resourceId, persistedAt);
  });

  it("refuses an unconfirmed completion readback without tagging an attempt clock", async () => {
    const fixture = completionFixture("subprocessors_pending", null);
    const incomplete = { ...fixture.context };
    fixture.client.mockResolvedValueOnce([incomplete]).mockResolvedValueOnce([incomplete]);
    await expect(fixture.store.completeDeletion(input)).rejects.toThrow(
      "CandidateRightsContextDateRejected",
    );
    expect(fixture.markCompleted).not.toHaveBeenCalled();
  });

  it("fails closed when the configured aggregate inventory omits Trust", () => {
    const dependencies = {
      database: { client: vi.fn() } as unknown as DatabaseHandle,
      policy: {
        ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing"],
        subprocessorInventory: [],
      },
      artifactStore: {},
      documentObjectStore: {},
      identityProvider: {},
      subprocessors: [],
      recoveryLedger: {},
    } as unknown as CandidateRightsActivityDependencies;

    expect(() => new PostgresCandidateRightsActivityStore(dependencies)).toThrow(
      "CandidateRightsOwnerInventoryMismatch",
    );
  });

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
        ownerInventory: [
          "identity",
          "profile",
          "documents",
          "jobs",
          "matching",
          "billing",
          "trust",
        ],
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
        ownerInventory: [
          "identity",
          "profile",
          "documents",
          "jobs",
          "matching",
          "billing",
          "trust",
        ],
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
