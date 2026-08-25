import { describe, expect, it, vi } from "vitest";
import { replayCandidateDeletionRecovery } from "./candidate-deletion-recovery-replay.js";

const base = {
  operationId: "019c2b89-79b2-7000-8000-000000000003",
  userId: "019c2b89-79b2-7000-8000-000000000002",
  policyVersion: "synthetic-v1",
  policySha256: "a".repeat(64),
  subjectDigest: "b".repeat(64),
  confirmedAt: new Date("2026-08-25T15:00:00.000Z"),
  backupExpiresAt: new Date("2026-09-01T15:00:00.000Z"),
  completedAt: new Date("2026-08-25T15:05:00.000Z"),
};

describe("candidate deletion recovery replay", () => {
  it("replays every completed marker and returns aggregate-only evidence", async () => {
    const replayDeletionRecovery = vi
      .fn()
      .mockResolvedValueOnce("reconciled")
      .mockResolvedValueOnce("absent");
    const result = await replayCandidateDeletionRecovery(
      {
        listForRestore: async () => [
          { ...base, requestId: "019c2b89-79b2-7000-8000-000000000005" },
          { ...base, requestId: "019c2b89-79b2-7000-8000-000000000004" },
        ],
      },
      { replayDeletionRecovery },
      new Date("2026-08-25T16:00:00.000Z"),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      markersValidated: 2,
      restoredUsersAbsent: 1,
      restoredUsersReconciled: 1,
    });
    expect(replayDeletionRecovery.mock.calls.map(([entry]) => entry.requestId)).toEqual([
      "019c2b89-79b2-7000-8000-000000000004",
      "019c2b89-79b2-7000-8000-000000000005",
    ]);
  });

  it("fails closed before database reconciliation when a marker lacks completion proof", async () => {
    const replayDeletionRecovery = vi.fn();
    const { completedAt: _completedAt, ...incomplete } = base;
    await expect(
      replayCandidateDeletionRecovery(
        {
          listForRestore: async () => [
            {
              ...incomplete,
              requestId: "019c2b89-79b2-7000-8000-000000000004",
            },
          ],
        },
        { replayDeletionRecovery },
      ),
    ).rejects.toThrow("CandidateDeletionRecoveryReplayMarkerRejected");
    expect(replayDeletionRecovery).not.toHaveBeenCalled();
  });
});
