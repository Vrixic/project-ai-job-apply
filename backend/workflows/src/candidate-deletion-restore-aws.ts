import { createHash } from "node:crypto";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  GetObjectTaggingCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { HistoricalCompletionEvidence } from "./candidate-deletion-completion-diagnosis.js";
import { completionMarkerObservationFromAws } from "./candidate-deletion-completion-marker-evidence.js";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
  CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION,
  MAX_RESTORED_DELETION_MARKERS,
  validateHistoricalRecoveryEntries,
} from "./candidate-deletion-restore-policy.js";
import type { RestoredCandidateObjectRef } from "./candidate-deletion-restore-store.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

interface ReadOnlyAwsSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

interface ReadOnlyBucketOptions {
  bucketName: string;
  expectedBucketOwner: string;
  s3?: ReadOnlyAwsSender;
  /** Whole inspection deadline, including pagination and streamed bodies. */
  timeoutMs?: number;
}

export interface CandidateDeletionRestoreLedgerSnapshot {
  readonly entries: readonly CandidateDeletionRecoveryEntry[];
  readonly sha256: string;
  readonly historicalPolicyMarkers: number;
  readonly currentPolicyMarkers: number;
}

const PREFIX = "candidate-deletion-recovery/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 16_384;
const MAX_DOCUMENTS = 10_000;
const PAGE_SIZE = 100;
const MAX_PAGES = MAX_RESTORED_DELETION_MARKERS + 1;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const BODY_KEYS = [
  "schemaVersion",
  "requestId",
  "operationId",
  "policyVersion",
  "policySha256",
  "subjectDigest",
  "confirmedAt",
  "backupExpiresAt",
  "encryptedUserLocator",
];

function rejected(): never {
  // Never include provider errors, keys, body fields, or decrypted identifiers.
  throw new Error("CandidateDeletionRestoreCloudInspectionRejected");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) rejected();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) rejected();
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function opaque(value: unknown, max = 1_024): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
  );
}

function date(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value))) rejected();
  return Date.prototype.toISOString.call(value);
}

function snapshotFingerprint(snapshot: CandidateDeletionRestoreLedgerSnapshot): string {
  return hash({
    sha256: snapshot.sha256,
    currentPolicyMarkers: snapshot.currentPolicyMarkers,
    historicalPolicyMarkers: snapshot.historicalPolicyMarkers,
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      confirmedAt: date(entry.confirmedAt),
      backupExpiresAt: date(entry.backupExpiresAt),
      completedAt: date(entry.completedAt),
    })),
  });
}

function storedDate(value: unknown): Date {
  if (typeof value !== "string") rejected();
  const parsed = new Date(value);
  if (date(parsed) !== value) rejected();
  return parsed;
}

/** Both real SDK requests and injected senders/streams share the same finite deadline. */
class Deadline {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onAbort = () => this.controller.abort();
  private readonly expiresAt: number;

  constructor(
    timeoutMs: number,
    private readonly external?: AbortSignal,
  ) {
    this.expiresAt = Date.now() + timeoutMs;
    this.timer = setTimeout(this.onAbort, timeoutMs);
    external?.addEventListener("abort", this.onAbort, { once: true });
    if (external?.aborted) this.onAbort();
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    this.assertActive();
    const signal = this.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("CandidateDeletionRestoreCloudInspectionRejected"));
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(() => {
          this.assertActive();
          return action();
        })
        .then(resolve, abort)
        .finally(() => {
          signal.removeEventListener("abort", abort);
        });
    });
  }

  assertActive(): void {
    if (this.controller.signal.aborted || Date.now() >= this.expiresAt) rejected();
  }

  async send(sender: ReadOnlyAwsSender, command: unknown): Promise<Record<string, unknown>> {
    return record(
      await this.run(() => sender.send(command, { abortSignal: this.controller.signal })),
    );
  }

  close(): void {
    clearTimeout(this.timer);
    this.external?.removeEventListener("abort", this.onAbort);
    this.controller.abort();
  }
}

