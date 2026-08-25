import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

export interface CandidateDeletionRecoveryReplayLedger {
  listForRestore(): Promise<CandidateDeletionRecoveryEntry[]>;
}

export interface CandidateDeletionRecoveryReplayStore {
  replayDeletionRecovery(entry: CandidateDeletionRecoveryEntry): Promise<"absent" | "reconciled">;
}

export interface CandidateDeletionRecoveryReplayResult {
  schemaVersion: 1;
  markersValidated: number;
  restoredUsersAbsent: number;
  restoredUsersReconciled: number;
}

export async function replayCandidateDeletionRecovery(
  ledger: CandidateDeletionRecoveryReplayLedger,
  store: CandidateDeletionRecoveryReplayStore,
  now = new Date(),
): Promise<CandidateDeletionRecoveryReplayResult> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("CandidateDeletionRecoveryReplayClockRejected");
  }
  const entries = await ledger.listForRestore();
  entries.sort((left, right) => left.requestId.localeCompare(right.requestId));
  let restoredUsersAbsent = 0;
  let restoredUsersReconciled = 0;
  for (const entry of entries) {
    if (
      !entry.completedAt ||
      entry.completedAt > now ||
      entry.backupExpiresAt <= entry.confirmedAt
    ) {
      throw new Error("CandidateDeletionRecoveryReplayMarkerRejected");
    }
    const outcome = await store.replayDeletionRecovery(entry);
    if (outcome === "absent") restoredUsersAbsent += 1;
    else restoredUsersReconciled += 1;
  }
  return {
    schemaVersion: 1,
    markersValidated: entries.length,
    restoredUsersAbsent,
    restoredUsersReconciled,
  };
}
