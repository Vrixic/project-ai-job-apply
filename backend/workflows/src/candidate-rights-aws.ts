import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  type ObjectIdentifier,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  CandidateDocumentObjectRef,
  CandidateDocumentObjectStore,
  CandidateExportArtifactStore,
} from "./candidate-rights-activities.js";

interface S3Sender {
  send(command: unknown): Promise<Record<string, unknown>>;
}

const RESUME_DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isConditionalWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "PreconditionFailed" || value.$metadata?.httpStatusCode === 412;
}

function exactObjectKeys(objects: readonly CandidateDocumentObjectRef[]): string[] {
  const keys = objects.flatMap((object) => [
    object.sourceObjectKey,
    ...(object.normalizedObjectKey ? [object.normalizedObjectKey] : []),
  ]);
  if (
    keys.some(
      (key) =>
        key.length < 1 ||
        key.length > 1024 ||
        key.startsWith("/") ||
        key.endsWith("/") ||
        key.includes("\0"),
    )
  ) {
    throw new Error("CandidateDocumentObjectKeyRejected");
  }
  return [...new Set(keys)].sort();
}

export class AwsCandidateExportArtifactStore implements CandidateExportArtifactStore {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly client: S3Sender = new S3Client({}),
  ) {
    if (!bucketName || !kmsKeyArn) throw new Error("CandidateExportStoreConfigurationInvalid");
  }

  async putIfAbsent(input: {
    objectKey: string;
    body: Uint8Array;
    sha256: string;
    expiresAt: Date;
  }): Promise<{ objectVersion: string }> {
    const checksum = Buffer.from(input.sha256, "hex").toString("base64");
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: input.objectKey,
          Body: input.body,
          ContentType: "application/json",
          CacheControl: "no-store",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.kmsKeyArn,
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: checksum,
          IfNoneMatch: "*",
          Metadata: {
            sha256: input.sha256,
            "expires-at": input.expiresAt.toISOString(),
            format: "candidate-data-export-v1",
          },
        }),
      );
      if (typeof result.VersionId !== "string" || result.VersionId.length === 0) {
        throw new Error("CandidateExportArtifactVersionMissing");
      }
      return { objectVersion: result.VersionId };
    } catch (error) {
      if (!isConditionalWriteConflict(error)) throw error;
      const existing = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: input.objectKey }),
      );
      const metadata = existing.Metadata as Record<string, string> | undefined;
      if (
        typeof existing.VersionId !== "string" ||
        existing.VersionId.length === 0 ||
        metadata?.sha256 !== input.sha256 ||
        metadata["expires-at"] !== input.expiresAt.toISOString() ||
        metadata.format !== "candidate-data-export-v1" ||
        existing.ServerSideEncryption !== "aws:kms" ||
        existing.SSEKMSKeyId !== this.kmsKeyArn
      ) {
        throw new Error("CandidateExportArtifactConflict");
      }
      return { objectVersion: existing.VersionId };
    }
  }

  async deleteExactVersion(objectKey: string, objectVersion: string): Promise<boolean> {
    if (
      typeof objectKey !== "string" ||
      objectKey.length === 0 ||
      typeof objectVersion !== "string" ||
      objectVersion.length === 0 ||
      objectVersion === "null"
    ) {
      throw new Error("CandidateExportArtifactIdentityRejected");
    }
    const result = await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        VersionId: objectVersion,
      }),
    );
    // Version-specific DELETE is permanent. A follow-up absence HEAD can return 403
    // without ListBucket, so expiry requires the SDK's exact positive acknowledgment.
    const metadata = result.$metadata as { httpStatusCode?: unknown } | undefined;
    if (
      metadata?.httpStatusCode !== 204 ||
      result.VersionId !== objectVersion ||
      (result.DeleteMarker !== undefined && result.DeleteMarker !== false)
    ) {
      throw new Error("CandidateExportArtifactDeletionUnconfirmed");
    }
    return true;
  }
}

export class AwsCandidateDocumentObjectStore implements CandidateDocumentObjectStore {
  constructor(
    private readonly bucketName: string,
    private readonly client: S3Sender = new S3Client({}),
  ) {
    if (!bucketName) throw new Error("CandidateDocumentStoreConfigurationInvalid");
  }

  private async inventory(key: string): Promise<ObjectIdentifier[]> {
    return this.listVersions(key, (candidate) => candidate === key);
  }

