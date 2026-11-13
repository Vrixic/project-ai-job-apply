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

describe("candidate deletion portable export cleanup", () => {
  const owner = "019c2b89-79b2-7000-8000-000000000004";
  const exportId = (suffix: number) =>
    `019c2b89-79b2-7000-8000-${String(suffix).padStart(12, "0")}`;
  function fixture() {
    const deletion = {
      userId: owner,
      resourceId: input.resourceId,
      operationId: input.operationId,
      policyVersion: input.policyVersion,
      state: "quarantined",
    };
    const exports = ["ready", "ready", "queued", "building"].map((state, index) => ({
      id: exportId(index + 21),
      state,
      objectKey:
        state === "ready" ? `candidate-data-exports/${owner}/${exportId(index + 21)}.json` : null,
      objectVersion: state === "ready" ? `synthetic-version-${index}` : null,
    }));
    const absent = new Set<string>();
    const remote = new Map(
      exports
        .filter((row) => row.objectVersion)
        .map((row) => [row.id, row.objectVersion as string]),
    );
    remote.set(exportId(24), "synthetic-unrecorded-version");
    const deleted = vi.fn(async (_key: string, version: string) => {
      absent.add(version);
      for (const [id, stored] of remote) if (stored === version) remote.delete(id);
      return true;
    });
    const calls: string[] = [];
    const client = vi.fn(async (query: TemplateStringsArray) => {
      const text = query.join("?");
      if (text.includes("account_deletion_requests")) return [deletion];
      if (text.includes("identity.external_identities")) return [];
      if (text.includes("candidate_object_inventory")) return [{ data: [] }];
      throw new Error("UnexpectedSyntheticQuery");
    });
    const transaction = vi.fn(async (query: TemplateStringsArray) => {
      const text = query.join("?");
      calls.push(text);
      if (text.includes("ORDER BY id FOR UPDATE")) return exports.map((row) => ({ ...row }));
      if (text.includes("UPDATE profile.candidate_data_exports")) {
        for (const row of exports) {
          if (text.includes("SET state = 'expired'") && row.state === "ready") {
            Object.assign(row, { state: "expired", objectKey: null, objectVersion: null });
          } else if (
            text.includes("SET state = 'failed'") &&
            ["queued", "building"].includes(row.state)
          ) {
            row.state = "failed";
          }
        }
      }
      if (text.includes("UPDATE profile.account_deletion_requests"))
        deletion.state = "active_systems_deleted";
      return [];
    });
    const begin = vi.fn(async (run: (sql: typeof transaction) => Promise<void>) => {
      const before = structuredClone(exports);
      try {
        await run(transaction);
      } catch (error) {
        exports.splice(0, exports.length, ...before);
        throw error;
      }
    });
    const store = new PostgresCandidateRightsActivityStore({
      database: { client: Object.assign(client, { begin }) } as unknown as DatabaseHandle,
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
      artifactStore: {
        deleteExactVersion: deleted,
        inventoryExactKey: async (key: string) => {
          const id = key.split("/")[2]?.replace(".json", "") ?? "";
          const version = remote.get(id);
          return version ? [{ objectVersion: version, deleteMarker: false }] : [];
        },
      },
      documentObjectStore: {
        deleteAllVersionsAndMarkers: async () => ({ exactInventoryEmpty: true }),
      },
      identityProvider: { revokeAndDelete: async () => {} },
      subprocessors: [],
      recoveryLedger: {},
    } as unknown as CandidateRightsActivityDependencies);
    return { store, exports, deleted, deletion, absent, calls, begin, remote };
  }

  it("deletes every exact ready version, fences pending exports and replays idempotently", async () => {
    const run = fixture();
    await run.store.deleteActiveSystems(input);
    expect(run.deleted.mock.calls.map(([, version]) => version)).toEqual([
      "synthetic-version-0",
      "synthetic-version-1",
      "synthetic-unrecorded-version",
    ]);
    expect(run.remote.size).toBe(0);
    expect(run.exports.map(({ state }) => state)).toEqual([
      "expired",
      "expired",
      "failed",
      "failed",
    ]);
    expect(
      run.exports.every(
        ({ objectKey, objectVersion }) => objectKey === null && objectVersion === null,
      ),
    ).toBe(true);
    expect(run.deletion.state).toBe("active_systems_deleted");
    await run.store.deleteActiveSystems(input);
    expect(run.deleted).toHaveBeenCalledTimes(3);
    expect(run.begin).toHaveBeenCalledOnce();
  });

  it("retains exact locators and quarantine after partial S3 failure, then retries safely", async () => {
    const run = fixture();
    const before = structuredClone(run.exports);
    run.deleted.mockImplementationOnce(async (_key, version) => {
      run.absent.add(version);
      for (const [id, stored] of run.remote) if (stored === version) run.remote.delete(id);
      return true;
    });
    run.deleted.mockRejectedValueOnce(new Error("SyntheticS3Failure"));
    await expect(run.store.deleteActiveSystems(input)).rejects.toThrow("SyntheticS3Failure");
    expect(run.exports).toEqual(before);
    expect(run.deletion.state).toBe("quarantined");
    expect(run.calls.some((query) => query.includes("profile.delete_candidate_data"))).toBe(false);
    await run.store.deleteActiveSystems(input);
    expect(run.deleted.mock.calls.map(([, version]) => version)).toEqual([
      "synthetic-version-0",
      "synthetic-version-1",
      "synthetic-version-0",
      "synthetic-version-1",
      "synthetic-unrecorded-version",
    ]);
    expect(run.deletion.state).toBe("active_systems_deleted");
  });

  it("refuses an unconfirmed delete or foreign export key without clearing metadata", async () => {
    const unconfirmed = fixture();
    unconfirmed.deleted.mockResolvedValueOnce(false);
    await expect(unconfirmed.store.deleteActiveSystems(input)).rejects.toThrow(
      "CandidateExportArtifactStillPresent",
    );
    expect(unconfirmed.exports[0]?.state).toBe("ready");
    expect(unconfirmed.deletion.state).toBe("quarantined");
    const foreign = fixture();
    if (foreign.exports[0])
      foreign.exports[0].objectKey = "candidate-data-exports/foreign/export.json";
    await expect(foreign.store.deleteActiveSystems(input)).rejects.toThrow(
      "CandidateExportMaintenanceIdentityRejected",
    );
    expect(foreign.deleted).not.toHaveBeenCalled();
    expect(foreign.deletion.state).toBe("quarantined");
  });
});

