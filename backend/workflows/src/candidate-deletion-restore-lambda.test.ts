import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CandidateDeletionRestoreContext,
  type CandidateDeletionRestoreDependencies,
  type CandidateDeletionRestoreFailureDiagnostic,
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
  const logger = {
    error: vi.fn<(diagnostic: CandidateDeletionRestoreFailureDiagnostic) => void | Promise<void>>(),
  };
  const dependencies: CandidateDeletionRestoreDependencies = {
    logger,
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
    logger,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
    expect(h.logger.error).not.toHaveBeenCalled();
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
    expect(h.logger.error).not.toHaveBeenCalled();
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
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: "inspect",
      stage: "marker_snapshot",
    });
  });

  it.each([
    "environment",
    "request",
    "version",
    "budget",
    "ledger_client",
    "documents_client",
    "marker_snapshot",
    "marker_policy",
    "store_open",
    "store_preflight",
    "document_preflight",
    "inspection_result",
    "inspection_binding",
    "ledger_recheck",
    "document_recheck",
    "reconcile",
    "post_reconcile_ledger",
    "post_reconcile_documents",
    "replay_result",
    "store_close",
  ] as const)("reports only closed classifications for the %s boundary", async (stage) => {
    const h = harness();
    const secret = new Error(
      JSON.stringify({
        sentinel: "PRIVATE_RESTORE_DIAGNOSTIC_CANARY",
        sql: "SELECT private_candidate_data FROM restored_owner",
        locator: h.preflight.documentObjects,
        request: fixture.replay,
        environment: h.environment,
      }),
    );
    let request = { ...fixture.replay };
    switch (stage) {
      case "environment":
        h.dependencies.environment = () => {
          throw secret;
        };
        break;
      case "request":
        request = { ...request, action: "PRIVATE_RESTORE_DIAGNOSTIC_CANARY" };
        break;
      case "version":
        h.context.functionVersion = "2";
        break;
      case "budget":
        h.context.getRemainingTimeInMillis = () => 0;
        break;
      case "ledger_client":
        h.dependencies.ledger = () => {
          throw secret;
        };
        break;
      case "documents_client":
        h.dependencies.documents = () => {
          throw secret;
        };
        break;
      case "marker_snapshot":
        h.ledger.inspectCompletedMarkers.mockRejectedValue(secret);
        break;
      case "marker_policy":
        h.snapshot.currentPolicyMarkers = 2;
        break;
      case "store_open":
        h.openStore.mockRejectedValue(secret);
        break;
      case "store_preflight":
        h.store.preflight.mockRejectedValue(secret);
        break;
      case "document_preflight":
        h.documents.inspectExpectedAbsentDocuments.mockRejectedValueOnce(secret);
        break;
      case "inspection_result":
        h.preflight.sha256 = "invalid";
        break;
      case "inspection_binding":
        request = { ...request, reviewedInspectionSha256: "0".repeat(64) };
        break;
      case "ledger_recheck":
        h.ledger.assertUnchanged.mockRejectedValueOnce(secret);
        break;
      case "document_recheck":
        h.documents.inspectExpectedAbsentDocuments
          .mockResolvedValueOnce(h.absent)
          .mockRejectedValueOnce(secret);
        break;
      case "reconcile":
        h.store.reconcile.mockRejectedValue(secret);
        break;
      case "post_reconcile_ledger":
        h.ledger.assertUnchanged.mockResolvedValueOnce(undefined).mockRejectedValueOnce(secret);
        break;
      case "post_reconcile_documents":
        h.documents.inspectExpectedAbsentDocuments
          .mockResolvedValueOnce(h.absent)
          .mockResolvedValueOnce(h.absent)
          .mockRejectedValueOnce(secret);
        break;
      case "replay_result":
        h.store.reconcile.mockResolvedValue({
          restoredUsersAbsent: 0,
          restoredUsersReconciled: 2,
          restoredUsersAlreadyReconciled: 0,
        });
        break;
      case "store_close":
        h.close.mockRejectedValue(secret);
        break;
    }
    await expect(h.run(request, h.context)).rejects.toThrow(/^CandidateDeletionRestoreRejected$/u);
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: stage === "environment" || stage === "request" ? "unvalidated" : "replay",
      stage,
    });
    const diagnostic = JSON.stringify(h.logger.error.mock.calls);
    for (const forbidden of [
      "PRIVATE_RESTORE_DIAGNOSTIC_CANARY",
      "SELECT",
      "quarantine/",
      fixture.configuration.accountId,
      fixture.configuration.runId,
      fixture.configuration.sourceSha,
      fixture.configuration.sourceHostname,
      fixture.configuration.targetHostname,
      fixture.configurationSha256,
      h.snapshot.entries[0]?.userId,
      h.environment.DATABASE_SECRET_ID,
    ]) {
      if (forbidden) expect(diagnostic).not.toContain(forbidden);
    }
  });

  it("records both the original failed boundary and cleanup refusal without losing either", async () => {
    const h = harness();
    h.store.preflight.mockRejectedValue(new Error("PRIVATE preflight"));
    h.close.mockRejectedValue(new Error("PRIVATE close"));
    await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.logger.error.mock.calls).toEqual([
      [
        {
          event: "candidate_deletion_restore_rejected",
          action: "inspect",
          stage: "store_preflight",
        },
      ],
      [{ event: "candidate_deletion_restore_rejected", action: "inspect", stage: "store_close" }],
    ]);
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });

  it.each(["throw", "reject"] as const)(
    "logger %s cannot replace the original refusal or prevent cleanup",
    async (failure) => {
      const h = harness();
      h.store.preflight.mockRejectedValue(new Error("PRIVATE original SQL"));
      h.logger.error.mockImplementation(() => {
        const secret = new Error("PRIVATE logger failure");
        if (failure === "throw") throw secret;
        return Promise.reject(secret);
      });
      await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
        /^CandidateDeletionRestoreRejected$/u,
      );
      expect(h.close).toHaveBeenCalledOnce();
      expect(h.store.reconcile).not.toHaveBeenCalled();
    },
  );

  it("does not read thrown messages, stacks, codes, or serialization hooks", async () => {
    const h = harness();
    const inspectThrown = vi.fn(() => {
      throw new Error("PRIVATE diagnostic object accessed");
    });
    const secret = new Proxy({}, { get: inspectThrown, ownKeys: inspectThrown });
    h.store.preflight.mockRejectedValue(secret);
    await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(inspectThrown).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: "inspect",
      stage: "store_preflight",
    });
  });

  it("defaults to a single structured JSON classification without exception or request data", async () => {
    const h = harness();
    delete h.dependencies.logger;
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.store.preflight.mockRejectedValue(
      new Error(
        `PRIVATE ${h.environment.DATABASE_SECRET_ID} ${h.preflight.documentObjects[0]?.userId}`,
      ),
    );
    await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(output).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "candidate_deletion_restore_rejected",
        action: "inspect",
        stage: "store_preflight",
      }),
    );
  });
});
