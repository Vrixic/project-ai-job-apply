import { readFileSync } from "node:fs";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoricalCompletionEvidence } from "./candidate-deletion-completion-diagnosis.js";
import type { HistoricalCompletionEvidenceTarget } from "./candidate-deletion-completion-evidence.js";
import {
  validateRestoreCompletionDiagnosisResult,
  validateRestoreInspectionResult,
  validateRestoreReplayResult,
} from "./candidate-deletion-restore-contract.js";
import {
  type CandidateDeletionRestoreContext,
  type CandidateDeletionRestoreDependencies,
  type CandidateDeletionRestoreFailureDiagnostic,
  createCandidateDeletionRestoreHandler,
} from "./candidate-deletion-restore-lambda.js";
import { ACCEPTED_CANDIDATE_DELETION_POLICIES } from "./candidate-deletion-restore-policy.js";
import { PostgresCandidateDeletionRestoreStore } from "./candidate-deletion-restore-store.js";
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
  // These cases exercise the two historical policies (D1 and D2); the D3 policy has its own
  // catalog, inventory, and restore-store tests.
  const entries: CandidateDeletionRecoveryEntry[] = ACCEPTED_CANDIDATE_DELETION_POLICIES.slice(
    0,
    2,
  ).map((policy, index) => ({
    requestId: `019c2b89-79b2-7000-8000-00000000000${index + 1}`,
    operationId: `019c2b89-79b2-7000-8000-00000000001${index + 1}`,
    userId: `019c2b89-79b2-7000-8000-00000000002${index + 1}`,
    policyVersion: policy.version,
    policySha256: policy.sha256,
    subjectDigest: String(index + 1).repeat(64),
    confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    completedAt: new Date("2026-09-01T00:01:00.000Z"),
    backupExpiresAt: new Date("2026-10-06T00:00:00.000Z"),
  }));
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
    inspectCompletionEvidence: vi.fn(async (): Promise<HistoricalCompletionEvidence["marker"]> => {
      calls.push("completion-marker");
      throw new Error("SyntheticCompletionMarkerNotConfigured");
    }),
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
  const collectCompletionEvidence = vi.fn(
    async (
      _target: HistoricalCompletionEvidenceTarget,
      _signal: AbortSignal,
    ): Promise<HistoricalCompletionEvidence> => {
      calls.push("completion-evidence");
      throw new Error("SyntheticCompletionEvidenceNotConfigured");
    },
  );
  const openStore = vi.fn(async () => {
    calls.push("open");
    return { store, close, collectCompletionEvidence };
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
    collectCompletionEvidence,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function ownedStorePreflightFailure(entries: readonly CandidateDeletionRecoveryEntry[]) {
  const unsafe = (query: string) =>
    Object.assign(
      Promise.resolve(query.includes("FROM platform.operations") ? [{ id: "wrong" }] : []),
      { cancel: vi.fn() },
    );
  const database = {
    client: {
      begin: async (_mode: string, run: (sql: { unsafe: typeof unsafe }) => Promise<unknown>) =>
        run({ unsafe }),
    },
  } as unknown as DatabaseHandle;
  try {
    await new PostgresCandidateDeletionRestoreStore(database).preflight(entries);
  } catch (failure) {
    return failure;
  }
  throw new Error("SyntheticStoreRefusalMissing");
}

describe("private isolated deletion restore Lambda", () => {
  it("adds only the privately branded reason from an actual refused store preflight", async () => {
    const h = harness();
    h.store.preflight.mockRejectedValue(await ownedStorePreflightFailure(h.snapshot.entries));
    await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: "inspect",
      stage: "store_preflight",
      storeFailure: "OperationCollision",
    });
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.store.reconcile).not.toHaveBeenCalled();
    expect(h.documents.inspectExpectedAbsentDocuments).not.toHaveBeenCalled();
  });

  it.each(["lookalike_error", "lookalike_fields", "primitive", "hostile", "revoked"] as const)(
    "does not classify or inspect an unowned thrown value: %s",
    async (kind) => {
      const h = harness();
      const accessed = vi.fn(() => {
        throw new Error("PRIVATE thrown value accessed");
      });
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const values = {
        lookalike_error: new Error("CandidateDeletionRestoreOperationCollision"),
        lookalike_fields: {
          message: "CandidateDeletionRestoreOperationCollision",
          storeFailure: "OperationCollision",
          code: "OperationCollision",
        },
        primitive: "CandidateDeletionRestoreOperationCollision",
        hostile: new Proxy({}, { get: accessed, ownKeys: accessed, getPrototypeOf: accessed }),
        revoked: revoked.proxy,
      };
      h.store.preflight.mockRejectedValue(values[kind]);
      await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
        /^CandidateDeletionRestoreRejected$/u,
      );
      expect(accessed).not.toHaveBeenCalled();
      expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
        event: "candidate_deletion_restore_rejected",
        action: "inspect",
        stage: "store_preflight",
      });
      expect(h.close).toHaveBeenCalledOnce();
      expect(h.store.reconcile).not.toHaveBeenCalled();
    },
  );

  it.each(["throw", "reject"] as const)(
    "a logger %s remains harmless when a branded store reason is present",
    async (failure) => {
      const h = harness();
      h.store.preflight.mockRejectedValue(await ownedStorePreflightFailure(h.snapshot.entries));
      h.logger.error.mockImplementation(() => {
        const secret = new Error("PRIVATE logger failure");
        if (failure === "throw") throw secret;
        return Promise.reject(secret);
      });
      await expect(h.run(fixture.inspect, h.context)).rejects.toThrow(
        /^CandidateDeletionRestoreRejected$/u,
      );
      expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
        event: "candidate_deletion_restore_rejected",
        action: "inspect",
        stage: "store_preflight",
        storeFailure: "OperationCollision",
      });
      expect(h.close).toHaveBeenCalledOnce();
      expect(h.store.reconcile).not.toHaveBeenCalled();
    },
  );

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

