import { createHash } from "node:crypto";
import type {
  CompletionRepairObservation,
  CompletionRepairTag,
  CompletionRepairTarget,
} from "./candidate-deletion-completion-tag-repair.js";

/** Same normalized per-object record already used by the private restore AWS reader. */
export interface CompletionMarkerVersion {
  readonly key: string;
  readonly versionId: string;
  readonly etag: string;
  readonly size: number;
  readonly lastModified: string;
  readonly owner: string | null;
  readonly checksumAlgorithm: readonly ["SHA256"] | null;
  readonly checksumType: "FULL_OBJECT" | null;
}

export interface CompletionMarkerAwsEvidence {
  readonly target: CompletionRepairTarget;
  readonly expectedKmsKeyArn: string;
  /** Actual HeadObject or independently body-verified GetObject response. Body is never consumed. */
  readonly object: unknown;
  readonly tagging: unknown;
  readonly retention: unknown;
  readonly version: unknown;
}

export const COMPLETION_MARKER_LIST_MAX_KEYS = 2;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const targetKeys = ["bucketName", "expectedBucketOwner", "key", "versionId"];
const versionKeys = [
  "key",
  "versionId",
  "etag",
  "size",
  "lastModified",
  "owner",
  "checksumAlgorithm",
  "checksumType",
];
const metadataKeys = [
  "request-id",
  "operation-id",
  "policy-version",
  "policy-sha256",
  "subject-digest",
  "confirmed-at",
  "backup-expires-at",
  "format",
];
const objectKeys = [
  "$metadata",
  "Body",
  "DeleteMarker",
  "AcceptRanges",
  "Expiration",
  "Restore",
  "LastModified",
  "ContentLength",
  "ETag",
  "ChecksumCRC32",
  "ChecksumCRC32C",
  "ChecksumCRC64NVME",
  "ChecksumSHA1",
  "ChecksumSHA256",
  "ChecksumSHA512",
  "ChecksumMD5",
  "ChecksumType",
  "MissingMeta",
  "VersionId",
  "CacheControl",
  "ContentDisposition",
  "ContentEncoding",
  "ContentLanguage",
  "ContentRange",
  "ContentType",
  "Expires",
  "ExpiresString",
  "WebsiteRedirectLocation",
  "ServerSideEncryption",
  "Metadata",
  "SSECustomerAlgorithm",
  "SSECustomerKeyMD5",
  "SSEKMSKeyId",
  "BucketKeyEnabled",
  "StorageClass",
  "RequestCharged",
  "ReplicationStatus",
  "PartsCount",
  "TagCount",
  "ObjectLockMode",
  "ObjectLockRetainUntilDate",
  "ObjectLockLegalHoldStatus",
];

function rejected(): never {
  throw new Error("HistoricalCompletionMarkerMetadataRejected");
}

function object(
  value: unknown,
  allowed?: readonly string[],
  exact = false,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) rejected();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) rejected();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value")) ||
    (allowed && Object.keys(descriptors).some((key) => !allowed.includes(key))) ||
    (allowed &&
      exact &&
      Object.keys(descriptors).sort().join("\n") !== [...allowed].sort().join("\n"))
  )
    rejected();
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

function string(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) rejected();
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== "string") rejected();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) rejected();
  return value;
}

function sdkDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value))) rejected();
  return Date.prototype.toISOString.call(value);
}

function size(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 16_384)
    rejected();
  return value as number;
}