function validateOptions(options: ReadOnlyBucketOptions): number {
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(options.bucketName) ||
    options.bucketName.includes("..") ||
    /^\d+\.\d+\.\d+\.\d+$/u.test(options.bucketName) ||
    !/^\d{12}$/u.test(options.expectedBucketOwner)
  )
    rejected();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) rejected();
  return timeout;
}

function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) rejected();
  return value;
}

async function* versionPages(
  sender: ReadOnlyAwsSender,
  options: ReadOnlyBucketOptions,
  prefix: string,
  deadline: Deadline,
  maximumPages = MAX_PAGES,
): AsyncGenerator<{ versions: unknown[]; deletions: unknown[] }> {
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < maximumPages; page += 1) {
    const output = await deadline.send(
      sender,
      new ListObjectVersionsCommand({
        Bucket: options.bucketName,
        ExpectedBucketOwner: options.expectedBucketOwner,
        Prefix: prefix,
        MaxKeys: PAGE_SIZE,
        EncodingType: "url",
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionMarker ? { VersionIdMarker: versionMarker } : {}),
      }),
    );
    if (output.EncodingType !== undefined && output.EncodingType !== "url") rejected();
    // The pinned SDK preserves URL-encoded S3 key fields; version IDs are not encoded.
    if (output.EncodingType === "url") {
      for (const field of ["Prefix", "KeyMarker", "NextKeyMarker", "Delimiter"]) {
        if (output[field] !== undefined) {
          if (typeof output[field] !== "string") rejected();
          output[field] = decodeURIComponent(output[field] as string);
        }
      }
      for (const field of ["Versions", "DeleteMarkers"]) {
        for (const value of array(output[field])) {
          const item = record(value);
          if (typeof item.Key !== "string") rejected();
          item.Key = decodeURIComponent(item.Key);
        }
      }
    }
    if (
      output.Name !== options.bucketName ||
      output.Prefix !== prefix ||
      output.MaxKeys !== PAGE_SIZE ||
      typeof output.IsTruncated !== "boolean" ||
      (output.KeyMarker ?? "") !== (keyMarker ?? "") ||
      (output.VersionIdMarker ?? "") !== (versionMarker ?? "") ||
      (output.Delimiter ?? "") !== "" ||
      array(output.CommonPrefixes).length !== 0
    )
      rejected();
    const versions = array(output.Versions);
    const deletions = array(output.DeleteMarkers);
    if (versions.length + deletions.length > PAGE_SIZE) rejected();
    yield { versions, deletions };
    if (!output.IsTruncated) {
      if ((output.NextKeyMarker ?? "") !== "" || (output.NextVersionIdMarker ?? "") !== "")
        rejected();
      return;
    }
    if (
      versions.length + deletions.length === 0 ||
      !opaque(output.NextKeyMarker) ||
      !output.NextKeyMarker.startsWith(prefix) ||
      (output.NextVersionIdMarker !== undefined && !opaque(output.NextVersionIdMarker))
    )
      rejected();
    keyMarker = output.NextKeyMarker;
    versionMarker = output.NextVersionIdMarker as string | undefined;
    const cursor = JSON.stringify([keyMarker, versionMarker ?? null]);
    if (cursors.has(cursor)) rejected();
    cursors.add(cursor);
  }
  rejected();
}

interface Version {
  key: string;
  versionId: string;
  etag: string;
  size: number;
  lastModified: string;
  owner: string | null;
  checksumAlgorithm: unknown;
  checksumType: unknown;
  latest: boolean;
  retirement: { versionId: string; lastModified: string; owner: string | null } | null;
}

