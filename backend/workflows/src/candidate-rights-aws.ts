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
    const inventory: ObjectIdentifier[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let isTruncated = true;
    while (isTruncated) {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucketName,
          Prefix: key,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}),
          ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
        }),
      );
      const append = (items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (
            item &&
            typeof item === "object" &&
            (item as { Key?: unknown }).Key === key &&
            typeof (item as { VersionId?: unknown }).VersionId === "string"
          ) {
            inventory.push({ Key: key, VersionId: (item as { VersionId: string }).VersionId });
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
    }
    return inventory;
  }

  async deleteAllVersionsAndMarkers(
    objects: readonly CandidateDocumentObjectRef[],
  ): Promise<{ exactInventoryEmpty: boolean }> {
    const keys = exactObjectKeys(objects);
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
    const remaining = await Promise.all(keys.map((key) => this.inventory(key)));
    return { exactInventoryEmpty: remaining.every((items) => items.length === 0) };
  }
}
