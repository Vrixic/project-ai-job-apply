import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import type { CoverLetterObjectStore } from "./cover-letter-store.js";

interface S3Sender {
  send(command: unknown, options?: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>;
}
const MAXIMUM_BYTES = 32_768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertIdentity(input: { documentId: string; objectKey: string; sha256: string }): void {
  if (
    !UUID.test(input.documentId) ||
    input.objectKey !== `normalized/${input.documentId}/cover-letter.v1.json` ||
    !/^[a-f0-9]{64}$/u.test(input.sha256)
  )
    throw new CoverLetterIntegrityError();
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "PreconditionFailed" || value.$metadata?.httpStatusCode === 412;
}

/** The existing candidate-document bucket and KMS boundary; no credentials or endpoint override. */
export class S3CoverLetterObjectStore implements CoverLetterObjectStore {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly client: S3Sender = new S3Client({}),
  ) {
    if (!bucketName || !kmsKeyArn) throw new CoverLetterIntegrityError();
  }

  private async head(
    input: { documentId: string; objectKey: string; sha256: string; sizeBytes: number },
    signal: AbortSignal,
    objectVersion?: string,
  ): Promise<string> {
    const head = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: input.objectKey,
        ...(objectVersion ? { VersionId: objectVersion } : {}),
      }),
      { abortSignal: signal },
    );
    const metadata = head.Metadata as Record<string, unknown> | undefined;
    if (
      typeof head.VersionId !== "string" ||
      head.VersionId.length < 1 ||
      head.VersionId.length > 1024 ||
      (objectVersion && head.VersionId !== objectVersion) ||
      head.ContentLength !== input.sizeBytes ||
      head.ContentType !== "application/json" ||
      head.ServerSideEncryption !== "aws:kms" ||
      head.SSEKMSKeyId !== this.kmsKeyArn ||
      metadata?.["document-id"] !== input.documentId ||
      metadata?.["cover-letter-sha256"] !== input.sha256
    )
      throw new CoverLetterIntegrityError();
    return head.VersionId;
  }

  async putIfAbsent(
    input: Parameters<CoverLetterObjectStore["putIfAbsent"]>[0],
  ): Promise<{ objectVersion: string }> {
    assertIdentity(input);
    if (
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > MAXIMUM_BYTES ||
      createHash("sha256").update(input.bytes).digest("hex") !== input.sha256
    )
      throw new CoverLetterIntegrityError();
    const bytes = Uint8Array.from(input.bytes);
    const timeout = AbortSignal.timeout(10_000);
    let version: string | undefined;
    try {
      try {
        const result = await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: input.objectKey,
            Body: bytes,
            ContentType: "application/json",
            ServerSideEncryption: "aws:kms",
            SSEKMSKeyId: this.kmsKeyArn,
            IfNoneMatch: "*",
            ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
            Metadata: { "document-id": input.documentId, "cover-letter-sha256": input.sha256 },
          }),
          { abortSignal: timeout },
        );
        if (typeof result.VersionId !== "string" || !result.VersionId)
          throw new CoverLetterIntegrityError();
        version = result.VersionId;
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Recover an already-completed conditional write only if its exact metadata matches.
      }
      const objectVersion = await this.head(
        { ...input, sizeBytes: bytes.byteLength },
        timeout,
        version,
      );
      return { objectVersion };
    } catch {
      throw new CoverLetterIntegrityError();
    }
  }

  async read(input: Parameters<CoverLetterObjectStore["read"]>[0]): Promise<Uint8Array> {
    assertIdentity(input);
    if (
      !input.objectVersion ||
      input.objectVersion.length > 1024 ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > MAXIMUM_BYTES
    )
      throw new CoverLetterIntegrityError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      await this.head(input, controller.signal, input.objectVersion);
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: input.objectKey,
          VersionId: input.objectVersion,
        }),
        { abortSignal: controller.signal },
      );
      const chunks: Uint8Array[] = [];
      let length = 0;
      const body = object.Body;
      if (body instanceof Uint8Array) {
        chunks.push(body);
        length = body.byteLength;
      } else if (body && typeof body === "object" && Symbol.asyncIterator in body) {
        for await (const chunk of body as AsyncIterable<unknown>) {
          if (!(chunk instanceof Uint8Array)) throw new CoverLetterIntegrityError();
          length += chunk.byteLength;
          if (length > MAXIMUM_BYTES || length > input.sizeBytes)
            throw new CoverLetterIntegrityError();
          chunks.push(Uint8Array.from(chunk));
        }
      } else {
        throw new CoverLetterIntegrityError();
      }
      if (length !== input.sizeBytes) throw new CoverLetterIntegrityError();
      const bytes = Buffer.concat(chunks);
      if (createHash("sha256").update(bytes).digest("hex") !== input.sha256)
        throw new CoverLetterIntegrityError();
      return bytes;
    } catch {
      throw new CoverLetterIntegrityError();
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}