async function listMarkers(
  sender: ReadOnlyAwsSender,
  options: ReadOnlyBucketOptions,
  deadline: Deadline,
): Promise<Version[]> {
  const result: Version[] = [];
  const keys = new Set<string>();
  const retirements = new Map<string, NonNullable<Version["retirement"]>>();
  for await (const page of versionPages(sender, options, PREFIX, deadline)) {
    for (const raw of page.deletions) {
      const item = record(raw);
      if (
        typeof item.Key !== "string" ||
        !item.Key.startsWith(PREFIX) ||
        !item.Key.endsWith(".json") ||
        !UUID.test(item.Key.slice(PREFIX.length, -5)) ||
        !opaque(item.VersionId) ||
        item.VersionId === "null" ||
        item.IsLatest !== true ||
        retirements.has(item.Key)
      )
        rejected();
      const owner = item.Owner === undefined ? null : record(item.Owner).ID;
      if (owner !== null && (typeof owner !== "string" || !/^[a-f0-9]{64}$/u.test(owner)))
        rejected();
      retirements.set(item.Key, {
        versionId: item.VersionId,
        lastModified: date(item.LastModified),
        owner: owner as string | null,
      });
      if (retirements.size > MAX_RESTORED_DELETION_MARKERS) rejected();
    }
    for (const raw of page.versions) {
      const item = record(raw);
      if (
        typeof item.Key !== "string" ||
        !item.Key.startsWith(PREFIX) ||
        !item.Key.endsWith(".json") ||
        !UUID.test(item.Key.slice(PREFIX.length, -5)) ||
        !opaque(item.VersionId) ||
        item.VersionId === "null" ||
        typeof item.IsLatest !== "boolean" ||
        !opaque(item.ETag, 256) ||
        !/^"[^"\r\n]+"$/u.test(item.ETag) ||
        typeof item.Size !== "number" ||
        !Number.isSafeInteger(item.Size) ||
        item.Size < 1 ||
        item.Size > MAX_BODY_BYTES ||
        item.StorageClass !== "STANDARD" ||
        (item.ChecksumAlgorithm !== undefined &&
          JSON.stringify(item.ChecksumAlgorithm) !== '["SHA256"]') ||
        (item.ChecksumType !== undefined && item.ChecksumType !== "FULL_OBJECT") ||
        item.RestoreStatus !== undefined ||
        keys.has(item.Key)
      )
        rejected();
      let owner: string | null = null;
      if (item.Owner !== undefined) {
        const candidate = record(item.Owner).ID;
        if (typeof candidate !== "string" || !/^[a-f0-9]{64}$/u.test(candidate)) rejected();
        owner = candidate;
      }
      keys.add(item.Key);
      result.push({
        key: item.Key,
        versionId: item.VersionId,
        etag: item.ETag,
        size: item.Size,
        lastModified: date(item.LastModified),
        owner,
        checksumAlgorithm: item.ChecksumAlgorithm ?? null,
        checksumType: item.ChecksumType ?? null,
        latest: item.IsLatest,
        retirement: null,
      });
      if (result.length > MAX_RESTORED_DELETION_MARKERS) rejected();
    }
  }
  for (const version of result) {
    const retirement = retirements.get(version.key);
    if (version.latest ? retirement !== undefined : retirement === undefined) rejected();
    if (retirement) {
      if (
        retirement.versionId === version.versionId ||
        retirement.lastModified < version.lastModified ||
        retirement.owner !== version.owner
      )
        rejected();
      version.retirement = retirement;
      retirements.delete(version.key);
    }
  }
  if (retirements.size !== 0) rejected();
  return result.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

async function readBody(
  value: unknown,
  expectedBytes: number,
  deadline: Deadline,
): Promise<Buffer> {
  if (
    !value ||
    typeof value !== "object" ||
    !(Symbol.asyncIterator in value) ||
    typeof value[Symbol.asyncIterator] !== "function"
  )
    rejected();
  const stream = value as AsyncIterable<unknown> & { destroy?: () => void };
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    // A hostile iterator cannot keep yielding empty chunks indefinitely.
    for (let count = 0; count <= MAX_BODY_BYTES; count += 1) {
      const next = await deadline.run(() => iterator.next());
      if (next.done) {
        if (bytes !== expectedBytes) rejected();
        return Buffer.concat(chunks, bytes);
      }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0) rejected();
      bytes += next.value.byteLength;
      if (bytes > expectedBytes || bytes > MAX_BODY_BYTES) rejected();
      chunks.push(Buffer.from(next.value));
    }
    return rejected();
  } finally {
    stream.destroy?.();
  }
}

