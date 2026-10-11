import { fileURLToPath } from "node:url";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  verifyReconciledCandidateDeletionCopy,
  verifyReconciledCandidateDeletionCopyWithDocumentContinuity,
} from "./candidate-deletion-reconciled-copy.js";
import {
  type CandidateDeletionRestoreReplayResult,
  restoreInspectionSha256,
} from "./candidate-deletion-restore-contract.js";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
} from "./candidate-deletion-restore-policy.js";
import {
  digestRestoredData,
  PRESERVATION_RELATIONS,
} from "./candidate-deletion-restore-preservation.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

function setup() {
  const uuid = (n: number) => `019c2b89-79b2-7000-8000-${n.toString().padStart(12, "0")}`;
  const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[1];
  if (!policy) throw new Error("SyntheticPolicyMissing");
  const entry: CandidateDeletionRecoveryEntry = {
    userId: uuid(1),
    requestId: uuid(2),
    operationId: uuid(3),
    policyVersion: policy.version,
    policySha256: policy.sha256,
    subjectDigest: "a".repeat(64),
    confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    completedAt: new Date("2026-09-01T00:00:01.000Z"),
    backupExpiresAt: new Date("2026-10-06T00:00:00.000Z"),
  };
  const state = {
    valid: true,
    absent: false,
    changedData: false,
    ownerCounts: Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, 0])),
  };
  const queries: string[] = [];
  const cancel = vi.fn();
  const unsafe = vi.fn((query: string) => {
    queries.push(query);
    let output: Record<string, unknown>[];
    if (query.startsWith("SET LOCAL")) output = [];
    else if (query.includes('AS "ownerCounts"'))
      output = [{ ownerCounts: { ...state.ownerCounts } }];
    else if (query.startsWith("WITH\n")) output = [{ absent: state.absent, valid: state.valid }];
    else if (query.includes("AS settings"))
      output = [
        {
          settings: [
            "UTC",
            "ISO, YMD",
            "iso_8601",
            "3",
            "hex",
            "off",
            "UTF8",
            "UTF8",
            16,
            "pg_catalog",
          ],
        },
      ];
    else if (query.includes("WITH tables AS"))
      output = [{ relations: [...PRESERVATION_RELATIONS].sort(), visible: true }];
    else if (query.startsWith("WITH row_hashes"))
      output = [
        {
          rows: "1",
          bytes: "40",
          largest: "40",
          sha: (state.changedData ? "c" : "a").repeat(64),
          schema: "b".repeat(64),
        },
      ];
    else throw new Error("UnexpectedSyntheticQuery");
    return Object.assign(Promise.resolve(output), { cancel });
  });
  const sql = { unsafe };
  const begin = vi.fn(
    async (_options: string, action: (transaction: typeof sql) => Promise<unknown>) => action(sql),
  );
  const database = { client: { ...sql, begin } } as unknown as DatabaseHandle;
  const snapshot = {
    entries: [entry],
    sha256: "d".repeat(64),
    historicalPolicyMarkers: 0,
    currentPolicyMarkers: 1,
  };
  const ledger = {
    inspectCompletedMarkers: vi.fn(async () => snapshot),
    assertUnchanged: vi.fn(async () => undefined),
  };
  async function receipt(): Promise<CandidateDeletionRestoreReplayResult> {
    const reconciled = await digestRestoredData(
      sql as unknown as Parameters<typeof digestRestoredData>[0],
      [],
      { deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 },
    );
    queries.length = 0;
    unsafe.mockClear();
    const configurationSha256 = "e".repeat(64),
      restoredPreflightSha256 = "f".repeat(64);
    return {
      schemaVersion: 1,
      action: "replay",
      outcome: "replayed",
      runId: "a".repeat(32),
      sourceSha: "b".repeat(40),
      configurationSha256,
      functionVersion: "3",
      expiresAt: "2026-09-01T00:30:00.000Z",
      markerSnapshotSha256: snapshot.sha256,
      restoredPreflightSha256,
      inspectionSha256: restoreInspectionSha256(
        configurationSha256,
        snapshot.sha256,
        restoredPreflightSha256,
      ),
      markersValidated: 1,
      historicalPolicyMarkers: 0,
      currentPolicyMarkers: 1,
      restoredSubjectsPresent: 1,
      restoredSubjectsAbsent: 0,
      documentKeysChecked: 1,
      documentVersionsObserved: 0,
      restoredUsersReconciled: 1,
      restoredUsersAlreadyReconciled: 0,
      restoredUsersAbsent: 0,
      s3Writes: 0,
      recoveryLedgerWrites: 0,
      identityProviderCalls: 0,
      preservation: { schemaVersion: 1, unchanged: { ...reconciled }, reconciled },
    };
  }
  return { state, queries, unsafe, begin, cancel, database, ledger, snapshot, receipt };
}
const error = "CandidateDeletionReconciledCopyRejected";
afterEach(() => vi.useRealTimers());

