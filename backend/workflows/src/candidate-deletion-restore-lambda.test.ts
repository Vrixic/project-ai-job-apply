import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CandidateDeletionRestoreContext,
  type CandidateDeletionRestoreDependencies,
  createCandidateDeletionRestoreHandler,
} from "./candidate-deletion-restore-lambda.js";
import { ACCEPTED_CANDIDATE_DELETION_POLICIES } from "./candidate-deletion-restore-policy.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../scripts/tests/fixtures/candidate-deletion-restore-contract.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function harness() {
  const entries: CandidateDeletionRecoveryEntry[] = ACCEPTED_CANDIDATE_DELETION_POLICIES.map(
    (policy, index) => ({
      requestId: `019c2b89-79b2-7000-8000-00000000000${index + 1}`,
      operationId: `019c2b89-79b2-7000-8000-00000000001${index + 1}`,
      userId: `019c2b89-79b2-7000-8000-00000000002${index + 1}`,
      policyVersion: policy.version,
      policySha256: policy.sha256,
      subjectDigest: String(index + 1).repeat(64),
      confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
      completedAt: new Date("2026-09-01T00:01:00.000Z"),
      backupExpiresAt: new Date("2026-10-06T00:00:00.000Z"),
    }),
  );
  const calls: string[] = [];
  const snapshot = {
    entries,
    sha256: fixture.markerSnapshotSha256 as string,
    historicalPolicyMarkers: 1,
    currentPolicyMarkers: 1,
  };
  const preflight = {
    sha256: fixture.storePreflightSha256 as string,
    restoredSubjectsPresent: 1,
    restoredSubjectsAbsent: 1,
    documentObjects: [
      {
        userId: entries[0]?.userId ?? "",
        documentId: "019c2b89-79b2-7000-8000-000000000031",
        sourceObjectKey: "quarantine/019c2b89-79b2-7000-8000-000000000031/source",
      },
    ],
  };
  const absent = {
    sha256: fixture.documentAbsenceSha256 as string,
    documentKeysChecked: 1,
    documentVersionsObserved: 0 as const,
  };
  const ledger = {
    inspectCompletedMarkers: vi.fn(async () => {
      calls.push("markers");
      return snapshot;
    }),
    assertUnchanged: vi.fn(async () => {
      calls.push("markers-unchanged");
    }),
  };
  const documents = {
    inspectExpectedAbsentDocuments: vi.fn(async () => {
      calls.push("documents-absent");
      return absent;
    }),
  };
  const store = {
    preflight: vi.fn(async () => {
      calls.push("preflight");
      return preflight;
    }),
    reconcile: vi.fn(async () => {
      calls.push("reconcile");
      return {
        restoredUsersReconciled: 1,
        restoredUsersAbsent: 1,
        restoredUsersAlreadyReconciled: 0,
      };
    }),
  };
  const close = vi.fn(async () => {
    calls.push("close");
  });
  const openStore = vi.fn(async () => {
    calls.push("open");
    return { store, close };
  });
  const environment: Record<string, string> = {
    ...fixture.environment,
    AWS_LAMBDA_FUNCTION_VERSION: "1",
  };
  const dependencies: CandidateDeletionRestoreDependencies = {
    environment: () => environment,
    now: () => new Date(fixture.now),
    ledger: () => ledger,
    documents: () => documents,
    openStore,
  };
  const context: CandidateDeletionRestoreContext = {
    invokedFunctionArn: fixture.invokedFunctionArn,
    functionVersion: "1",
    getRemainingTimeInMillis: () => 299_000,
  };
  return {
    run: createCandidateDeletionRestoreHandler(dependencies),
    context,
    dependencies,
    environment,
    snapshot,
    preflight,
    absent,
    ledger,
    documents,
    store,
    close,
    openStore,
    calls,
  };
}

afterEach(() => vi.useRealTimers());

