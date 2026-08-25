import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";

interface AwsSender {
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK send output is command-specific; callers validate every consumed field.
  send(command: unknown): Promise<any>;
}

export interface CandidateDeletionRecoveryEntry {
  requestId: string;
  operationId: string;
  userId: string;
  policyVersion: string;
  policySha256: string;
  subjectDigest: string;
  confirmedAt: Date;
  backupExpiresAt: Date;
  completedAt?: Date;
}

export interface CandidateDeletionRecoveryLedger {
  recordConfirmed(entry: CandidateDeletionRecoveryEntry): Promise<CandidateDeletionRecoveryEntry>;
  markCompleted(requestId: string, completedAt: Date): Promise<void>;
}

interface StoredRecoveryEntryV1 {
  schemaVersion: 1;
  requestId: string;
  operationId: string;
  policyVersion: string;
  policySha256: string;
  subjectDigest: string;
  confirmedAt: string;
  backupExpiresAt: string;
  encryptedUserLocator: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POLICY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function keyFor(requestId: string): string {
  if (!UUID_PATTERN.test(requestId)) throw new Error("CandidateDeletionRecoveryRequestRejected");
  return `candidate-deletion-recovery/${requestId}.json`;
}

function exactDate(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("CandidateDeletionRecoveryDateRejected");
  }
  return value.toISOString();
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

function exactMetadata(entry: CandidateDeletionRecoveryEntry): Record<string, string> {
  return {
    "request-id": entry.requestId,
    "operation-id": entry.operationId,
    "policy-version": entry.policyVersion,
    "policy-sha256": entry.policySha256,
    "subject-digest": entry.subjectDigest,
    "confirmed-at": exactDate(entry.confirmedAt),
    "backup-expires-at": exactDate(entry.backupExpiresAt),
    format: "candidate-deletion-recovery-v1",
  };
}

export class AwsCandidateDeletionRecoveryLedger implements CandidateDeletionRecoveryLedger {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly s3: AwsSender = new S3Client({}),
    private readonly kms: AwsSender = new KMSClient({}),
  ) {
    if (!bucketName || !kmsKeyArn) {
      throw new Error("CandidateDeletionRecoveryConfigurationInvalid");
    }
  }

  private encryptionContext(requestId: string): Record<string, string> {
    return { purpose: "candidate-deletion-recovery-v1", requestId };
  }

  async recordConfirmed(
    entry: CandidateDeletionRecoveryEntry,
  ): Promise<CandidateDeletionRecoveryEntry> {
    if (
      !UUID_PATTERN.test(entry.operationId) ||
      !UUID_PATTERN.test(entry.userId) ||
      !POLICY_PATTERN.test(entry.policyVersion) ||
      !SHA256_PATTERN.test(entry.policySha256) ||
      !SHA256_PATTERN.test(entry.subjectDigest)
    ) {
      throw new Error("CandidateDeletionRecoveryEntryRejected");
    }
    const key = keyFor(entry.requestId);
    const metadata = exactMetadata(entry);
    const encrypted = await this.kms.send(
      new EncryptCommand({
        KeyId: this.kmsKeyArn,
        Plaintext: Buffer.from(entry.userId, "utf8"),
        EncryptionContext: this.encryptionContext(entry.requestId),
      }),
    );
    if (
      !(encrypted.CiphertextBlob instanceof Uint8Array) ||
      encrypted.CiphertextBlob.length === 0
    ) {
      throw new Error("CandidateDeletionRecoveryEncryptionRejected");
    }
    const body: StoredRecoveryEntryV1 = {
      schemaVersion: 1,
      requestId: entry.requestId,
      operationId: entry.operationId,
      policyVersion: entry.policyVersion,
      policySha256: entry.policySha256,
      subjectDigest: entry.subjectDigest,
      confirmedAt: metadata["confirmed-at"] ?? "",
      backupExpiresAt: metadata["backup-expires-at"] ?? "",
      encryptedUserLocator: Buffer.from(encrypted.CiphertextBlob).toString("base64"),
    };
    try {
      const result = await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: `${JSON.stringify(body)}\n`,
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
      if (typeof result.VersionId !== "string" || result.VersionId.length === 0) {
        throw new Error("CandidateDeletionRecoveryVersionMissing");
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
        throw new Error("CandidateDeletionRecoveryConflict");
      }
      const confirmedAt = new Date(storedConfirmedAt);
      const backupExpiresAt = new Date(storedBackupExpiresAt);
      exactDate(confirmedAt);
      exactDate(backupExpiresAt);
      if (backupExpiresAt <= confirmedAt) {
        throw new Error("CandidateDeletionRecoveryConflict");
      }
      return {
        ...entry,
        operationId: storedOperationId,
        confirmedAt,
        backupExpiresAt,
      };
    }
  }

