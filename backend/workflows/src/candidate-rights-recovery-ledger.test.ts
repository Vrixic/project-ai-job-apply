import { describe, expect, it, vi } from "vitest";
import { AwsCandidateDeletionRecoveryLedger } from "./candidate-rights-recovery-ledger.js";

const entry = {
  requestId: "019c2b89-79b2-7000-8000-000000000001",
  operationId: "019c2b89-79b2-7000-8000-000000000003",
  userId: "019c2b89-79b2-7000-8000-000000000002",
  policyVersion: "synthetic-v1",
  policySha256: "a".repeat(64),
  subjectDigest: "b".repeat(64),
  confirmedAt: new Date("2026-08-25T15:00:00.000Z"),
  backupExpiresAt: new Date("2026-09-01T15:00:00.000Z"),
};

function commandInput(
  calls: readonly (readonly unknown[])[],
  index: number,
): Record<string, unknown> {
  const command = calls[index]?.[0];
  if (!command || typeof command !== "object" || !("input" in command)) {
    throw new Error("Expected AWS command input");
  }
  return (command as { input: Record<string, unknown> }).input;
}

describe("candidate deletion recovery ledger", () => {
  it("writes an encrypted, retention-bound, idempotent recovery marker", async () => {
    const kms = {
      send: vi.fn(async (_command: unknown) => ({ CiphertextBlob: new Uint8Array([1, 2, 3]) })),
    };
    const s3 = { send: vi.fn(async (_command: unknown) => ({ VersionId: "ledger-version" })) };
    const ledger = new AwsCandidateDeletionRecoveryLedger(
      "synthetic-recovery-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      s3,
      kms,
    );

    await expect(ledger.recordConfirmed(entry)).resolves.toEqual(entry);
    expect(kms.send).toHaveBeenCalledOnce();
    expect(commandInput(kms.send.mock.calls, 0)).toMatchObject({
      Plaintext: Buffer.from(entry.userId, "utf8"),
      EncryptionContext: {
        purpose: "candidate-deletion-recovery-v1",
        requestId: entry.requestId,
      },
    });
    const input = commandInput(s3.send.mock.calls, 0);
    expect(input).toMatchObject({
      Bucket: "synthetic-recovery-bucket",
      Key: `candidate-deletion-recovery/${entry.requestId}.json`,
      IfNoneMatch: "*",
      ServerSideEncryption: "aws:kms",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: entry.backupExpiresAt,
    });
    expect(String(input.Body)).not.toContain(entry.userId);
  });

  it("tags only the exact current recovery-marker version as completed", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        VersionId: "ledger-version",
        Metadata: {
          "request-id": entry.requestId,
          format: "candidate-deletion-recovery-v1",
        },
      })
      .mockResolvedValueOnce({});
    const s3 = { send: (command: unknown) => send(command) };
    const ledger = new AwsCandidateDeletionRecoveryLedger(
      "synthetic-recovery-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      s3,
      { send: vi.fn() },
    );
    await ledger.markCompleted(entry.requestId, new Date("2026-08-25T15:05:00.000Z"));
    expect(commandInput(send.mock.calls, 1)).toMatchObject({
      VersionId: "ledger-version",
      Tagging: {
        TagSet: [
          { Key: "state", Value: "completed" },
          { Key: "completed-at", Value: "2026-08-25T15:05:00.000Z" },
        ],
      },
    });
  });
});