function exactMetadata(body: Record<string, unknown>): Record<string, unknown> {
  return {
    "request-id": body.requestId,
    "operation-id": body.operationId,
    "policy-version": body.policyVersion,
    "policy-sha256": body.policySha256,
    "subject-digest": body.subjectDigest,
    "confirmed-at": body.confirmedAt,
    "backup-expires-at": body.backupExpiresAt,
    format: "candidate-deletion-recovery-v1",
  };
}

/** Restore-only reader. No live ledger methods, writes, or unversioned object reads. */
export class AwsReadOnlyCandidateDeletionRestoreLedger {
  private readonly s3: ReadOnlyAwsSender;
  private readonly kms: ReadOnlyAwsSender;
  private readonly timeoutMs: number;
  private readonly snapshots = new WeakMap<CandidateDeletionRestoreLedgerSnapshot, string>();
  private readonly options: ReadOnlyBucketOptions & { kmsKeyArn: string };

  constructor(options: ReadOnlyBucketOptions & { kmsKeyArn: string; kms?: ReadOnlyAwsSender }) {
    this.timeoutMs = validateOptions(options);
    if (
      !new RegExp(
        `^arn:aws:kms:[a-z0-9-]+:${options.expectedBucketOwner}:key/[a-f0-9-]{36}$`,
        "u",
      ).test(options.kmsKeyArn) ||
      !UUID.test(options.kmsKeyArn.split("/")[1] ?? "")
    )
      rejected();
    this.options = Object.freeze({ ...options });
    this.s3 = options.s3 ?? new S3Client({});
    this.kms = options.kms ?? new KMSClient({});
  }

  async inspectCompletedMarkers(
    now: Date,
    signal?: AbortSignal,
  ): Promise<CandidateDeletionRestoreLedgerSnapshot> {
    const snapshot = await this.inspect(now, signal);
    this.snapshots.set(snapshot, snapshotFingerprint(snapshot));
    return snapshot;
  }

  async assertUnchanged(
    snapshot: CandidateDeletionRestoreLedgerSnapshot,
    now: Date,
    signal?: AbortSignal,
  ): Promise<void> {
    const original = this.snapshots.get(snapshot);
    if (!original || snapshotFingerprint(snapshot) !== original) rejected();
    const current = await this.inspect(now, signal);
    if (snapshotFingerprint(current) !== original) rejected();
  }

  /** Private singleton accessor. A forged or mutated public snapshot never chooses a key. */
  async inspectCompletionEvidence(
    snapshot: CandidateDeletionRestoreLedgerSnapshot,
    now: Date,
    signal?: AbortSignal,
  ): Promise<HistoricalCompletionEvidence["marker"]> {
    const original = this.snapshots.get(snapshot);
    if (!original || snapshotFingerprint(snapshot) !== original || snapshot.entries.length !== 1)
      rejected();
    let marker: HistoricalCompletionEvidence["marker"] | undefined;
    const current = await this.inspect(now, signal, (observed) => {
      marker = observed;
    });
    if (!marker || snapshotFingerprint(current) !== original) rejected();
    return marker;
  }

