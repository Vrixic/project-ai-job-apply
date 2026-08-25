import type {
  CandidateDeletionConfirmationJournal,
  CandidateDeletionConfirmationJournalEntry,
} from "@ai-job-apply/profile-service";
import { EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface AwsSender {
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK send output is command-specific; every consumed field is validated.
  send(command: unknown): Promise<any>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POLICY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function exactDate(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("CandidateDeletionConfirmationJournalDateRejected");
  }
  return value.toISOString();
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

export class S3CandidateDeletionConfirmationJournal
  implements CandidateDeletionConfirmationJournal
{
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly s3: AwsSender = new S3Client({}),
    private readonly kms: AwsSender = new KMSClient({}),
  ) {
    if (!bucketName || !kmsKeyArn) {
      throw new Error("CandidateDeletionConfirmationJournalConfigurationInvalid");
    }
  }

  async recordConfirmed(
    entry: CandidateDeletionConfirmationJournalEntry,
  ): Promise<CandidateDeletionConfirmationJournalEntry> {
    if (
      !UUID_PATTERN.test(entry.requestId) ||
      !UUID_PATTERN.test(entry.operationId) ||
      !UUID_PATTERN.test(entry.userId) ||
      !POLICY_PATTERN.test(entry.policyVersion) ||
      !SHA256_PATTERN.test(entry.policySha256) ||
      !SHA256_PATTERN.test(entry.subjectDigest) ||
      entry.backupExpiresAt <= entry.confirmedAt
    ) {
      throw new Error("CandidateDeletionConfirmationJournalEntryRejected");
    }
    const key = `candidate-deletion-recovery/${entry.requestId}.json`;
    const metadata = {
      "request-id": entry.requestId,
      "operation-id": entry.operationId,
      "policy-version": entry.policyVersion,
      "policy-sha256": entry.policySha256,
      "subject-digest": entry.subjectDigest,
      "confirmed-at": exactDate(entry.confirmedAt),
      "backup-expires-at": exactDate(entry.backupExpiresAt),
      format: "candidate-deletion-recovery-v1",
    };
    const encrypted = await this.kms.send(
      new EncryptCommand({
        KeyId: this.kmsKeyArn,
        Plaintext: Buffer.from(entry.userId, "utf8"),
        EncryptionContext: {
          purpose: "candidate-deletion-recovery-v1",
          requestId: entry.requestId,
        },
      }),
    );
    if (
      !(encrypted.CiphertextBlob instanceof Uint8Array) ||
      encrypted.CiphertextBlob.length === 0
    ) {
      throw new Error("CandidateDeletionConfirmationJournalEncryptionRejected");
    }
    try {
      const stored = await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: `${JSON.stringify({
            schemaVersion: 1,
            requestId: entry.requestId,
            operationId: entry.operationId,
            policyVersion: entry.policyVersion,
            policySha256: entry.policySha256,
            subjectDigest: entry.subjectDigest,
            confirmedAt: metadata["confirmed-at"],
            backupExpiresAt: metadata["backup-expires-at"],
            encryptedUserLocator: Buffer.from(encrypted.CiphertextBlob).toString("base64"),
          })}\n`,
          ContentType: "application/json",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.kmsKeyArn,
          ChecksumAlgorithm: "SHA256",
          IfNoneMatch: "*",
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: entry.backupExpiresAt,
          Metadata: metadata,
        }),
      );
      if (typeof stored.VersionId !== "string" || stored.VersionId.length === 0) {
        throw new Error("CandidateDeletionConfirmationJournalVersionMissing");
      }
      return entry;
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      const storedOperationId = existing.Metadata?.["operation-id"];
      const storedConfirmedAt = existing.Metadata?.["confirmed-at"];
      const storedBackupExpiresAt = existing.Metadata?.["backup-expires-at"];
      if (
        typeof existing.VersionId !== "string" ||
        existing.ServerSideEncryption !== "aws:kms" ||
        existing.SSEKMSKeyId !== this.kmsKeyArn ||
        existing.Metadata?.["request-id"] !== entry.requestId ||
        existing.Metadata?.["policy-version"] !== entry.policyVersion ||
        existing.Metadata?.["policy-sha256"] !== entry.policySha256 ||
        existing.Metadata?.["subject-digest"] !== entry.subjectDigest ||
        typeof storedOperationId !== "string" ||
        !UUID_PATTERN.test(storedOperationId) ||
        typeof storedConfirmedAt !== "string" ||
        typeof storedBackupExpiresAt !== "string"
      ) {
        throw new Error("CandidateDeletionConfirmationJournalConflict");
      }
      const confirmedAt = new Date(storedConfirmedAt);
      const backupExpiresAt = new Date(storedBackupExpiresAt);
      exactDate(confirmedAt);
      exactDate(backupExpiresAt);
      if (backupExpiresAt <= confirmedAt) {
        throw new Error("CandidateDeletionConfirmationJournalConflict");
      }
      return {
        ...entry,
        operationId: storedOperationId,
        confirmedAt,
        backupExpiresAt,
      };
    }
  }
}