function empty(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function ok(value: unknown): void {
  const metadata = object(value);
  if (metadata.httpStatusCode !== 200) rejected();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function fingerprint(
  kind: "metadata" | "encryption" | "retention" | "versions",
  value: unknown,
): string {
  return createHash("sha256")
    .update(`candidate-deletion-completion-marker/${kind}/v1\n`)
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function validateCompletionMarkerTarget(value: unknown): CompletionRepairTarget {
  try {
    const row = object(value, targetKeys, true);
    const bucketName = string(row.bucketName, /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u);
    if (bucketName.includes("..") || /^\d+\.\d+\.\d+\.\d+$/u.test(bucketName)) rejected();
    const key = string(row.key, /^candidate-deletion-recovery\/[a-f0-9-]+\.json$/u);
    if (!UUID.test(key.slice("candidate-deletion-recovery/".length, -5))) rejected();
    const versionId = string(row.versionId, /^[\x21-\x7e]{1,1024}$/u);
    if (versionId === "null") rejected();
    return Object.freeze({
      bucketName,
      expectedBucketOwner: string(row.expectedBucketOwner, /^\d{12}$/u),
      key,
      versionId,
    });
  } catch {
    return rejected();
  }
}

function version(value: unknown, target: CompletionRepairTarget): CompletionMarkerVersion {
  const row = object(value, versionKeys, true);
  if (row.key !== target.key || row.versionId !== target.versionId) rejected();
  if (row.owner !== null) string(row.owner, SHA);
  if (
    row.checksumAlgorithm !== null &&
    (!Array.isArray(row.checksumAlgorithm) ||
      row.checksumAlgorithm.length !== 1 ||
      row.checksumAlgorithm[0] !== "SHA256")
  )
    rejected();
  if (row.checksumType !== null && row.checksumType !== "FULL_OBJECT") rejected();
  return Object.freeze({
    key: target.key,
    versionId: target.versionId,
    etag: string(row.etag, /^"[^"\r\n]{1,254}"$/u),
    size: size(row.size),
    lastModified: iso(row.lastModified),
    owner: row.owner as string | null,
    checksumAlgorithm: row.checksumAlgorithm === null ? null : Object.freeze(["SHA256"] as const),
    checksumType: row.checksumType as "FULL_OBJECT" | null,
  });
}

/** Local adapter only: exactly one latest version of exactly this key, no pagination or deletes. */
export function completionMarkerVersionFromListing(
  targetInput: CompletionRepairTarget,
  value: unknown,
): CompletionMarkerVersion {
  try {
    const target = validateCompletionMarkerTarget(targetInput);
    const listing = object(value, [
      "$metadata",
      "Name",
      "Prefix",
      "KeyMarker",
      "VersionIdMarker",
      "NextKeyMarker",
      "NextVersionIdMarker",
      "MaxKeys",
      "IsTruncated",
      "Versions",
      "DeleteMarkers",
      "CommonPrefixes",
      "EncodingType",
      "Delimiter",
      "RequestCharged",
    ]);
    ok(listing.$metadata);
    if (
      listing.Name !== target.bucketName ||
      listing.Prefix !== target.key ||
      listing.MaxKeys !== COMPLETION_MARKER_LIST_MAX_KEYS ||
      listing.IsTruncated !== false ||
      (listing.KeyMarker ?? "") !== "" ||
      (listing.VersionIdMarker ?? "") !== "" ||
      (listing.NextKeyMarker ?? "") !== "" ||
      (listing.NextVersionIdMarker ?? "") !== "" ||
      (listing.Delimiter ?? "") !== "" ||
      listing.EncodingType !== undefined ||
      listing.RequestCharged !== undefined ||
      !empty(listing.DeleteMarkers) ||
      !empty(listing.CommonPrefixes) ||
      !Array.isArray(listing.Versions) ||
      listing.Versions.length !== 1
    )
      rejected();
    const item = object(listing.Versions[0], [
      "Key",
      "VersionId",
      "IsLatest",
      "ETag",
      "Size",
      "LastModified",
      "StorageClass",
      "Owner",
      "ChecksumAlgorithm",
      "ChecksumType",
      "RestoreStatus",
    ]);
    if (
      item.IsLatest !== true ||
      item.StorageClass !== "STANDARD" ||
      item.RestoreStatus !== undefined
    )
      rejected();
    let owner: string | null = null;
    if (item.Owner !== undefined) {
      const currentOwner = object(item.Owner, ["ID", "DisplayName"]);
      owner = string(currentOwner.ID, SHA);
      if (currentOwner.DisplayName !== undefined)
        string(currentOwner.DisplayName, /^[\x20-\x7e]{1,256}$/u);
    }
    return version(
      {
        key: item.Key,
        versionId: item.VersionId,
        etag: item.ETag,
        size: item.Size,
        lastModified: sdkDate(item.LastModified),
        owner,
        checksumAlgorithm: item.ChecksumAlgorithm ?? null,
        checksumType: item.ChecksumType ?? null,
      },
      target,
    );
  } catch {
    return rejected();
  }
}

export function completionMarkerVersionFingerprint(
  targetInput: CompletionRepairTarget,
  value: unknown,
): string {
  try {
    const target = validateCompletionMarkerTarget(targetInput);
    return fingerprint("versions", [version(value, target)]);
  } catch {
    return rejected();
  }
}

/**
 * Shared by the diagnostic's already-body-verified GetObject path and local metadata-only HEAD.
 * The checksum is an identity, not a claim that this helper fetched or hashed object body bytes.
 * Missing legal-hold metadata remains null. Optional protocol ChecksumType absence is accepted,
 * not reported as observed FULL_OBJECT; protected diagnosis independently verifies body bytes.
 */
export function completionMarkerObservationFromAws(
  input: CompletionMarkerAwsEvidence,
): CompletionRepairObservation {
  try {
    const args = object(
      input,
      ["target", "expectedKmsKeyArn", "object", "tagging", "retention", "version"],
      true,
    );
    const target = validateCompletionMarkerTarget(args.target);
    const expectedKmsKeyArn = string(
      args.expectedKmsKeyArn,
      new RegExp(`^arn:aws:kms:us-east-2:${target.expectedBucketOwner}:key/[a-f0-9-]{36}$`, "u"),
    );
    if (!UUID.test(expectedKmsKeyArn.split("/")[1] ?? "")) rejected();
    const selected = version(args.version, target);
    const response = object(args.object, objectKeys);
    ok(response.$metadata);
    if (
      response.VersionId !== target.versionId ||
      response.ETag !== selected.etag ||
      response.ContentLength !== selected.size ||
      sdkDate(response.LastModified) !== selected.lastModified ||
      (response.DeleteMarker !== undefined && response.DeleteMarker !== false) ||
      response.ServerSideEncryption !== "aws:kms" ||
      response.SSEKMSKeyId !== expectedKmsKeyArn ||
      response.BucketKeyEnabled !== true ||
      response.ContentType !== "application/json" ||
      (response.ChecksumType !== undefined && response.ChecksumType !== "FULL_OBJECT") ||
      response.ContentEncoding !== undefined ||
      response.ContentRange !== undefined ||
      (response.MissingMeta !== undefined && response.MissingMeta !== 0) ||
      (response.AcceptRanges !== undefined && response.AcceptRanges !== "bytes") ||
      (response.StorageClass !== undefined && response.StorageClass !== "STANDARD") ||
      (response.PartsCount !== undefined && response.PartsCount !== 1) ||
      (response.TagCount !== undefined && response.TagCount !== 2) ||
      response.Restore !== undefined ||
      response.RequestCharged !== undefined ||
      response.ReplicationStatus !== undefined ||
      response.SSECustomerAlgorithm !== undefined ||
      response.SSECustomerKeyMD5 !== undefined ||
      response.ObjectLockMode !== "COMPLIANCE" ||
      (response.ObjectLockLegalHoldStatus !== undefined &&
        response.ObjectLockLegalHoldStatus !== "OFF")
    )
      rejected();
    for (const key of [
      "CacheControl",
      "ContentDisposition",
      "ContentLanguage",
      "Expires",
      "ExpiresString",
      "WebsiteRedirectLocation",
      "ChecksumCRC32",
      "ChecksumCRC32C",
      "ChecksumCRC64NVME",
      "ChecksumSHA1",
      "ChecksumSHA512",
      "ChecksumMD5",
    ]) {
      if (response[key] !== undefined) rejected();
    }
    if (response.Expiration !== undefined) string(response.Expiration, /^[\x20-\x7e]{1,2048}$/u);
    const checksum = string(response.ChecksumSHA256, /^[A-Za-z0-9+/]{43}=$/u);
    const checksumBytes = Buffer.from(checksum, "base64");
    if (checksumBytes.byteLength !== 32 || checksumBytes.toString("base64") !== checksum)
      rejected();
    const checksumSha256 = checksumBytes.toString("hex");
    const metadata = object(response.Metadata, metadataKeys, true);
    if (
      metadata["request-id"] !== target.key.slice("candidate-deletion-recovery/".length, -5) ||
      metadata.format !== "candidate-deletion-recovery-v1"
    )
      rejected();
    string(metadata["operation-id"], UUID);
    string(metadata["policy-version"], /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
    string(metadata["policy-sha256"], SHA);
    string(metadata["subject-digest"], SHA);
    const confirmedAt = iso(metadata["confirmed-at"]);
    const retainUntil = iso(metadata["backup-expires-at"]);
    if (retainUntil <= confirmedAt || sdkDate(response.ObjectLockRetainUntilDate) !== retainUntil)
      rejected();
    const retained = object(args.retention, ["$metadata", "Retention"]);
    ok(retained.$metadata);
    const retention = object(retained.Retention, ["Mode", "RetainUntilDate"], true);
    if (retention.Mode !== "COMPLIANCE" || sdkDate(retention.RetainUntilDate) !== retainUntil)
      rejected();
    const tagged = object(args.tagging, ["$metadata", "VersionId", "TagSet"]);
    ok(tagged.$metadata);
    if (
      tagged.VersionId !== target.versionId ||
      !Array.isArray(tagged.TagSet) ||
      tagged.TagSet.length !== 2
    )
      rejected();
    const tagSet = tagged.TagSet.map((item): CompletionRepairTag => {
      const tag = object(item, ["Key", "Value"], true);
      if (tag.Key === "state" && tag.Value === "completed")
        return Object.freeze({ Key: "state", Value: "completed" });
      if (tag.Key !== "completed-at" || iso(tag.Value) < confirmedAt) return rejected();
      return Object.freeze({ Key: "completed-at", Value: tag.Value as string });
    }).sort((left, right) => (left.Key < right.Key ? -1 : left.Key > right.Key ? 1 : 0));
    if (tagSet[0]?.Key !== "completed-at" || tagSet[1]?.Key !== "state") rejected();
    return Object.freeze({
      ...target,
      bodySha256: checksumSha256,
      checksumSha256,
      metadataSha256: fingerprint("metadata", metadata),
      encryptionSha256: fingerprint("encryption", {
        algorithm: "aws:kms",
        kmsKeyArn: expectedKmsKeyArn,
        bucketKeyEnabled: true,
      }),
      retentionSha256: fingerprint("retention", {
        mode: "COMPLIANCE",
        retainUntil,
        legalHold: response.ObjectLockLegalHoldStatus ?? null,
      }),
      versionInventorySha256: fingerprint("versions", [selected]),
      etag: selected.etag,
      contentLength: selected.size,
      lastModified: selected.lastModified,
      tagSet: Object.freeze(tagSet),
    });
  } catch {
    return rejected();
  }
}