  private async inspect(
    now: Date,
    signal?: AbortSignal,
    completionEvidence?: (marker: HistoricalCompletionEvidence["marker"]) => void,
  ): Promise<CandidateDeletionRestoreLedgerSnapshot> {
    now = new Date(date(now));
    const deadline = new Deadline(this.timeoutMs, signal);
    try {
      const versions = await listMarkers(this.s3, this.options, deadline);
      if (completionEvidence && (versions.length !== 1 || versions[0]?.retirement !== null))
        rejected();
      const entries: CandidateDeletionRecoveryEntry[] = [];
      const records: unknown[] = [];
      let completionMarker: HistoricalCompletionEvidence["marker"] | undefined;
      for (const version of versions) {
        const request = {
          Bucket: this.options.bucketName,
          ExpectedBucketOwner: this.options.expectedBucketOwner,
          Key: version.key,
          VersionId: version.versionId,
        };
        const object = await deadline.send(
          this.s3,
          new GetObjectCommand({ ...request, ChecksumMode: "ENABLED" }),
        );
        if (
          object.VersionId !== version.versionId ||
          (object.DeleteMarker !== undefined && object.DeleteMarker !== false) ||
          object.ContentLength !== version.size ||
          object.ETag !== version.etag ||
          date(object.LastModified) !== version.lastModified ||
          object.ServerSideEncryption !== "aws:kms" ||
          object.SSEKMSKeyId !== this.options.kmsKeyArn ||
          object.BucketKeyEnabled !== true ||
          object.ContentType !== "application/json" ||
          object.ContentEncoding !== undefined ||
          object.ContentRange !== undefined ||
          (object.MissingMeta !== undefined && object.MissingMeta !== 0) ||
          (object.ChecksumType !== undefined && object.ChecksumType !== "FULL_OBJECT") ||
          object.ObjectLockMode !== "COMPLIANCE" ||
          (object.ObjectLockLegalHoldStatus !== undefined &&
            object.ObjectLockLegalHoldStatus !== "OFF")
        )
          rejected();
        const bytes = await readBody(object.Body, version.size, deadline);
        const bodySha256 = createHash("sha256").update(bytes).digest("hex");
        if (createHash("sha256").update(bytes).digest("base64") !== object.ChecksumSHA256)
          rejected();
        const body = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        exactKeys(body, BODY_KEYS);
        if (
          !bytes.equals(Buffer.from(`${JSON.stringify(body)}\n`, "utf8")) ||
          body.schemaVersion !== 1 ||
          body.requestId !== version.key.slice(PREFIX.length, -5) ||
          typeof body.operationId !== "string" ||
          !UUID.test(body.operationId) ||
          typeof body.policyVersion !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(body.policyVersion) ||
          typeof body.policySha256 !== "string" ||
          !SHA256.test(body.policySha256) ||
          typeof body.subjectDigest !== "string" ||
          !SHA256.test(body.subjectDigest) ||
          typeof body.encryptedUserLocator !== "string" ||
          body.encryptedUserLocator.length > 8_192
        )
          rejected();
        const encrypted = Buffer.from(body.encryptedUserLocator, "base64");
        if (encrypted.length === 0 || encrypted.toString("base64") !== body.encryptedUserLocator)
          rejected();
        const metadata = record(object.Metadata);
        const expectedMetadata = exactMetadata(body);
        exactKeys(metadata, Object.keys(expectedMetadata));
        if (Object.keys(expectedMetadata).some((key) => metadata[key] !== expectedMetadata[key]))
          rejected();
        const confirmedAt = storedDate(body.confirmedAt);
        const backupExpiresAt = storedDate(body.backupExpiresAt);
        // A retired marker still supplies deletion authority for restored copies. Never skip it
        // merely because retention elapsed; authenticate its exact retained body and reconcile it.
        if (
          version.retirement &&
          (version.retirement.lastModified < date(backupExpiresAt) ||
            version.retirement.lastModified > date(now))
        )
          rejected();
        if (date(object.ObjectLockRetainUntilDate) !== date(backupExpiresAt)) rejected();
        const retentionResponse = await deadline.send(
          this.s3,
          new GetObjectRetentionCommand(request),
        );
        const retention = record(retentionResponse.Retention);
        exactKeys(retention, ["Mode", "RetainUntilDate"]);
        if (
          retention.Mode !== "COMPLIANCE" ||
          date(retention.RetainUntilDate) !== date(backupExpiresAt)
        )
          rejected();
        const tagged = await deadline.send(this.s3, new GetObjectTaggingCommand(request));
        if (
          tagged.VersionId !== version.versionId ||
          !Array.isArray(tagged.TagSet) ||
          tagged.TagSet.length !== 2
        )
          rejected();
        const tags = new Map<string, string>();
        for (const value of tagged.TagSet) {
          const tag = record(value);
          exactKeys(tag, ["Key", "Value"]);
          if (
            (tag.Key !== "state" && tag.Key !== "completed-at") ||
            typeof tag.Value !== "string" ||
            tags.has(tag.Key)
          )
            rejected();
          tags.set(tag.Key, tag.Value);
        }
        if (tags.get("state") !== "completed") rejected();
        const completedAt = storedDate(tags.get("completed-at"));
        if (version.retirement && version.retirement.lastModified < date(completedAt)) rejected();
        const decrypted = await deadline.send(
          this.kms,
          new DecryptCommand({
            KeyId: this.options.kmsKeyArn,
            CiphertextBlob: encrypted,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            EncryptionContext: {
              purpose: "candidate-deletion-recovery-v1",
              requestId: body.requestId,
            },
          }),
        );
        if (
          decrypted.KeyId !== this.options.kmsKeyArn ||
          decrypted.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT" ||
          !(decrypted.Plaintext instanceof Uint8Array) ||
          decrypted.Plaintext.byteLength !== 36
        )
          rejected();
        const userId = new TextDecoder("utf-8", { fatal: true }).decode(decrypted.Plaintext);
        if (!UUID.test(userId)) rejected();
        entries.push({
          requestId: body.requestId as string,
          operationId: body.operationId,
          userId,
          policyVersion: body.policyVersion,
          policySha256: body.policySha256,
          subjectDigest: body.subjectDigest,
          confirmedAt,
          backupExpiresAt,
          completedAt,
        });
        if (completionEvidence) {
          const { latest: _latest, retirement: _retirement, ...currentVersion } = version;
          const observation = completionMarkerObservationFromAws({
            target: {
              bucketName: this.options.bucketName,
              expectedBucketOwner: this.options.expectedBucketOwner,
              key: version.key,
              versionId: version.versionId,
            },
            expectedKmsKeyArn: this.options.kmsKeyArn,
            object,
            tagging: tagged,
            retention: retentionResponse,
            // listMarkers has already rejected every other checksum representation.
            version: currentVersion,
          });
          if (observation.bodySha256 !== bodySha256) rejected();
          const { tagSet, ...immutable } = observation;
          completionMarker = Object.freeze({
            ...immutable,
            oldTagSet: tagSet,
            entry: Object.freeze({
              requestId: body.requestId as string,
              operationId: body.operationId,
              userId,
              policyVersion: body.policyVersion,
              policySha256: body.policySha256,
              subjectDigest: body.subjectDigest,
              confirmedAt: date(confirmedAt),
              backupExpiresAt: date(backupExpiresAt),
              completedAt: date(completedAt),
            }),
          });
        }
        records.push({
          version,
          bodySha256,
          metadata: expectedMetadata,
          tags: [...tags].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
          retention: { mode: retention.Mode, retainUntil: date(retention.RetainUntilDate) },
          encryption: {
            algorithm: object.ServerSideEncryption,
            key: object.SSEKMSKeyId,
            bucketKeyEnabled: true,
          },
          checksum: object.ChecksumSHA256,
          checksumType: object.ChecksumType ?? null,
          contentType: object.ContentType,
          legalHold: object.ObjectLockLegalHoldStatus ?? null,
        });
      }
      const accepted = validateHistoricalRecoveryEntries(entries, now);
      for (const entry of accepted) {
        Object.freeze(entry.confirmedAt);
        Object.freeze(entry.backupExpiresAt);
        Object.freeze(entry.completedAt);
      }
      // A new version/key while bodies were read invalidates the entire inspection.
      if (hash(await listMarkers(this.s3, this.options, deadline)) !== hash(versions)) rejected();
      const currentPolicyMarkers = accepted.filter(
        (entry) => entry.policyVersion === CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION,
      ).length;
      deadline.assertActive();
      if (completionEvidence) {
        if (!completionMarker) rejected();
        completionEvidence(completionMarker);
      }
      return Object.freeze({
        entries: accepted,
        sha256: hash({
          format: "candidate-deletion-restore-ledger-snapshot-v1",
          bucket: this.options.bucketName,
          owner: this.options.expectedBucketOwner,
          kmsKey: this.options.kmsKeyArn,
          policyCatalogSha256: ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
          records,
        }),
        currentPolicyMarkers,
        historicalPolicyMarkers: accepted.length - currentPolicyMarkers,
      });
    } catch {
      rejected();
    } finally {
      deadline.close();
    }
  }
}

