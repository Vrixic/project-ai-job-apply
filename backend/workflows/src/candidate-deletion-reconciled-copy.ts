import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import type {
  AwsReadOnlyCandidateDeletionRestoreLedger,
  AwsReadOnlyCandidateRestoreDocuments,
} from "./candidate-deletion-restore-aws.js";
import {
  type CandidateDeletionRestoreReplayResult,
  RESTORE_MAXIMUM_LIFETIME_MS,
  restoreInspectionSha256,
  validateRestoreReplayResult,
} from "./candidate-deletion-restore-contract.js";
import { inspectReconciledCandidateDeletionRows } from "./candidate-deletion-restore-postconditions.js";
import {
  digestRestoredData,
  type RestoreDataDigest,
} from "./candidate-deletion-restore-preservation.js";

type Ledger = Pick<
  AwsReadOnlyCandidateDeletionRestoreLedger,
  "inspectCompletedMarkers" | "assertUnchanged"
>;

export interface ReconciledCopyVerification {
  readonly markerSnapshotSha256: string;
  readonly markersValidated: number;
  readonly restoredSubjectsPresent: number;
  readonly restoredSubjectsAbsent: number;
  readonly reconciled: RestoreDataDigest;
}

type DocumentContinuityReader = Pick<
  AwsReadOnlyCandidateRestoreDocuments,
  "inspectReplayDocumentContinuity"
>;

function rejected(): never {
  // No raw SQL/SDK failure or candidate identifier escapes this read-only boundary.
  throw new Error("CandidateDeletionReconciledCopyRejected");
}

/**
 * Read-only composition for a later verification of a reconciled copy. Original
 * issuance is historical evidence, never a fresh admission or replay deadline.
 * The operator still owns numeric replay provenance, issuance/receipt binding,
 * physical target identity and writer quiescence. No provider/local-copy claim.
 */
