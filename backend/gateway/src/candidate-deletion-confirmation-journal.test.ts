import { describe, expect, it, vi } from "vitest";
import { S3CandidateDeletionConfirmationJournal } from "./candidate-deletion-confirmation-journal.js";

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

describe("candidate deletion confirmation journal", () => {
  it("persists the encrypted marker before returning the canonical confirmation", async () => {
    const s3 = { send: vi.fn(async (_command: unknown) => ({ VersionId: "exact-version" })) };
    const kms = {
      send: vi.fn(async (_command: unknown) => ({ CiphertextBlob: new Uint8Array([1, 2, 3]) })),
    };
    const journal = new S3CandidateDeletionConfirmationJournal(
      "synthetic-recovery-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      s3,
      kms,
    );
    await expect(journal.recordConfirmed(entry)).resolves.toEqual(entry);
    const command = s3.send.mock.calls[0]?.[0];
    if (!command || typeof command !== "object" || !("input" in command)) {
      throw new Error("Expected S3 command");
    }
    const input = (command as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({
      IfNoneMatch: "*",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: entry.backupExpiresAt,
      Metadata: {
        "request-id": entry.requestId,
        "operation-id": entry.operationId,
        "subject-digest": entry.subjectDigest,
      },
    });
    expect(String(input.Body)).not.toContain(entry.userId);
  });
});