function diagnosticHarness() {
  const h = harness();
  h.snapshot.entries.splice(1);
  h.snapshot.currentPolicyMarkers = 0;
  const entry = h.snapshot.entries[0];
  if (!entry?.completedAt) throw new Error("SyntheticCompletionEntryMissing");
  const marker: HistoricalCompletionEvidence["marker"] = {
    bucketName: h.environment.CANDIDATE_DELETION_RECOVERY_BUCKET ?? "",
    expectedBucketOwner: fixture.configuration.accountId,
    key: "candidate-deletion-recovery/" + entry.requestId + ".json",
    versionId: "synthetic-exact-completion-version",
    etag: '"synthetic-etag"',
    contentLength: 1024,
    lastModified: entry.confirmedAt.toISOString(),
    bodySha256: "1".repeat(64),
    checksumSha256: "1".repeat(64),
    metadataSha256: "2".repeat(64),
    encryptionSha256: "3".repeat(64),
    retentionSha256: "4".repeat(64),
    versionInventorySha256: "5".repeat(64),
    oldTagSet: [
      { Key: "state", Value: "completed" },
      { Key: "completed-at", Value: entry.completedAt.toISOString() },
    ],
    entry: {
      ...entry,
      confirmedAt: entry.confirmedAt.toISOString(),
      completedAt: entry.completedAt.toISOString(),
      backupExpiresAt: entry.backupExpiresAt.toISOString(),
    },
  };
  const completedAt = "2026-09-01T00:00:30.000000Z";
  const rows = {
    dispatchRows: [] as Array<HistoricalCompletionEvidence["dispatchRows"][number]>,
    userRows: [
      {
        id: entry.userId,
        accountState: "quarantined",
        createdAt: "2026-08-01T00:00:00.000000Z",
        quarantinedAt: "2026-09-01T00:00:00.000000Z",
      },
    ],
    requestRows: [
      {
        id: entry.requestId,
        userId: entry.userId,
        operationId: entry.operationId,
        policyVersion: entry.policyVersion,
        state: "completed",
        version: 5,
        requestedAt: "2026-08-31T23:59:00.000000Z",
        updatedAt: completedAt,
        confirmedAt: entry.confirmedAt.toISOString(),
        backupExpiresAt: entry.backupExpiresAt.toISOString(),
        completedAt: completedAt as string | null,
        backupExpiredAt: null as string | null,
      },
    ],
    ledgerRows: [
      {
        requestId: entry.requestId,
        subjectDigest: entry.subjectDigest,
        policyVersion: entry.policyVersion,
        policySha256: entry.policySha256,
        state: "completed",
        ownerInventory: {
          identity: "completed",
          profile: "completed",
          documents: "completed",
          jobs: "completed",
          matching: "completed",
          billing: "completed",
        },
        subprocessorInventory: {},
        confirmedAt: entry.confirmedAt.toISOString(),
        backupExpiresAt: entry.backupExpiresAt.toISOString(),
        completedAt: completedAt as string | null,
        backupExpiredAt: null as string | null,
        updatedAt: completedAt,
      },
    ],
    operationRows: [
      {
        id: entry.operationId,
        userId: entry.userId,
        kind: "account_deletion",
        state: "succeeded",
        result: { resourceId: entry.requestId, resourceType: "account_deletion_request" },
        errorCode: null,
        createdAt: entry.confirmedAt.toISOString(),
        updatedAt: completedAt,
      },
    ],
  };
  h.ledger.inspectCompletionEvidence.mockImplementation(async () => {
    h.calls.push("completion-marker");
    return marker;
  });
  h.collectCompletionEvidence.mockImplementation(async (target) => {
    h.calls.push("completion-evidence");
    return {
      schemaVersion: 1,
      ...target,
      observedAt: fixture.now,
      ...structuredClone(rows),
      durable: null,
    };
  });
  const request = { ...fixture.inspect, action: "diagnose_completion" as const };
  return { ...h, rows, marker, entry, request };
}