describe("private isolated deletion restore Lambda", () => {
  it("inspects both historical policies and returns only schema-bound aggregates without writes", async () => {
    const h = harness();
    const result = await h.run(fixture.inspect, h.context);
    expect(result).toMatchObject({
      action: "inspect",
      outcome: "inspected",
      markersValidated: 2,
      historicalPolicyMarkers: 1,
      currentPolicyMarkers: 1,
      restoredSubjectsPresent: 1,
      restoredSubjectsAbsent: 1,
      documentVersionsObserved: 0,
      inspectionSha256: fixture.inspectionSha256,
    });
    expect(h.store.reconcile).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      "markers",
      "open",
      "preflight",
      "documents-absent",
      "markers-unchanged",
      "documents-absent",
      "close",
    ]);
    for (const entry of h.snapshot.entries)
      expect(JSON.stringify(result)).not.toContain(entry.userId);
    expect(JSON.stringify(result)).not.toContain("quarantine/");
  });

  it("replays only the reviewed inspection and rechecks the cloud boundary on both sides", async () => {
    const h = harness();
    const result = await h.run(fixture.replay, h.context);
    expect(result).toMatchObject({
      action: "replay",
      outcome: "replayed",
      restoredUsersReconciled: 1,
      restoredUsersAbsent: 1,
      restoredUsersAlreadyReconciled: 0,
      s3Writes: 0,
      recoveryLedgerWrites: 0,
      identityProviderCalls: 0,
    });
    expect(h.calls).toEqual([
      "markers",
      "open",
      "preflight",
      "documents-absent",
      "markers-unchanged",
      "documents-absent",
      "reconcile",
      "markers-unchanged",
      "documents-absent",
      "close",
    ]);
    expect(h.store.reconcile).toHaveBeenCalledWith(
      expect.any(Array),
      h.preflight,
      expect.any(AbortSignal),
    );
  });

  it("reports already reconciled tombstones separately from physically absent users", async () => {
    const h = harness();
    h.store.reconcile.mockResolvedValue({
      restoredUsersReconciled: 0,
      restoredUsersAbsent: 1,
      restoredUsersAlreadyReconciled: 1,
    });
    expect(await h.run(fixture.replay, h.context)).toMatchObject({
      restoredUsersAlreadyReconciled: 1,
      restoredUsersAbsent: 1,
    });
  });

  it("allows an empty valid inspection without calling it positive deletion acceptance", async () => {
    const h = harness();
    h.snapshot.entries = [];
    h.snapshot.historicalPolicyMarkers = 0;
    h.snapshot.currentPolicyMarkers = 0;
    h.preflight.restoredSubjectsPresent = 0;
    h.preflight.restoredSubjectsAbsent = 0;
    h.preflight.documentObjects = [];
    h.absent.documentKeysChecked = 0;
    expect(await h.run(fixture.inspect, h.context)).toMatchObject({
      markersValidated: 0,
      documentKeysChecked: 0,
    });
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { action: "execute" },
    { databaseUrl: "postgres://generated.invalid" },
    { functionVersion: "$LATEST" },
    { runId: "0".repeat(32) },
    { configurationSha256: "0".repeat(64) },
    { reviewedInspectionSha256: "0".repeat(64) },
  ])("rejects an invalid inspect request before cloud/database I/O: %j", async (mutation) => {
    const h = harness();
    await expect(h.run({ ...fixture.inspect, ...mutation }, h.context)).rejects.toThrow(
      "CandidateDeletionRestoreRejected",
    );
    expect(h.ledger.inspectCompletedMarkers).not.toHaveBeenCalled();
    expect(h.openStore).not.toHaveBeenCalled();
  });

  it.each([0, 10_000, 300_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid remaining execution budget %s before I/O",
    async (remaining) => {
      const h = harness();
      h.context.getRemainingTimeInMillis = () => remaining;
      await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
        "CandidateDeletionRestoreRejected",
      );
      expect(h.ledger.inspectCompletedMarkers).not.toHaveBeenCalled();
    },
  );

  it.each([
    "context-version",
    "environment-version",
    "unqualified-arn",
    "primary-url-override",
    "expired",
  ])('rejects the invalid execution boundary "%s" before I/O', async (mutation) => {
    const h = harness();
    if (mutation === "context-version") h.context.functionVersion = "2";
    if (mutation === "environment-version") h.environment.AWS_LAMBDA_FUNCTION_VERSION = "2";
    if (mutation === "unqualified-arn")
      h.context.invokedFunctionArn = h.context.invokedFunctionArn.slice(0, -2);
    if (mutation === "primary-url-override")
      h.environment.DATABASE_URL = "postgres://generated.invalid";
    if (mutation === "expired") h.dependencies.now = () => new Date("2026-09-08T00:26:00.000Z");
    await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
      "CandidateDeletionRestoreRejected",
    );
    expect(h.ledger.inspectCompletedMarkers).not.toHaveBeenCalled();
  });

  it("validates a bad later marker before opening the database for any earlier valid marker", async () => {
    const h = harness();
    const second = h.snapshot.entries[1];
    if (!second) throw new Error("FixtureMissing");
    second.policySha256 = "0".repeat(64);
    await expect(h.run(fixture.replay, h.context)).rejects.toThrow(
      "CandidateDeletionRestoreRejected",
    );
    expect(h.openStore).not.toHaveBeenCalled();
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    "marker-counts",
    "subject-counts",
    "document-version",
    "stale-review",
    "ledger-changed",
    "documents-changed",
    "preflight-failed",
  ])('does no SQL reconciliation when preflight rejects "%s"', async (mutation) => {
    const h = harness();
    let request = { ...fixture.replay };
    if (mutation === "marker-counts") h.snapshot.currentPolicyMarkers = 2;
    if (mutation === "subject-counts") h.preflight.restoredSubjectsPresent = 2;
    if (mutation === "document-version") Object.assign(h.absent, { documentVersionsObserved: 1 });
    if (mutation === "stale-review")
      request = { ...request, reviewedInspectionSha256: "0".repeat(64) };
    if (mutation === "ledger-changed")
      h.ledger.assertUnchanged.mockRejectedValue(new Error("PRIVATE marker detail"));
    if (mutation === "documents-changed")
      h.documents.inspectExpectedAbsentDocuments
        .mockResolvedValueOnce(h.absent)
        .mockResolvedValueOnce({ ...h.absent, sha256: "0".repeat(64) });
    if (mutation === "preflight-failed")
      h.store.preflight.mockRejectedValue(new Error("PRIVATE SQL row value"));
    await expect(h.run(request, h.context)).rejects.toThrow(/^CandidateDeletionRestoreRejected$/u);
    expect(h.store.reconcile).not.toHaveBeenCalled();
    if (mutation !== "marker-counts") expect(h.close).toHaveBeenCalledOnce();
  });

  it.each([
    "reconcile-failed",
    "post-ledger-changed",
    "post-documents-changed",
    "result-counts",
    "close-failed",
  ])(
    'sanitizes ambiguous post-write failure "%s" and never automatically replays',
    async (mutation) => {
      const h = harness();
      if (mutation === "reconcile-failed")
        h.store.reconcile.mockRejectedValue(new Error("PRIVATE SQL value"));
      if (mutation === "post-ledger-changed")
        h.ledger.assertUnchanged
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("PRIVATE marker value"));
      if (mutation === "post-documents-changed")
        h.documents.inspectExpectedAbsentDocuments
          .mockResolvedValueOnce(h.absent)
          .mockResolvedValueOnce(h.absent)
          .mockResolvedValueOnce({ ...h.absent, sha256: "0".repeat(64) });
      if (mutation === "result-counts")
        h.store.reconcile.mockResolvedValue({
          restoredUsersAbsent: 0,
          restoredUsersReconciled: 2,
          restoredUsersAlreadyReconciled: 0,
        });
      if (mutation === "close-failed")
        h.close.mockRejectedValue(new Error("PRIVATE database host"));
      await expect(h.run(fixture.replay, h.context)).rejects.toThrow(
        /^CandidateDeletionRestoreRejected$/u,
      );
      expect(h.store.reconcile).toHaveBeenCalledOnce();
      expect(h.close).toHaveBeenCalledOnce();
    },
  );

  it("opens and closes a fresh store on every invocation rather than retaining a warm live pool", async () => {
    const h = harness();
    await h.run(fixture.inspect, h.context);
    await h.run(fixture.inspect, h.context);
    expect(h.openStore).toHaveBeenCalledTimes(2);
    expect(h.close).toHaveBeenCalledTimes(2);
  });

  it("cancels cloud inspection at the whole invocation deadline before any database opens", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.context.getRemainingTimeInMillis = () => 10_050;
    h.dependencies.ledger = () => ({
      ...h.ledger,
      inspectCompletedMarkers: (_now, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("PRIVATE timeout")), {
            once: true,
          });
        }),
    });
    const run = h.run(fixture.inspect, h.context);
    const result = expect(run).rejects.toThrow(/^CandidateDeletionRestoreRejected$/u);
    await vi.advanceTimersByTimeAsync(51);
    await result;
    expect(h.openStore).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