export async function verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
  database: DatabaseHandle,
  ledger: Ledger,
  documents: DocumentContinuityReader,
  originalReceipt: unknown,
  originalIssuedAt: string,
  externalSignal?: AbortSignal,
): Promise<ReconciledCopyVerification & { readonly documentContinuitySha256: string }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const deadline = Date.now() + 90_000;
  const timer = setTimeout(onAbort, 90_000);
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  if (externalSignal?.aborted) onAbort();
  const signal = controller.signal;
  let abortWait: (() => void) | undefined;
  const active = () => {
    if (signal.aborted || Date.now() >= deadline) rejected();
  };
  try {
    active();
    const encodedReceipt = JSON.stringify(originalReceipt);
    if (typeof encodedReceipt !== "string" || Buffer.byteLength(encodedReceipt, "utf8") > 16_384)
      rejected();
    const receipt = JSON.parse(encodedReceipt) as CandidateDeletionRestoreReplayResult;
    const issued = Date.parse(originalIssuedAt);
    if (
      !validateRestoreReplayResult(receipt) ||
      !receipt.preservation ||
      !Number.isFinite(issued) ||
      issued <= 0 ||
      new Date(issued).toISOString() !== originalIssuedAt ||
      issued > Date.now() ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      new Date(receipt.expiresAt).toISOString() !== receipt.expiresAt ||
      Date.parse(receipt.expiresAt) <= issued ||
      Date.parse(receipt.expiresAt) - issued > RESTORE_MAXIMUM_LIFETIME_MS
    )
      rejected();
    async function continuity() {
      const result = await documents.inspectReplayDocumentContinuity(originalIssuedAt, signal);
      active();
      if (
        !result ||
        Object.keys(result).sort().join(",") !== "sha256,versionsObserved" ||
        !/^[a-f0-9]{64}$/u.test(result.sha256) ||
        !Number.isSafeInteger(result.versionsObserved) ||
        result.versionsObserved < 0 ||
        result.versionsObserved > 10_000
      )
        rejected();
      return { sha256: result.sha256, versionsObserved: result.versionsObserved };
    }
    async function verify() {
      const before = await continuity();
      const verified = await verifyReconciledCandidateDeletionCopy(
        database,
        ledger,
        receipt,
        signal,
      );
      active();
      const after = await continuity();
      if (before.sha256 !== after.sha256 || before.versionsObserved !== after.versionsObserved)
        rejected();
      active();
      // A completed deletion can advance the marker horizon during the final
      // document listing. Never return the primitive's earlier horizon as fresh.
      const snapshot = await ledger.inspectCompletedMarkers(new Date(), signal);
      active();
      if (
        snapshot.sha256 !== receipt.markerSnapshotSha256 ||
        snapshot.entries.length !== receipt.markersValidated ||
        snapshot.historicalPolicyMarkers !== receipt.historicalPolicyMarkers ||
        snapshot.currentPolicyMarkers !== receipt.currentPolicyMarkers
      )
        rejected();
      await ledger.assertUnchanged(snapshot, new Date(), signal);
      active();
      return Object.freeze({ ...verified, documentContinuitySha256: before.sha256 });
    }
    return await Promise.race([
      verify(),
      new Promise<never>((_, reject) => {
        abortWait = () => reject(new Error("CandidateDeletionReconciledCopyRejected"));
        signal.addEventListener("abort", abortWait, { once: true });
        if (signal.aborted) abortWait();
      }),
    ]);
  } catch {
    return rejected();
  } finally {
    clearTimeout(timer);
    if (abortWait) signal.removeEventListener("abort", abortWait);
    externalSignal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

/**
 * Internal read-only primitive, not promotion/admission authority. The calling operator must
 * establish immutable numeric replay provenance, exact database identity and writer quiescence.
 * An expired original receipt remains historical evidence; this never invokes or renews replay.
 */
export async function verifyReconciledCandidateDeletionCopy(
  database: DatabaseHandle,
  ledger: Ledger,
  originalReceipt: unknown,
  externalSignal?: AbortSignal,
): Promise<ReconciledCopyVerification> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const deadline = Date.now() + 90_000;
  const timer = setTimeout(onAbort, 90_000);
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  if (externalSignal?.aborted) onAbort();
  const signal = controller.signal;
  const active = () => {
    if (signal.aborted || Date.now() >= deadline) rejected();
  };
  let abortWait: (() => void) | undefined;
  try {
    active();
    // Detach caller-owned metadata before any await; dates and strict schema are checked here.
    const encodedReceipt = JSON.stringify(originalReceipt);
    if (typeof encodedReceipt !== "string" || Buffer.byteLength(encodedReceipt, "utf8") > 16_384)
      rejected();
    const receipt = JSON.parse(encodedReceipt) as CandidateDeletionRestoreReplayResult;
    if (
      !validateRestoreReplayResult(receipt) ||
      !receipt.preservation ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      new Date(receipt.expiresAt).toISOString() !== receipt.expiresAt ||
      receipt.inspectionSha256 !==
        restoreInspectionSha256(
          receipt.configurationSha256,
          receipt.markerSnapshotSha256,
          receipt.restoredPreflightSha256,
        ) ||
      receipt.markersValidated !== receipt.historicalPolicyMarkers + receipt.currentPolicyMarkers ||
      receipt.markersValidated !==
        receipt.restoredSubjectsPresent + receipt.restoredSubjectsAbsent ||
      receipt.restoredSubjectsPresent !==
        receipt.restoredUsersReconciled + receipt.restoredUsersAlreadyReconciled ||
      receipt.restoredSubjectsAbsent !== receipt.restoredUsersAbsent ||
      receipt.preservation.unchanged.rowCount > receipt.preservation.reconciled.rowCount ||
      receipt.preservation.unchanged.byteCount > receipt.preservation.reconciled.byteCount
    )
      rejected();
    const expected = receipt.preservation.reconciled;
    async function verify() {
      const snapshot = await ledger.inspectCompletedMarkers(new Date(), signal);
      active();
      if (
        snapshot.sha256 !== receipt.markerSnapshotSha256 ||
        snapshot.entries.length !== receipt.markersValidated ||
        snapshot.historicalPolicyMarkers !== receipt.historicalPolicyMarkers ||
        snapshot.currentPolicyMarkers !== receipt.currentPolicyMarkers
      )
        rejected();
      const verified = await database.client.begin(
        "read only isolation level repeatable read",
        async (sql) => {
          active();
          const postconditions = await inspectReconciledCandidateDeletionRows(
            sql,
            snapshot.entries,
            deadline,
            signal,
          );
          const reconciled = await digestRestoredData(
            sql,
            [],
            { deadline, rowCount: 0, byteCount: 0 },
            signal,
          );
          if (
            reconciled.sha256 !== expected.sha256 ||
            reconciled.relationCount !== expected.relationCount ||
            reconciled.rowCount !== expected.rowCount ||
            reconciled.byteCount !== expected.byteCount ||
            postconditions.restoredSubjectsPresent !== receipt.restoredSubjectsPresent ||
            postconditions.restoredSubjectsAbsent !== receipt.restoredSubjectsAbsent
          )
            rejected();
          active();
          return { ...postconditions, reconciled };
        },
      );
      active();
      await ledger.assertUnchanged(snapshot, new Date(), signal);
      active();
      return Object.freeze({
        markerSnapshotSha256: snapshot.sha256,
        markersValidated: snapshot.entries.length,
        ...verified,
        reconciled: Object.freeze(verified.reconciled),
      });
    }
    return await Promise.race([
      verify(),
      new Promise<never>((_, reject) => {
        abortWait = () => reject(new Error("CandidateDeletionReconciledCopyRejected"));
        signal.addEventListener("abort", abortWait, { once: true });
        if (signal.aborted) abortWait();
      }),
    ]);
  } catch {
    return rejected();
  } finally {
    clearTimeout(timer);
    if (abortWait) signal.removeEventListener("abort", abortWait);
    externalSignal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