describe("candidate-rights resume purge sweep (ADR-034)", () => {
  const user = "019c2b89-79b2-7000-8000-000000000011";
  const first = "019c2b89-79b2-7000-8000-000000000021";
  const second = "019c2b89-79b2-7000-8000-000000000022";

  function sweepFixture(options: {
    eligible?: Array<{ userId: string; documentId: string }>;
    heldWaiting?: number;
    remaining?: Record<string, number>;
    failObjects?: string[];
    failObjectsWith?: Error;
    failRetire?: string[];
    failRetireWith?: Error;
    completeResult?: Record<string, unknown>;
    /** Answers to successive complete_resume_purge calls; the last one repeats. */
    completeResults?: Array<Record<string, unknown>>;
    nativeTaskAbsence?: { absent(taskArns: readonly string[]): Promise<ReadonlySet<string>> };
    withoutPurger?: boolean;
    inventory?: unknown;
  }) {
    const calls: string[] = [];
    const completeCalls: unknown[][] = [];
    const client = vi.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
      const text = query.join("?");
      if (text.includes("pending_resume_purges")) {
        calls.push(`pending:${String(values[0])}`);
        return [
          {
            data:
              "inventory" in options
                ? options.inventory
                : {
                    eligible: options.eligible ?? [{ userId: user, documentId: first }],
                    heldWaiting: options.heldWaiting ?? 0,
                  },
          },
        ];
      }
      if (text.includes("complete_resume_purge")) {
        calls.push(`complete:${String(values[1])}:${String(values[0])}`);
        completeCalls.push(values);
        const sequence = options.completeResults;
        if (sequence)
          return [{ data: sequence[Math.min(completeCalls.length, sequence.length) - 1] }];
        return [{ data: options.completeResult ?? { purged: true } }];
      }
      throw new Error("unexpected query");
    });
    const begin = vi.fn(async (run: (sql: unknown) => Promise<unknown>) => run({}));
    const retireDocumentProposals = vi.fn(
      async (_transaction: unknown, input: { documentId: string }) => {
        calls.push(`retire:${input.documentId}`);
        if (options.failRetire?.includes(input.documentId))
          throw options.failRetireWith ?? new Error("synthetic retire failure");
        return { proposalsErased: 1, importsErased: 1 };
      },
    );
    const purgeDocumentPrefixes = vi.fn(async (documentId: string) => {
      calls.push(`purge:${documentId}`);
      if (options.failObjects?.includes(documentId))
        throw options.failObjectsWith ?? new Error("synthetic s3 failure");
      return { deleted: 2, remaining: options.remaining?.[documentId] ?? 0 };
    });
    const dependencies = {
      database: { client: Object.assign(client, { begin }) } as unknown as DatabaseHandle,
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
      documentObjectStore: options.withoutPurger ? {} : { purgeDocumentPrefixes },
      ...(options.withoutPurger ? {} : { resumeProposals: { retireDocumentProposals } }),
      ...(options.nativeTaskAbsence ? { nativeTaskAbsence: options.nativeTaskAbsence } : {}),
      identityProvider: {},
      subprocessors: [],
      recoveryLedger: {},
    } as unknown as CandidateRightsActivityDependencies;
    return {
      store: new PostgresCandidateRightsActivityStore(dependencies),
      calls,
      completeCalls,
      purgeDocumentPrefixes,
      retireDocumentProposals,
    };
  }

  it("retires proposals, purges the objects, then completes, in that order, and reports counts only", async () => {
    const fixture = sweepFixture({
      eligible: [
        { userId: user, documentId: first },
        { userId: user, documentId: second },
      ],
      heldWaiting: 2,
    });
    await expect(fixture.store.purgeDeletedResumes()).resolves.toEqual({
      scanned: 2,
      purged: 2,
      failed: 0,
      heldWaiting: 2,
    });
    expect(fixture.calls).toEqual([
      "pending:25",
      `retire:${first}`,
      `purge:${first}`,
      `complete:${first}:${user}`,
      `retire:${second}`,
      `purge:${second}`,
      `complete:${second}:${user}`,
    ]);
  });

  it("never completes the database step when a second listing still finds objects", async () => {
    const fixture = sweepFixture({ remaining: { [first]: 1 } });
    await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
      purged: 0,
      failed: 1,
    });
    expect(fixture.calls.some((call) => call.startsWith("complete:"))).toBe(false);
  });

  it("continues past a failing tombstone, and a failed Profile step leaves the objects untouched", async () => {
    const fixture = sweepFixture({
      eligible: [
        { userId: user, documentId: first },
        { userId: user, documentId: second },
      ],
      failRetire: [first],
    });
    await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
      scanned: 2,
      purged: 1,
      failed: 1,
    });
    expect(fixture.calls).not.toContain(`purge:${first}`);
    expect(fixture.calls).toContain(`complete:${second}:${user}`);
    const objectsFailure = sweepFixture({ failObjects: [first] });
    await expect(objectsFailure.store.purgeDeletedResumes()).resolves.toMatchObject({
      purged: 0,
      failed: 1,
    });
    expect(objectsFailure.calls.some((call) => call.startsWith("complete:"))).toBe(false);
  });

  it("counts a resume blocked by an unsettled native generation as a failure and says why, without identifiers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fixture = sweepFixture({
        completeResult: {
          purged: false,
          reason: "native_generation_unsettled",
          unsettled: [
            { state: "bound", hasTask: true, launchClaimed: true, expired: true, overdueHours: 41 },
            { state: "pending", hasTask: false, launchClaimed: true, expired: false },
            { state: "bound; DROP", hasTask: "yes", id: first, overdueHours: -1 },
            "not an entry",
          ],
        },
      });
      await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
        scanned: 1,
        purged: 0,
        failed: 1,
      });
      const logged = error.mock.calls.map(([entry]) => entry as Record<string, unknown>);
      expect(logged).toEqual([
        {
          event: "resume_purge_blocked",
          step: "complete_purge",
          reason: "native_generation_unsettled",
          unsettled: [
            { state: "bound", hasTask: true, launchClaimed: true, expired: true, overdueHours: 41 },
            { state: "pending", hasTask: false, launchClaimed: true, expired: false },
          ],
          boundTasksOldEnoughToCheck: 0,
          taskObserverConfigured: false,
          tasksShownGone: 0,
        },
      ]);
      const text = JSON.stringify(logged);
      expect(text).not.toContain(first);
      expect(text).not.toContain(user);
    } finally {
      error.mockRestore();
    }
  });

  describe("a resume whose native task ECS no longer describes (migration 0021)", () => {
    const taskA =
      "arn:aws:ecs:us-east-2:362544434697:task/ai-job-apply-development/a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const taskB =
      "arn:aws:ecs:us-east-2:362544434697:task/ai-job-apply-development/b1b2c3d4e5f60718293a4b5c6d7e8f90";
    const blocked = (proofTasks: unknown) => ({
      purged: false,
      reason: "native_generation_unsettled",
      unsettled: [
        { state: "bound", hasTask: true, launchClaimed: true, expired: true, overdueHours: 559 },
      ],
      proofTasks,
    });

    it("sends back the tasks ECS shows are gone, and the purge then completes", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const absent = vi.fn(async () => new Set([taskA]));
        const fixture = sweepFixture({
          completeResults: [
            blocked([taskA]),
            { purged: true, idempotencyKeysDeleted: 0, nativeGenerationsSettledTaskAbsent: 1 },
          ],
          nativeTaskAbsence: { absent },
        });
        await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
          scanned: 1,
          purged: 1,
          failed: 0,
        });
        expect(absent).toHaveBeenCalledWith([taskA]);
        expect(fixture.completeCalls).toEqual([
          [user, first],
          [user, first, [taskA]],
        ]);
        expect(info.mock.calls.map(([entry]) => entry)).toEqual([
          { event: "resume_purge_native_task_absent", settled: 1 },
        ]);
        expect(error).not.toHaveBeenCalled();
      } finally {
        info.mockRestore();
        error.mockRestore();
      }
    });

    it("sends back only the tasks it was asked about and found gone", async () => {
      const fixture = sweepFixture({
        completeResults: [blocked([taskA, taskB, "not a task", 7]), { purged: true }],
        nativeTaskAbsence: { absent: async (arns) => new Set([...arns, "arn:foreign"]) },
      });
      await fixture.store.purgeDeletedResumes();
      expect(fixture.completeCalls[1]).toEqual([user, first, [taskA, taskB]]);
    });

    it("stays blocked, and says what it checked, when ECS does not show the task gone", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const fixture = sweepFixture({
          completeResult: blocked([taskA]),
          nativeTaskAbsence: { absent: async () => new Set() },
        });
        await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
          purged: 0,
          failed: 1,
        });
        expect(fixture.completeCalls).toEqual([[user, first]]);
        const logged = error.mock.calls.map(([entry]) => entry as Record<string, unknown>);
        expect(logged).toEqual([
          {
            event: "resume_purge_blocked",
            step: "complete_purge",
            reason: "native_generation_unsettled",
            unsettled: [
              {
                state: "bound",
                hasTask: true,
                launchClaimed: true,
                expired: true,
                overdueHours: 559,
              },
            ],
            boundTasksOldEnoughToCheck: 1,
            taskObserverConfigured: true,
            tasksShownGone: 0,
          },
        ]);
        const text = JSON.stringify(logged);
        expect(text).not.toContain(taskA);
        expect(text).not.toContain(user);
        expect(text).not.toContain(first);
      } finally {
        error.mockRestore();
      }
    });

    it("asks nothing and stays blocked when the runtime has no observer or Documents names no old task", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const absent = vi.fn(async () => new Set([taskA]));
        const noObserver = sweepFixture({ completeResult: blocked([taskA]) });
        await expect(noObserver.store.purgeDeletedResumes()).resolves.toMatchObject({ failed: 1 });
        const noTasks = sweepFixture({
          completeResult: blocked([]),
          nativeTaskAbsence: { absent },
        });
        await expect(noTasks.store.purgeDeletedResumes()).resolves.toMatchObject({ failed: 1 });
        const oldDatabase = sweepFixture({
          completeResult: {
            purged: false,
            reason: "native_generation_unsettled",
            unsettled: [{ state: "bound" }],
          },
          nativeTaskAbsence: { absent },
        });
        await expect(oldDatabase.store.purgeDeletedResumes()).resolves.toMatchObject({ failed: 1 });
        expect(absent).not.toHaveBeenCalled();
        const logged = error.mock.calls.map(([entry]) => entry as Record<string, unknown>);
        expect(logged.map((entry) => entry.taskObserverConfigured)).toEqual([false, true, true]);
        expect(logged.map((entry) => entry.boundTasksOldEnoughToCheck)).toEqual([1, 0, 0]);
      } finally {
        error.mockRestore();
      }
    });

    it("counts a failing observer as a failed step without a message or an identifier", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const fixture = sweepFixture({
          completeResult: blocked([taskA]),
          nativeTaskAbsence: {
            absent: async () => {
              throw new Error(`boom ${taskA}`);
            },
          },
        });
        await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
          purged: 0,
          failed: 1,
        });
        expect(error.mock.calls[0]?.[0]).toMatchObject({
          event: "resume_purge_failed",
          step: "observe_native_tasks",
        });
        expect(JSON.stringify(error.mock.calls)).not.toContain(taskA);
      } finally {
        error.mockRestore();
      }
    });
  });

  it("does not count an already-removed tombstone as purged", async () => {
    const fixture = sweepFixture({ completeResult: { purged: false, reason: "absent" } });
    await expect(fixture.store.purgeDeletedResumes()).resolves.toMatchObject({
      scanned: 1,
      purged: 0,
      failed: 0,
    });
  });

  it("logs only fixed codes, never identifiers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fixture = sweepFixture({ failObjects: [first] });
      await fixture.store.purgeDeletedResumes();
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).toContain("resume_purge_failed");
      expect(logged).not.toContain(first);
      expect(logged).not.toContain(user);
    } finally {
      error.mockRestore();
    }
  });

  it("names the failed step and only fixed-format reasons, never a message or a key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const aws = Object.assign(
        new Error(`Access denied to quarantine/${first}/source for ${user}`),
        {
          name: "AccessDenied",
          Code: "AccessDenied",
          $metadata: { httpStatusCode: 403 },
        },
      );
      const s3 = sweepFixture({ failObjects: [first], failObjectsWith: aws });
      await s3.store.purgeDeletedResumes();
      const pg = sweepFixture({
        failRetire: [first],
        failRetireWith: Object.assign(new Error(`permission denied for table ${user}`), {
          name: "PostgresError",
          code: "42501",
        }),
      });
      await pg.store.purgeDeletedResumes();
      const logged = error.mock.calls.map(([entry]) => entry as Record<string, unknown>);
      expect(logged[0]).toEqual({
        event: "resume_purge_failed",
        step: "purge_objects",
        errorCode: "ResumePurgeStepFailed",
        errorName: "AccessDenied",
        errorReason: "AccessDenied",
        httpStatus: 403,
      });
      expect(logged[1]).toEqual({
        event: "resume_purge_failed",
        step: "retire_proposals",
        errorCode: "ResumePurgeStepFailed",
        errorName: "PostgresError",
        sqlState: "42501",
      });
      const text = JSON.stringify(logged);
      expect(text).not.toContain(first);
      expect(text).not.toContain(user);
      expect(text).not.toMatch(/denied to|permission denied/u);
    } finally {
      error.mockRestore();
    }
  });

  it("drops fields that do not have the expected shape", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const odd = Object.assign(new Error("x"), {
        name: "bad name with spaces!",
        code: "not-a-sqlstate",
        $metadata: { httpStatusCode: 99999 },
      });
      await sweepFixture({
        failObjects: [first],
        failObjectsWith: odd,
      }).store.purgeDeletedResumes();
      expect(error.mock.calls[0]?.[0]).toEqual({
        event: "resume_purge_failed",
        step: "purge_objects",
        errorCode: "ResumePurgeStepFailed",
      });
    } finally {
      error.mockRestore();
    }
  });

  it.each([0, 101, 1.5])("rejects a batch limit of %s before touching anything", async (limit) => {
    const fixture = sweepFixture({});
    await expect(fixture.store.purgeDeletedResumes(limit)).rejects.toThrow(
      "ResumePurgeLimitRejected",
    );
    expect(fixture.calls).toEqual([]);
  });

  it("fails closed when the runtime lacks the purger, or the inventory is malformed", async () => {
    await expect(sweepFixture({ withoutPurger: true }).store.purgeDeletedResumes()).rejects.toThrow(
      "ResumePurgeUnavailable",
    );
    for (const inventory of [
      null,
      { eligible: "no", heldWaiting: 0 },
      { eligible: [{ userId: "not-a-uuid", documentId: first }], heldWaiting: 0 },
      { eligible: [], heldWaiting: "x" },
    ]) {
      const fixture = sweepFixture({ inventory });
      await expect(fixture.store.purgeDeletedResumes()).rejects.toThrow(
        "ResumePurgeInventoryInvalid",
      );
      expect(fixture.purgeDocumentPrefixes).not.toHaveBeenCalled();
    }
  });
});