/**
 * Only bucket version listings: no cloud document body is read or deleted.
 * Both document namespaces must be empty, even when a parser output was written
 * before its normalized key could be registered in the restored database.
 * documentKeysChecked counts known reference keys covered by those stronger scans.
 */
export class AwsReadOnlyCandidateRestoreDocuments {
  private readonly options: ReadOnlyBucketOptions;
  private readonly s3: ReadOnlyAwsSender;
  private readonly timeoutMs: number;

  constructor(options: ReadOnlyBucketOptions) {
    this.timeoutMs = validateOptions(options);
    this.options = Object.freeze({ ...options });
    this.s3 = options.s3 ?? new S3Client({});
  }

  /**
   * Conservative continuity evidence after replay has removed SQL document references.
   * This covers every version and delete marker in both owned namespaces, not only
   * currently registered documents. The caller must bind issuance to the original
   * replay configuration and keep writers quiescent throughout verification.
   */
  async inspectReplayDocumentContinuity(
    originalIssuedAt: string,
    signal?: AbortSignal,
  ): Promise<{ readonly sha256: string; readonly versionsObserved: number }> {
    const deadline = new Deadline(this.timeoutMs, signal);
    try {
      deadline.assertActive();
      const cutoff = storedDate(originalIssuedAt).getTime();
      if (cutoff <= 0 || cutoff > Date.now()) rejected();
      const observations: Array<{
        kind: "version" | "deletion";
        key: string;
        versionId: string;
        lastModified: string;
        isLatest: boolean;
      }> = [];
      const identities = new Set<string>();
      for (const prefix of ["quarantine/", "normalized/"]) {
        // At most 10,000 observations overall and 101 pages per namespace.
        // An empty truncated page or repeated cursor is rejected by versionPages.
        for await (const page of versionPages(
          this.s3,
          this.options,
          prefix,
          deadline,
          Math.ceil(MAX_DOCUMENTS / PAGE_SIZE) + 1,
        )) {
          for (const [kind, values] of [
            ["version", page.versions],
            ["deletion", page.deletions],
          ] as const) {
            for (const raw of values) {
              const item = record(raw);
              if (
                !opaque(item.Key) ||
                !item.Key.startsWith(prefix) ||
                !opaque(item.VersionId) ||
                item.VersionId === "null" ||
                typeof item.IsLatest !== "boolean"
              )
                rejected();
              const lastModified = date(item.LastModified);
              // Equality is deliberately rejected: S3 timestamps cannot establish
              // ordering within their precision at the replay issuance boundary.
              if (Date.parse(lastModified) >= cutoff) rejected();
              const identity = JSON.stringify([item.Key, item.VersionId]);
              if (identities.has(identity)) rejected();
              identities.add(identity);
              observations.push({
                kind,
                key: item.Key,
                versionId: item.VersionId,
                lastModified,
                isLatest: item.IsLatest,
              });
              if (observations.length > MAX_DOCUMENTS) rejected();
            }
          }
        }
      }
      observations.sort((left, right) => {
        const a = JSON.stringify([left.key, left.versionId]);
        const b = JSON.stringify([right.key, right.versionId]);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      deadline.assertActive();
      return Object.freeze({
        sha256: hash({
          format: "candidate-deletion-replay-document-continuity-v1",
          bucket: this.options.bucketName,
          owner: this.options.expectedBucketOwner,
          originalIssuedAt,
          observations,
        }),
        versionsObserved: observations.length,
      });
    } catch {
      return rejected();
    } finally {
      deadline.close();
    }
  }

  async inspectExpectedAbsentDocuments(
    objects: readonly RestoredCandidateObjectRef[],
    signal?: AbortSignal,
  ): Promise<{
    sha256: string;
    documentKeysChecked: number;
    documentVersionsObserved: 0;
  }> {
    const deadline = new Deadline(this.timeoutMs, signal);
    try {
      deadline.assertActive();
      if (!Array.isArray(objects) || objects.length > MAX_DOCUMENTS) rejected();
      const documents = new Set<string>();
      const keys = new Set<string>();
      const namespaces = new Set<string>();
      // Validate all owner/key associations before making even the first cloud request.
      const refs = objects
        .map((value) => {
          const ref = record(value);
          if (ref.kind === "cover_letter") {
            exactKeys(ref, [
              "kind",
              "userId",
              "documentId",
              "objectKey",
              ...("objectVersion" in ref ? ["objectVersion"] : []),
            ]);
            if (
              typeof ref.userId !== "string" ||
              !UUID.test(ref.userId) ||
              typeof ref.documentId !== "string" ||
              !UUID.test(ref.documentId) ||
              documents.has(ref.documentId) ||
              ref.objectKey !== `normalized/${ref.documentId}/cover-letter.v1.json` ||
              ("objectVersion" in ref &&
                (!opaque(ref.objectVersion) || ref.objectVersion === "null"))
            )
              rejected();
            documents.add(ref.documentId);
            namespaces.add(`normalized/${ref.documentId}/`);
            if (keys.has(ref.objectKey as string)) rejected();
            keys.add(ref.objectKey as string);
            return {
              kind: "cover_letter",
              userId: ref.userId,
              documentId: ref.documentId,
              objectKey: ref.objectKey,
              objectVersion: ref.objectVersion ?? null,
            };
          }
          const optionalKeys = [
            "sourceObjectVersion",
            "normalizedObjectKey",
            "normalizedObjectVersion",
          ];
          exactKeys(ref, [
            "userId",
            "documentId",
            "sourceObjectKey",
            ...optionalKeys.filter((key) => key in ref),
          ]);
          if (
            typeof ref.userId !== "string" ||
            !UUID.test(ref.userId) ||
            typeof ref.documentId !== "string" ||
            !UUID.test(ref.documentId) ||
            documents.has(ref.documentId) ||
            ref.sourceObjectKey !== `quarantine/${ref.documentId}/source` ||
            ("sourceObjectVersion" in ref &&
              (!opaque(ref.sourceObjectVersion) || ref.sourceObjectVersion === "null")) ||
            "normalizedObjectKey" in ref !== "normalizedObjectVersion" in ref
          )
            rejected();
          const objectKeys = [ref.sourceObjectKey as string];
          if ("normalizedObjectKey" in ref) {
            if (
              !("sourceObjectVersion" in ref) ||
              typeof ref.normalizedObjectKey !== "string" ||
              !new RegExp(
                `^normalized/${ref.documentId}/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}/resume\\.json$`,
                "u",
              ).test(ref.normalizedObjectKey) ||
              !opaque(ref.normalizedObjectVersion) ||
              ref.normalizedObjectVersion === "null"
            )
              rejected();
            objectKeys.push(ref.normalizedObjectKey);
          }
          documents.add(ref.documentId);
          namespaces.add(`quarantine/${ref.documentId}/`);
          namespaces.add(`normalized/${ref.documentId}/`);
          for (const key of objectKeys) {
            if (keys.has(key)) rejected();
            keys.add(key);
          }
          return {
            userId: ref.userId,
            documentId: ref.documentId,
            sourceObjectKey: ref.sourceObjectKey,
            sourceObjectVersion: ref.sourceObjectVersion ?? null,
            normalizedObjectKey: ref.normalizedObjectKey ?? null,
            normalizedObjectVersion: ref.normalizedObjectVersion ?? null,
          };
        })
        .sort((left, right) =>
          left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0,
        );
      const inspectedNamespaces = [...namespaces].sort();
      for (const namespace of inspectedNamespaces) {
        for await (const page of versionPages(this.s3, this.options, namespace, deadline)) {
          // Reject registered keys and unregistered siblings equally. A parser Put
          // can precede its SQL registration; absence of that ref is not S3 absence.
          if (page.versions.length !== 0 || page.deletions.length !== 0) rejected();
        }
      }
      deadline.assertActive();
      return Object.freeze({
        sha256: hash({
          format: "candidate-deletion-restore-documents-absent-v1",
          bucket: this.options.bucketName,
          owner: this.options.expectedBucketOwner,
          refs,
          namespaces: inspectedNamespaces,
        }),
        documentKeysChecked: keys.size,
        documentVersionsObserved: 0 as const,
      });
    } catch {
      rejected();
    } finally {
      deadline.close();
    }
  }
}
