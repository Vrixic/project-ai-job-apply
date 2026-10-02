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
  readonly config?: { readonly maxAttempts: () => Promise<number> };
  send(command: unknown, options?: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>;
}
const MAXIMUM_BYTES = 32_768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    value !== "null" &&
    [...value].every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
  );
}

function destroyBody(body: unknown): void {
  if (body && typeof body === "object" && "destroy" in body && typeof body.destroy === "function") {
    try {
      body.destroy();
    } catch {
      // Cleanup must not expose SDK or candidate data.
    }
  }
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let rejectAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new CoverLetterIntegrityError());
        signal.addEventListener("abort", rejectAbort, { once: true });
        if (signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}

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
    private readonly client: S3Sender = new S3Client({ maxAttempts: 1 }),
  ) {
    if (!bucketName || !kmsKeyArn) throw new CoverLetterIntegrityError();
  }

  private async head(
    input: { documentId: string; objectKey: string; sha256: string; sizeBytes: number },
    signal: AbortSignal,
    objectVersion?: string,
  ): Promise<string> {
    signal.throwIfAborted();
    const head = await bounded(
      this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: input.objectKey,
          ...(objectVersion ? { VersionId: objectVersion } : {}),
        }),
        { abortSignal: signal },
      ),
      signal,
    );
    const metadata = head.Metadata as Record<string, unknown> | undefined;
    if (
      !validVersion(head.VersionId) ||
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
    request: Parameters<CoverLetterObjectStore["putIfAbsent"]>[0],
    signal?: AbortSignal,
  ): Promise<{ objectVersion: string; created: boolean }> {
    if (
      !(request.bytes instanceof Uint8Array) ||
      request.bytes.byteLength < 1 ||
      request.bytes.byteLength > MAXIMUM_BYTES
    )
      throw new CoverLetterIntegrityError();
    const input = { ...request, bytes: Uint8Array.from(request.bytes) };
    assertIdentity(input);
    if (
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > MAXIMUM_BYTES ||
      createHash("sha256").update(input.bytes).digest("hex") !== input.sha256
    )
      throw new CoverLetterIntegrityError();
    const bytes = input.bytes;
    const timeout = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
    let version: string | undefined;
    let created = false;
    try {
      timeout.throwIfAborted();
      if (!this.client.config || (await bounded(this.client.config.maxAttempts(), timeout)) !== 1)
        throw new CoverLetterIntegrityError();
      timeout.throwIfAborted();
      try {
        const result = await bounded(
          this.client.send(
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
          ),
          timeout,
        );
        const receipt = result.$metadata as
          | { attempts?: unknown; httpStatusCode?: unknown }
          | undefined;
        if (
          !validVersion(result.VersionId) ||
          receipt?.attempts !== 1 ||
          receipt.httpStatusCode !== 200
        )
          throw new CoverLetterIntegrityError();
        version = result.VersionId;
        created = true;
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Recover an already-completed conditional write only if its exact metadata matches.
      }
      const objectVersion = await this.head(
        { ...input, sizeBytes: bytes.byteLength },
        timeout,
        version,
      );
      timeout.throwIfAborted();
      return { objectVersion, created };
    } catch {
      throw new CoverLetterIntegrityError();
    }
  }

  async read(
    request: Parameters<CoverLetterObjectStore["read"]>[0],
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const input = { ...request };
    assertIdentity(input);
    if (
      !validVersion(input.objectVersion) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > MAXIMUM_BYTES
    )
      throw new CoverLetterIntegrityError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const deadline = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    let iterator: AsyncIterator<unknown> | undefined;
    let body: unknown;
    try {
      await this.head(input, deadline, input.objectVersion);
      deadline.throwIfAborted();
      const object = await bounded(
        this.client
          .send(
            new GetObjectCommand({
              Bucket: this.bucketName,
              Key: input.objectKey,
              VersionId: input.objectVersion,
            }),
            { abortSignal: deadline },
          )
          .then((response) => {
            // A port may ignore abort and return later. Dispose late bodies without admitting them.
            if (deadline.aborted) destroyBody(response.Body);
            return response;
          }),
        deadline,
      );
      body = object.Body;
      if (object.VersionId !== input.objectVersion) throw new CoverLetterIntegrityError();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (body instanceof Uint8Array) {
        chunks.push(body);
        length = body.byteLength;
      } else if (body && typeof body === "object" && Symbol.asyncIterator in body) {
        iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        while (true) {
          deadline.throwIfAborted();
          const next = await bounded(iterator.next(), deadline);
          if (next.done) break;
          const chunk = next.value;
          if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0)
            throw new CoverLetterIntegrityError();
          length += chunk.byteLength;
          if (length > MAXIMUM_BYTES || length > input.sizeBytes)
            throw new CoverLetterIntegrityError();
          chunks.push(Uint8Array.from(chunk));
        }
      } else {
        throw new CoverLetterIntegrityError();
      }
      if (length !== input.sizeBytes) throw new CoverLetterIntegrityError();
      deadline.throwIfAborted();
      const bytes = Buffer.concat(chunks);
      if (createHash("sha256").update(bytes).digest("hex") !== input.sha256)
        throw new CoverLetterIntegrityError();
      return bytes;
    } catch {
      throw new CoverLetterIntegrityError();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      // Cleanup is best effort, never awaited: a stalled iterator cannot extend the deadline.
      destroyBody(body);
      try {
        void iterator?.return?.().catch(() => undefined);
      } catch {
        /* Fixed integrity error only. */
      }
    }
  }
}