  async markCompleted(requestId: string, completedAt: Date): Promise<void> {
    const key = keyFor(requestId);
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    if (
      typeof head.VersionId !== "string" ||
      head.Metadata?.["request-id"] !== requestId ||
      head.Metadata?.format !== "candidate-deletion-recovery-v1"
    ) {
      throw new Error("CandidateDeletionRecoveryEntryMissing");
    }
    await this.s3.send(
      new PutObjectTaggingCommand({
        Bucket: this.bucketName,
        Key: key,
        VersionId: head.VersionId,
        Tagging: {
          TagSet: [
            { Key: "state", Value: "completed" },
            { Key: "completed-at", Value: exactDate(completedAt) },
          ],
        },
      }),
    );
  }

  async listForRestore(): Promise<CandidateDeletionRecoveryEntry[]> {
    const entries: CandidateDeletionRecoveryEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: "candidate-deletion-recovery/",
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const object of Array.isArray(page.Contents) ? page.Contents : []) {
        if (typeof object.Key !== "string") throw new Error("CandidateDeletionRecoveryKeyRejected");
        const response = await this.s3.send(
          new GetObjectCommand({ Bucket: this.bucketName, Key: object.Key }),
        );
        if (typeof response.VersionId !== "string") {
          throw new Error("CandidateDeletionRecoveryVersionMissing");
        }
        const tags = await this.s3.send(
          new GetObjectTaggingCommand({
            Bucket: this.bucketName,
            Key: object.Key,
            VersionId: response.VersionId,
          }),
        );
        const tagMap = Object.fromEntries(
          (Array.isArray(tags.TagSet) ? tags.TagSet : [])
            .filter(
              (tag: unknown): tag is { Key: string; Value: string } =>
                !!tag &&
                typeof tag === "object" &&
                typeof (tag as { Key?: unknown }).Key === "string" &&
                typeof (tag as { Value?: unknown }).Value === "string",
            )
            .map((tag: { Key: string; Value: string }) => [tag.Key, tag.Value]),
        );
        if (tagMap.state !== "completed" || !tagMap["completed-at"]) {
          throw new Error("CandidateDeletionRecoveryNotCompleted");
        }
        const raw = await response.Body?.transformToString("utf8");
        if (typeof raw !== "string" || raw.length > 16_384) {
          throw new Error("CandidateDeletionRecoveryBodyRejected");
        }
        const value = JSON.parse(raw) as Partial<StoredRecoveryEntryV1>;
        if (
          value.schemaVersion !== 1 ||
          !value.requestId ||
          keyFor(value.requestId) !== object.Key ||
          !value.operationId ||
          !UUID_PATTERN.test(value.operationId) ||
          !value.policyVersion ||
          !POLICY_PATTERN.test(value.policyVersion) ||
          !value.policySha256 ||
          !SHA256_PATTERN.test(value.policySha256) ||
          !value.subjectDigest ||
          !SHA256_PATTERN.test(value.subjectDigest) ||
          !value.confirmedAt ||
          !value.backupExpiresAt ||
          !value.encryptedUserLocator
        ) {
          throw new Error("CandidateDeletionRecoveryBodyRejected");
        }
        const decrypted = await this.kms.send(
          new DecryptCommand({
            KeyId: this.kmsKeyArn,
            CiphertextBlob: Buffer.from(value.encryptedUserLocator, "base64"),
            EncryptionContext: this.encryptionContext(value.requestId),
          }),
        );
        const userId =
          decrypted.Plaintext instanceof Uint8Array
            ? Buffer.from(decrypted.Plaintext).toString("utf8")
            : "";
        if (!UUID_PATTERN.test(userId)) throw new Error("CandidateDeletionRecoveryLocatorRejected");
        entries.push({
          requestId: value.requestId,
          operationId: value.operationId,
          userId,
          policyVersion: value.policyVersion,
          policySha256: value.policySha256,
          subjectDigest: value.subjectDigest,
          confirmedAt: new Date(value.confirmedAt),
          backupExpiresAt: new Date(value.backupExpiresAt),
          completedAt: new Date(tagMap["completed-at"]),
        });
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      if (page.IsTruncated === true && !continuationToken) {
        throw new Error("CandidateDeletionRecoveryPaginationRejected");
      }
    } while (continuationToken);
    return entries;
  }
}