describe("private read-only completion diagnosis handler branch", () => {
  it("returns only the fixed receipt and timestamp/checksums after bound read-only corroboration", async () => {
    const h = diagnosticHarness();
    h.store.preflight.mockRejectedValue(new Error("CandidateDeletionRestoreCompletionCollision"));
    const result = await h.run(h.request, h.context);
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
    expect(result).toMatchObject({
      action: "diagnose_completion",
      outcome: "persisted_candidate",
      markersValidated: 1,
      corroboration: "persisted_transaction",
      dispatchEvidence: null,
      reason: null,
      comparison: {
        requestMatchesTag: false,
        ledgerMatchesTag: false,
        persistedPairAgrees: true,
        completionCollisions: ["ledger_completion_mismatch", "request_completion_mismatch"],
      },
      candidate: {
        correctedCompletedAt: "2026-09-01T00:00:30.000Z",
        candidateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      databaseWrites: 0,
      s3Writes: 0,
      recoveryLedgerWrites: 0,
      identityProviderCalls: 0,
    });
    expect(h.calls).toEqual([
      "markers",
      "completion-marker",
      "open",
      "completion-evidence",
      "markers-unchanged",
      "close",
    ]);
    expect(h.store.preflight).not.toHaveBeenCalled();
    expect(h.store.reconcile).not.toHaveBeenCalled();
    expect(h.documents.inspectExpectedAbsentDocuments).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    for (const value of [
      h.entry.requestId,
      h.entry.operationId,
      h.entry.userId,
      h.entry.subjectDigest,
      h.marker.versionId,
      h.marker.key,
      h.marker.bucketName,
    ])
      expect(JSON.stringify(result)).not.toContain(value);
    expect(validateRestoreInspectionResult(result)).toBe(false);
    expect(validateRestoreReplayResult(result)).toBe(false);
  });
  it("keeps an already consistent tag diagnostic-only, with no candidate", async () => {
    const h = diagnosticHarness();
    const completion = h.entry.completedAt?.toISOString() ?? "";
    for (const row of h.rows.requestRows) row.completedAt = completion;
    for (const row of h.rows.ledgerRows) row.completedAt = completion;
    for (const row of [...h.rows.requestRows, ...h.rows.ledgerRows, ...h.rows.operationRows])
      row.updatedAt = completion;
    const result = await h.run(h.request, h.context);
    expect(result).toMatchObject({
      outcome: "consistent",
      candidate: null,
      reason: null,
      corroboration: null,
    });
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
  });
  it("returns only opaque acknowledged dispatch bindings from the exact-operation SQL projection", async () => {
    const h = diagnosticHarness();
    const eventId = "019c2b89-79b2-7000-8000-000000000099";
    const executionName = "outbox-" + eventId;
    const executionArn =
      "arn:aws:lambda:us-east-2:" +
      h.marker.expectedBucketOwner +
      ":function:ai-job-apply-development-profile-readiness-durable:12/durable-execution/" +
      executionName +
      "/synthetic-execution";
    h.rows.dispatchRows.push({
      id: eventId,
      type: "profile.account-deletion.confirmed.v1",
      source: "urn:ai-job-apply:profile-service",
      subject: "account-deletion-request/" + h.entry.requestId,
      dataSchema:
        "https://schemas.ai-job-apply.internal/events/profile.account-deletion.confirmed.v1.json",
      data: {
        deletionRequestId: h.entry.requestId,
        operationId: h.entry.operationId,
        policyVersion: h.entry.policyVersion,
      },
      dispatchTarget: "lambda_durable",
      createdAt: "2026-09-01T00:00:01.000000Z",
      publishedAt: "2026-09-01T00:00:02.001000Z",
      durableStartedAt: "2026-09-01T00:00:02.002000Z",
      nudgeClaimedAt: null,
      durableExecutionName: executionName,
      durableExecutionArn: executionArn,
    });
    const result = await h.run(h.request, h.context);
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
    expect(result).toMatchObject({
      outcome: "persisted_candidate",
      corroboration: "persisted_transaction_and_dispatch",
      dispatchEvidence: {
        status: "acknowledged_unclaimed",
        attemptCount: 1,
        bindingSha256: [expect.stringMatching(/^[a-f0-9]{64}$/u)],
        latestCreatedAt: "2026-09-01T00:00:01.000000Z",
        latestAcknowledgedAt: "2026-09-01T00:00:02.002000Z",
      },
    });
    for (const privateValue of [
      eventId,
      executionName,
      executionArn,
      h.entry.requestId,
      h.entry.operationId,
    ])
      expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(h.store.preflight).not.toHaveBeenCalled();
    expect(h.store.reconcile).not.toHaveBeenCalled();
    expect(h.ledger.assertUnchanged).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("returns a fixed refusal instead of discarding a malformed additional operation attempt", async () => {
    const h = diagnosticHarness();
    h.rows.dispatchRows.push({
      data: { operationId: h.entry.operationId },
    } as HistoricalCompletionEvidence["dispatchRows"][number]);
    const result = await h.run(h.request, h.context);
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
    expect(result).toMatchObject({
      outcome: "refused",
      reason: "dispatch_corroboration_missing",
      dispatchEvidence: null,
      candidate: null,
    });
    expect(h.store.preflight).not.toHaveBeenCalled();
    expect(h.store.reconcile).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });
  it.each([
    [
      "request_completion_mismatch",
      (h: ReturnType<typeof diagnosticHarness>) => {
        const row = h.rows.ledgerRows[0];
        if (row) row.completedAt = h.entry.completedAt?.toISOString() ?? "";
      },
    ],
    [
      "ledger_completion_mismatch",
      (h: ReturnType<typeof diagnosticHarness>) => {
        const row = h.rows.requestRows[0];
        if (row) row.completedAt = h.entry.completedAt?.toISOString() ?? "";
      },
    ],
    [
      "request_timestamp_state_conflict",
      (h: ReturnType<typeof diagnosticHarness>) => {
        const row = h.rows.requestRows[0];
        if (row) row.backupExpiredAt = "2026-09-01T00:00:00.000000Z";
      },
    ],
    [
      "ledger_timestamp_state_conflict",
      (h: ReturnType<typeof diagnosticHarness>) => {
        const row = h.rows.ledgerRows[0];
        if (row) row.backupExpiredAt = "2026-09-01T00:00:00.000000Z";
      },
    ],
    [
      "backup_expiry_conflict",
      (h: ReturnType<typeof diagnosticHarness>) => {
        for (const row of [...h.rows.requestRows, ...h.rows.ledgerRows]) {
          row.state = "backup_expired";
          row.backupExpiredAt = "2026-09-01T00:00:00.000000Z";
        }
      },
    ],
  ] as const)("reports fixed %s only, with no correction candidate", async (predicate, change) => {
    const h = diagnosticHarness();
    change(h);
    const result = await h.run(h.request, h.context);
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
    if (result.action !== "diagnose_completion") throw new Error("SyntheticWrongAction");
    expect(result.outcome).toBe("refused");
    expect(result.candidate).toBeNull();
    expect(result.comparison?.completionCollisions).toContain(predicate);
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });
  it("returns fixed cardinality refusal without disclosing absent source rows", async () => {
    const h = diagnosticHarness();
    h.rows.requestRows.splice(0);
    const result = await h.run(h.request, h.context);
    expect(result).toMatchObject({
      outcome: "refused",
      reason: "row_cardinality",
      candidate: null,
      comparison: null,
    });
    expect(validateRestoreCompletionDiagnosisResult(result)).toBe(true);
  });
  it("refuses common microseconds not representable by the authorized tag format", async () => {
    const h = diagnosticHarness();
    for (const row of [...h.rows.requestRows, ...h.rows.ledgerRows])
      row.completedAt = "2026-09-01T00:00:30.000001Z";
    const result = await h.run(h.request, h.context);
    expect(result).toMatchObject({
      outcome: "refused",
      reason: "timestamp_chronology",
      candidate: null,
    });
  });
  it.each([0, 2])("refuses %i markers before opening the restored store", async (count) => {
    const h = diagnosticHarness();
    h.snapshot.entries.splice(0);
    if (count === 2) h.snapshot.entries.push({ ...h.entry }, { ...h.entry });
    h.snapshot.historicalPolicyMarkers = count;
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.openStore).not.toHaveBeenCalled();
  });
  it("rejects a forged snapshot/accessor failure before connecting", async () => {
    const h = diagnosticHarness();
    h.ledger.inspectCompletionEvidence.mockRejectedValue(new Error("PRIVATE marker"));
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.openStore).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: "diagnose_completion",
      stage: "completion_marker",
    });
  });
  it("rechecks the whole ledger after SQL reads and rejects any drift", async () => {
    const h = diagnosticHarness();
    h.ledger.assertUnchanged.mockRejectedValue(new Error("PRIVATE drift"));
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });
  it.each([
    "sourceSha",
    "restoreContextSha256",
    "configurationSha256",
    "markerSnapshotSha256",
  ] as const)("rejects collector proof bound to a different %s", async (key) => {
    const h = diagnosticHarness();
    const original = h.collectCompletionEvidence.getMockImplementation();
    h.collectCompletionEvidence.mockImplementation(async (target, signal) => {
      if (!original) throw new Error("SyntheticMissingImplementation");
      return {
        ...(await original(target, signal)),
        [key]: key === "sourceSha" ? "0".repeat(40) : "0".repeat(64),
      };
    });
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("rejects a substituted marker/version in the private collector result", async () => {
    const h = diagnosticHarness();
    const original = h.collectCompletionEvidence.getMockImplementation();
    h.collectCompletionEvidence.mockImplementation(async (target, signal) => {
      if (!original) throw new Error("SyntheticMissingImplementation");
      const result = await original(target, signal);
      return { ...result, marker: { ...result.marker, versionId: "different-version" } };
    });
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
  });
  it("does not log or inspect an arbitrary hostile SQL failure", async () => {
    const h = diagnosticHarness();
    const accessed = vi.fn(() => {
      throw new Error("PRIVATE getter");
    });
    h.collectCompletionEvidence.mockRejectedValue(
      new Proxy({}, { get: accessed, ownKeys: accessed, getPrototypeOf: accessed }),
    );
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(accessed).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "candidate_deletion_restore_rejected",
      action: "diagnose_completion",
      stage: "completion_evidence",
    });
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("retains the abort/deadline and close boundary during diagnosis", async () => {
    const h = diagnosticHarness();
    const original = h.collectCompletionEvidence.getMockImplementation();
    h.collectCompletionEvidence.mockImplementation(async (target, signal) => {
      if (!original) throw new Error("SyntheticMissingImplementation");
      const result = await original(target, signal);
      h.context.getRemainingTimeInMillis = () => 10_000;
      return result;
    });
    await expect(h.run(h.request, h.context)).rejects.toThrow(
      /^CandidateDeletionRestoreRejected$/u,
    );
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.ledger.assertUnchanged).not.toHaveBeenCalled();
  });
  it("never accepts extra target fields or an inspection digest on the diagnostic request", async () => {
    for (const extra of [
      { key: "other" },
      { reviewedInspectionSha256: fixture.inspectionSha256 },
    ]) {
      const h = diagnosticHarness();
      await expect(h.run({ ...h.request, ...extra }, h.context)).rejects.toThrow(
        /^CandidateDeletionRestoreRejected$/u,
      );
      expect(h.openStore).not.toHaveBeenCalled();
    }
  });
  it("does not enable Replay with a diagnosis checksum", async () => {
    const h = diagnosticHarness();
    const result = await h.run(h.request, h.context);
    if (result.action !== "diagnose_completion" || !result.candidate)
      throw new Error("SyntheticMissingCandidate");
    h.store.preflight.mockRejectedValue(new Error("CandidateDeletionRestoreCompletionCollision"));
    await expect(
      h.run(
        { ...fixture.replay, reviewedInspectionSha256: result.candidate.candidateSha256 },
        h.context,
      ),
    ).rejects.toThrow(/^CandidateDeletionRestoreRejected$/u);
    expect(h.store.preflight).toHaveBeenCalledOnce();
    expect(h.store.reconcile).not.toHaveBeenCalled();
  });
});