  /** Every version and delete marker whose key is listed under `prefix` and accepted by `matches`. */
  private async listVersions(
    prefix: string,
    matches: (key: string) => boolean,
  ): Promise<ObjectIdentifier[]> {
    const inventory: ObjectIdentifier[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let isTruncated = true;
    const cursors = new Set<string>();
    while (isTruncated) {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}),
          ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
        }),
      );
      if (typeof page.IsTruncated !== "boolean") {
        throw new Error("CandidateDocumentInventoryInvalid");
      }
      const append = (items: unknown) => {
        if (items === undefined) return;
        if (!Array.isArray(items)) throw new Error("CandidateDocumentInventoryInvalid");
        for (const item of items) {
          if (
            !item ||
            typeof item !== "object" ||
            typeof (item as { Key?: unknown }).Key !== "string" ||
            !(item as { Key: string }).Key.startsWith(prefix) ||
            (item as { Key: string }).Key.length > 1024 ||
            Array.from((item as { Key: string }).Key).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ) ||
            typeof (item as { VersionId?: unknown }).VersionId !== "string" ||
            (item as { VersionId: string }).VersionId.length === 0
          ) {
            throw new Error("CandidateDocumentInventoryInvalid");
          }
          if (matches((item as { Key: string }).Key)) {
            inventory.push({
              Key: (item as { Key: string }).Key,
              VersionId: (item as { VersionId: string }).VersionId,
            });
          }
        }
      };
      append(page.Versions);
      append(page.DeleteMarkers);
      isTruncated = page.IsTruncated === true;
      if (!isTruncated) break;
      if (typeof page.NextKeyMarker !== "string" || page.NextKeyMarker.length === 0) {
        throw new Error("CandidateDocumentInventoryPaginationRejected");
      }
      keyMarker = page.NextKeyMarker;
      versionIdMarker =
        typeof page.NextVersionIdMarker === "string" ? page.NextVersionIdMarker : undefined;
      const cursor = JSON.stringify([keyMarker, versionIdMarker]);
      if (cursors.has(cursor)) throw new Error("CandidateDocumentInventoryPaginationRejected");
      cursors.add(cursor);
    }
    return inventory;
  }

  async deleteAllVersionsAndMarkers(
    objects: readonly CandidateDocumentObjectRef[],
  ): Promise<{ exactInventoryEmpty: boolean }> {
    const keys = exactObjectKeys(objects);
    const documentIds = [...new Set(objects.map((object) => object.documentId))];
    if (documentIds.some((id) => typeof id !== "string" || !RESUME_DOCUMENT_ID_PATTERN.test(id))) {
      throw new Error("CandidateDocumentInventoryIdentityRejected");
    }
    const prefixes = documentIds.flatMap((id) => [`quarantine/${id}/`, `normalized/${id}/`]);
    for (const key of keys) {
      const inventory = await this.inventory(key);
      for (let offset = 0; offset < inventory.length; offset += 1_000) {
        const batch = inventory.slice(offset, offset + 1_000);
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucketName,
            Delete: { Objects: batch, Quiet: true },
          }),
        );
        if (Array.isArray(result.Errors) && result.Errors.length > 0) {
          throw new Error("CandidateDocumentObjectDeletionIncomplete");
        }
      }
    }
    // Keep exact-key cleanup for retained inventories, then also remove older parser outputs
    // that are absent from the row's latest normalized key. All identifiers are validated before I/O.
    for (const documentId of documentIds) await this.purgeDocumentPrefixes(documentId);
    // Recheck every prefix after the whole batch, not just immediately after each document's purge.
    const remaining = await Promise.all([
      ...keys.map((key) => this.inventory(key)),
      ...prefixes.map((prefix) => this.listVersions(prefix, (key) => key.startsWith(prefix))),
    ]);
    return { exactInventoryEmpty: remaining.every((items) => items.length === 0) };
  }

  /**
   * Removes every version and delete marker under the two prefixes of one deleted resume (ADR-034). The prefixes are derived
   * from the document identifier here, never taken from a caller, so nothing outside `quarantine/<id>/` and
   * `normalized/<id>/` can be reached. Prefix listing also finds a normalized object left by an earlier parser version.
   * The result comes from a second listing after the deletes: `remaining` is what is still there.
   */
  async purgeDocumentPrefixes(documentId: string): Promise<{ deleted: number; remaining: number }> {
    if (typeof documentId !== "string" || !RESUME_DOCUMENT_ID_PATTERN.test(documentId)) {
      throw new Error("ResumePurgeDocumentIdentityRejected");
    }
    const prefixes = [`quarantine/${documentId}/`, `normalized/${documentId}/`];
    const list = (prefix: string) => this.listVersions(prefix, (key) => key.startsWith(prefix));
    let deleted = 0;
    for (const prefix of prefixes) {
      const inventory = await list(prefix);
      for (let offset = 0; offset < inventory.length; offset += 1_000) {
        const batch = inventory.slice(offset, offset + 1_000);
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucketName,
            Delete: { Objects: batch, Quiet: true },
          }),
        );
        if (Array.isArray(result.Errors) && result.Errors.length > 0) {
          throw new Error("ResumePurgeObjectDeletionIncomplete");
        }
        deleted += batch.length;
      }
    }
    let remaining = 0;
    for (const prefix of prefixes) remaining += (await list(prefix)).length;
    return { deleted, remaining };
  }
}