describe("separate read-only reconciled-copy verification", () => {
  it("uses an expired original attested receipt as immutable history without replay or deadline renewal", async () => {
    const h = setup();
    const receipt = await h.receipt();
    const original = JSON.stringify(receipt);
    const result = await verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt);
    expect(h.begin.mock.calls[0]?.[0]).toBe("read only isolation level repeatable read");
    expect(result.reconciled).toEqual(receipt.preservation?.reconciled);
    expect(result.restoredSubjectsPresent).toBe(1);
    expect(JSON.stringify(receipt)).toBe(original);
    expect(h.ledger.assertUnchanged).toHaveBeenCalledOnce();
    expect(h.queries.every((q) => /^(?:SET LOCAL|SELECT|WITH)/u.test(q))).toBe(true);
    expect(h.queries.join("\n")).not.toMatch(/FOR UPDATE|delete_candidate_data/u);
    expect(JSON.stringify(result)).not.toContain(h.snapshot.entries[0]?.userId);
  });

  it.each([
    "missing-proof",
    "unknown-key",
    "wrong-inspection",
    "wrong-sums",
    "wrong-version",
    "invalid-date",
  ])("refuses historical or malformed receipt %s before I/O", async (fault) => {
    const h = setup();
    const receipt = await h.receipt();
    const bad = { ...receipt } as Record<string, unknown>;
    if (fault === "missing-proof") delete bad.preservation;
    if (fault === "unknown-key") bad.sql = "forbidden";
    if (fault === "wrong-inspection") bad.inspectionSha256 = "a".repeat(64);
    if (fault === "wrong-sums") bad.restoredUsersReconciled = 0;
    if (fault === "wrong-version") bad.functionVersion = "$LATEST";
    if (fault === "invalid-date") bad.expiresAt = "2026-02-30T00:30:00.000Z";
    await expect(verifyReconciledCandidateDeletionCopy(h.database, h.ledger, bad)).rejects.toThrow(
      error,
    );
    expect(h.ledger.inspectCompletedMarkers).not.toHaveBeenCalled();
    expect(h.begin).not.toHaveBeenCalled();
  });

  it("rejects an advanced horizon before opening SQL even with unchanged marker counts", async () => {
    const h = setup();
    const receipt = await h.receipt();
    h.snapshot.sha256 = "a".repeat(64);
    await expect(
      verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt),
    ).rejects.toThrow(error);
    expect(h.begin).not.toHaveBeenCalled();
  });

  it.each([
    "postconditions",
    "restricted-root",
    "same-count-data-change",
    "post-read-marker-change",
    "transaction-ack-failure",
  ])("emits no proof on %s", async (fault) => {
    const h = setup();
    const receipt = await h.receipt();
    if (fault === "postconditions") h.state.valid = false;
    if (fault === "restricted-root") h.state.ownerCounts.profile = 1;
    if (fault === "same-count-data-change") h.state.changedData = true;
    if (fault === "post-read-marker-change")
      h.ledger.assertUnchanged.mockRejectedValueOnce(new Error("raw-private-cloud-error"));
    if (fault === "transaction-ack-failure")
      h.begin.mockImplementationOnce(async (_options, action) => {
        await action({ unsafe: h.unsafe });
        throw new Error("raw-private-sql-error");
      });
    await expect(
      verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt),
    ).rejects.toThrow(error);
  });

  it("returns absence only after zero-owner and terminal absence checks", async () => {
    const h = setup();
    const receipt = await h.receipt();
    h.state.absent = true;
    Object.assign(receipt, {
      restoredSubjectsPresent: 0,
      restoredSubjectsAbsent: 1,
      restoredUsersReconciled: 0,
      restoredUsersAbsent: 1,
    });
    expect(
      await verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt),
    ).toMatchObject({ restoredSubjectsPresent: 0, restoredSubjectsAbsent: 1 });
  });

  it("aborts before cloud/SQL and cancels a hanging SQL query without raw failure output", async () => {
    const h = setup();
    const receipt = await h.receipt();
    await expect(
      verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt, AbortSignal.abort()),
    ).rejects.toThrow(error);
    expect(h.ledger.inspectCompletedMarkers).not.toHaveBeenCalled();
    const controller = new AbortController();
    h.unsafe.mockImplementationOnce(() =>
      Object.assign(new Promise<never>(() => undefined), { cancel: h.cancel }),
    );
    const result = verifyReconciledCandidateDeletionCopy(
      h.database,
      h.ledger,
      receipt,
      controller.signal,
    );
    const refused = expect(result).rejects.toThrow(error);
    await vi.waitFor(() => expect(h.unsafe).toHaveBeenCalled());
    controller.abort();
    await refused;
    expect(h.cancel).toHaveBeenCalled();
  });

  it("bounds a stuck connection/transaction and ledger inspection with one overall deadline", async () => {
    vi.useFakeTimers();
    for (const stuck of ["ledger", "transaction"] as const) {
      const h = setup();
      const receipt = await h.receipt();
      if (stuck === "ledger")
        h.ledger.inspectCompletedMarkers.mockImplementationOnce(() => new Promise(() => undefined));
      else h.begin.mockImplementationOnce(() => new Promise(() => undefined));
      const result = verifyReconciledCandidateDeletionCopy(h.database, h.ledger, receipt);
      const refused = expect(result).rejects.toThrow(error);
      await vi.advanceTimersByTimeAsync(90_001);
      await refused;
      expect(h.ledger.assertUnchanged).not.toHaveBeenCalled();
    }
  });

  it("bundles without the replay store, owner mutation ports or write-capable cloud helpers", async () => {
    const bundle = await build({
      entryPoints: [
        fileURLToPath(new URL("./candidate-deletion-reconciled-copy.ts", import.meta.url)),
      ],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      metafile: true,
    });
    if (!bundle.metafile) throw new Error("SyntheticBundleInventoryMissing");
    const inputs = Object.keys(bundle.metafile.inputs).join("\n");
    expect(inputs).not.toMatch(
      /candidate-deletion-restore-store|candidate-deletion-restore-lambda|candidate-rights-recovery-ledger|candidate-rights-activities|candidate-rights-aws|services\//u,
    );
    expect(bundle.outputFiles[0]?.text).not.toMatch(
      /\.delete_candidate_data|EncryptCommand|PutObjectCommand|DeleteObjectCommand|PutObjectTaggingCommand/u,
    );
  });
});

describe("reconciled copy with document continuity", () => {
  const issuedAt = "2026-09-01T00:00:00.000Z";
  const error = "CandidateDeletionReconciledCopyRejected";
  const evidence = () => ({ sha256: "a".repeat(64), versionsObserved: 2 });
  const documents = () => ({ inspectReplayDocumentContinuity: vi.fn(async () => evidence()) });
  afterEach(() => vi.useRealTimers());

  it("brackets read-only SQL with metadata scans and rechecks markers after the final scan", async () => {
    const h = setup(),
      docs = documents(),
      receipt = await h.receipt();
    const result = await verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
      h.database,
      h.ledger,
      docs,
      receipt,
      issuedAt,
    );
    expect(result.documentContinuitySha256).toBe(evidence().sha256);
    expect(Object.isFrozen(result)).toBe(true);
    expect(docs.inspectReplayDocumentContinuity).toHaveBeenCalledTimes(2);
    const scans = docs.inspectReplayDocumentContinuity.mock.invocationCallOrder;
    expect(scans[0]).toBeLessThan(h.begin.mock.invocationCallOrder[0] ?? 0);
    expect(scans[1]).toBeGreaterThan(h.begin.mock.invocationCallOrder[0] ?? 0);
    expect(h.ledger.inspectCompletedMarkers.mock.invocationCallOrder[1]).toBeGreaterThan(
      scans[1] ?? 0,
    );
    expect(h.ledger.assertUnchanged).toHaveBeenCalledTimes(2);
    expect(h.begin).toHaveBeenCalledWith(
      "read only isolation level repeatable read",
      expect.any(Function),
    );
    expect(h.queries.join("\n")).not.toMatch(/DELETE|UPDATE|INSERT/u);
  });

  it.each(["hash", "count", "new-object", "marker-during-final-scan", "marker-after-final-scan"])(
    "refuses %s without aggregate success",
    async (fault) => {
      const h = setup(),
        docs = documents(),
        receipt = await h.receipt();
      docs.inspectReplayDocumentContinuity
        .mockImplementationOnce(async () => evidence())
        .mockImplementationOnce(async () => {
          if (fault === "new-object") throw new Error("raw-private-object-key");
          if (fault === "marker-during-final-scan")
            h.ledger.inspectCompletedMarkers.mockResolvedValueOnce({
              ...h.snapshot,
              sha256: "b".repeat(64),
            });
          if (fault === "marker-after-final-scan")
            h.ledger.assertUnchanged.mockRejectedValueOnce(new Error("raw-private-marker"));
          return {
            sha256: (fault === "hash" ? "b" : "a").repeat(64),
            versionsObserved: fault === "count" ? 3 : 2,
          };
        });
      await expect(
        verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          h.database,
          h.ledger,
          docs,
          receipt,
          issuedAt,
        ),
      ).rejects.toThrow(error);
    },
  );

  it("detaches caller receipt and continuity output across asynchronous boundaries", async () => {
    const h = setup(),
      docs = documents(),
      receipt = await h.receipt(),
      before = evidence();
    docs.inspectReplayDocumentContinuity
      .mockResolvedValueOnce(before)
      .mockImplementationOnce(async () => {
        before.sha256 = "c".repeat(64);
        return evidence();
      });
    h.ledger.inspectCompletedMarkers.mockImplementationOnce(async () => {
      receipt.markerSnapshotSha256 = "f".repeat(64);
      return h.snapshot;
    });
    expect(
      (
        await verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          h.database,
          h.ledger,
          docs,
          receipt,
          issuedAt,
        )
      ).documentContinuitySha256,
    ).toBe("a".repeat(64));
  });

  it.each(["future", "noncanonical", "after-expiry", "overlong", "bad-receipt"])(
    "refuses %s before object or database access",
    async (fault) => {
      const h = setup(),
        docs = documents(),
        receipt = await h.receipt();
      let cutoff = issuedAt;
      if (fault === "future") cutoff = "2999-01-01T00:00:00.000Z";
      if (fault === "noncanonical") cutoff = "2026-09-01T00:00:00Z";
      if (fault === "after-expiry") cutoff = receipt.expiresAt;
      if (fault === "overlong") cutoff = "2026-08-31T23:59:59.999Z";
      if (fault === "bad-receipt") Object.assign(receipt, { extra: true });
      await expect(
        verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          h.database,
          h.ledger,
          docs,
          receipt,
          cutoff,
        ),
      ).rejects.toThrow(error);
      expect(docs.inspectReplayDocumentContinuity).not.toHaveBeenCalled();
      expect(h.begin).not.toHaveBeenCalled();
    },
  );

  it.each(["negative", "too-many", "extra", "bad-hash"])(
    "refuses malformed continuity evidence %s",
    async (fault) => {
      const h = setup(),
        docs = documents(),
        receipt = await h.receipt();
      const malformed = evidence();
      if (fault === "negative") malformed.versionsObserved = -1;
      if (fault === "too-many") malformed.versionsObserved = 10_001;
      if (fault === "bad-hash") malformed.sha256 = "raw-private-key";
      if (fault === "extra") Object.assign(malformed, { key: "raw-private-key" });
      docs.inspectReplayDocumentContinuity.mockResolvedValueOnce(malformed);
      await expect(
        verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          h.database,
          h.ledger,
          docs,
          receipt,
          issuedAt,
        ),
      ).rejects.toThrow(error);
      expect(h.begin).not.toHaveBeenCalled();
    },
  );

  it("bounds all phases together and checks wall-clock expiry even without timer delivery", async () => {
    for (const stage of ["before", "after", "marker", "late-clock"] as const) {
      vi.useFakeTimers();
      const h = setup(),
        docs = documents(),
        receipt = await h.receipt();
      if (stage === "before")
        docs.inspectReplayDocumentContinuity.mockImplementationOnce(
          () => new Promise(() => undefined),
        );
      if (stage === "after")
        docs.inspectReplayDocumentContinuity
          .mockResolvedValueOnce(evidence())
          .mockImplementationOnce(() => new Promise(() => undefined));
      if (stage === "marker")
        h.ledger.inspectCompletedMarkers
          .mockResolvedValueOnce(h.snapshot)
          .mockImplementationOnce(() => new Promise(() => undefined));
      if (stage === "late-clock")
        docs.inspectReplayDocumentContinuity.mockImplementationOnce(async () => {
          vi.setSystemTime(Date.now() + 90_001);
          return evidence();
        });
      const refused = expect(
        verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          h.database,
          h.ledger,
          docs,
          receipt,
          issuedAt,
        ),
      ).rejects.toThrow(error);
      await vi.advanceTimersByTimeAsync(90_001);
      await refused;
      vi.useRealTimers();
    }
  });

  it("honors cancellation during a stalled final scan and never replays SQL", async () => {
    const h = setup(),
      docs = documents(),
      receipt = await h.receipt(),
      controller = new AbortController();
    docs.inspectReplayDocumentContinuity
      .mockResolvedValueOnce(evidence())
      .mockImplementationOnce(() => new Promise(() => undefined));
    const refused = expect(
      verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
        h.database,
        h.ledger,
        docs,
        receipt,
        issuedAt,
        controller.signal,
      ),
    ).rejects.toThrow(error);
    await vi.waitFor(() => expect(docs.inspectReplayDocumentContinuity).toHaveBeenCalledTimes(2));
    controller.abort();
    await refused;
    expect(h.begin).toHaveBeenCalledTimes(1);
    expect(h.ledger.inspectCompletedMarkers).toHaveBeenCalledTimes(1);
  });
});
