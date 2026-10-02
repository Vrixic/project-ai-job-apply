import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  type CoverLetterProviderReference,
  type CoverLetterProviderSlot,
  CoverLetterProviderTransportError,
  coverLetterProviderByteLimits,
  coverLetterProviderKey,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  validateCoverLetterProviderReference,
} from "./cover-letter-provider-contract.js";

export interface CoverLetterProviderObjectClient {
  /** Mutations require an explicitly configured single-attempt SDK, checked before every PUT. */
  readonly config?: { readonly maxAttempts: () => Promise<number> };
  send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>;
}
export interface CoverLetterProviderObjects {
  transitionIfMatch(
    documentId: string,
    slot: "dispatch" | "result",
    prior: CoverLetterProviderReference,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ changed: false } | { changed: true; reference: CoverLetterProviderReference }>;
  find(
    documentId: string,
    slot: CoverLetterProviderSlot,
    signal?: AbortSignal,
  ): Promise<CoverLetterProviderReference | undefined>;
  putIfAbsent(
    documentId: string,
    slot: CoverLetterProviderSlot,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ created: boolean; reference: CoverLetterProviderReference }>;
  read(
    documentId: string,
    slot: CoverLetterProviderSlot,
    reference: CoverLetterProviderReference,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}
export type CoverLetterProviderTransitionObjects = Pick<
  CoverLetterProviderObjects,
  "find" | "read" | "transitionIfMatch"
>;

/** Capability facade for the isolated handler. Creation belongs only to the private owner. */
export function coverLetterProviderTransitionPort(
  objects: CoverLetterProviderObjects,
): CoverLetterProviderTransitionObjects {
  return Object.freeze({
    find: objects.find.bind(objects),
    read: objects.read.bind(objects),
    transitionIfMatch: objects.transitionIfMatch.bind(objects),
  });
}
function isStatus(error: unknown, status: number, name: string): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === name || value.$metadata?.httpStatusCode === status;
}
function deadline(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new CoverLetterProviderTransportError());
        signal.addEventListener("abort", rejectAbort, { once: true });
        if (signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}

/** No SDK/client bootstrap or database access. Only Documents-reserved normalized prefixes. */
export class S3CoverLetterProviderObjects implements CoverLetterProviderObjects {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly client: CoverLetterProviderObjectClient,
  ) {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucketName) ||
      !/^arn:(aws|aws-us-gov|aws-cn):kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/u.test(kmsKeyArn)
    )
      throw new CoverLetterProviderTransportError();
  }

  private async requireSingleWriteAttempt(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.client.config || (await bounded(this.client.config.maxAttempts(), signal)) !== 1)
      throw new CoverLetterProviderTransportError();
    signal.throwIfAborted();
  }

  private acknowledgedWrite(response: Record<string, unknown>): boolean {
    const metadata = response.$metadata as
      | { attempts?: unknown; httpStatusCode?: unknown }
      | undefined;
    return metadata?.attempts === 1 && metadata.httpStatusCode === 200;
  }

  private async head(
    documentId: string,
    slot: CoverLetterProviderSlot,
    signal: AbortSignal,
    version?: string,
  ): Promise<CoverLetterProviderReference> {
    signal.throwIfAborted();
    const response = await bounded(
      this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: coverLetterProviderKey(documentId, slot),
          ...(version ? { VersionId: version } : {}),
        }),
        { abortSignal: signal },
      ),
      signal,
    );
    const metadata = response.Metadata as Record<string, unknown> | undefined;
    const reference = {
      objectVersion: response.VersionId,
      etag: response.ETag,
      sha256: metadata?.["generation-sha256"],
      sizeBytes: response.ContentLength,
    };
    if (
      !validateCoverLetterProviderReference(reference, slot) ||
      (version && reference.objectVersion !== version) ||
      response.ContentType !== "application/json" ||
      response.ServerSideEncryption !== "aws:kms" ||
      response.SSEKMSKeyId !== this.kmsKeyArn ||
      metadata?.["document-id"] !== documentId ||
      metadata?.["generation-slot"] !== slot
    )
      throw new CoverLetterProviderTransportError();
    return reference;
  }

  async find(
    documentId: string,
    slot: CoverLetterProviderSlot,
    signal?: AbortSignal,
  ): Promise<CoverLetterProviderReference | undefined> {
    try {
      coverLetterProviderKey(documentId, slot);
      const timeout = deadline(signal);
      timeout.throwIfAborted();
      return await this.head(documentId, slot, timeout);
    } catch (error) {
      if (isStatus(error, 404, "NotFound")) return undefined;
      throw new CoverLetterProviderTransportError();
    }
  }

  async putIfAbsent(
    documentId: string,
    slot: CoverLetterProviderSlot,
    input: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ created: boolean; reference: CoverLetterProviderReference }> {
    try {
      const key = coverLetterProviderKey(documentId, slot);
      // Validate the canonical bounded content and owner before any external write.
      if (
        !(input instanceof Uint8Array) ||
        input.byteLength < 1 ||
        input.byteLength > coverLetterProviderByteLimits[slot]
      )
        throw new CoverLetterProviderTransportError();
      const bytes = Uint8Array.from(input);
      if (decodeCoverLetterProviderObject(slot, bytes).documentId !== documentId)
        throw new CoverLetterProviderTransportError();
      const sha256 = coverLetterProviderSha256(bytes);
      const timeout = deadline(signal);
      timeout.throwIfAborted();
      let version: string | undefined;
      let created = false;
      await this.requireSingleWriteAttempt(timeout);
      try {
        const response = await bounded(
          this.client.send(
            new PutObjectCommand({
              Bucket: this.bucketName,
              Key: key,
              Body: bytes,
              IfNoneMatch: "*",
              ContentType: "application/json",
              ServerSideEncryption: "aws:kms",
              SSEKMSKeyId: this.kmsKeyArn,
              ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
              Metadata: {
                "document-id": documentId,
                "generation-slot": slot,
                "generation-sha256": sha256,
              },
            }),
            { abortSignal: timeout },
          ),
          timeout,
        );
        if (
          !this.acknowledgedWrite(response) ||
          typeof response.VersionId !== "string" ||
          !response.VersionId ||
          response.VersionId === "null"
        )
          throw new CoverLetterProviderTransportError();
        version = response.VersionId;
        created = true;
      } catch (error) {
        if (!isStatus(error, 412, "PreconditionFailed")) throw error;
      }
      const reference = await this.head(documentId, slot, timeout, version);
      if (created && (reference.sha256 !== sha256 || reference.sizeBytes !== bytes.byteLength))
        throw new CoverLetterProviderTransportError();
      // A conflict returns the EXISTING reference, not a receipt for the caller's different bytes.
      // Callers must read/bind it before recovery; created:false never grants a model dispatch.
      return { created, reference };
    } catch {
      throw new CoverLetterProviderTransportError();
    }
  }

  /** Update a precreated slot only. No missing-object fallback grants dispatch or restores bytes. */
  async transitionIfMatch(
    documentId: string,
    slot: "dispatch" | "result",
    prior: CoverLetterProviderReference,
    input: Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ changed: false } | { changed: true; reference: CoverLetterProviderReference }> {
    try {
      const key = coverLetterProviderKey(documentId, slot);
      if (
        (slot !== "dispatch" && slot !== "result") ||
        !validateCoverLetterProviderReference(prior, slot) ||
        !(input instanceof Uint8Array) ||
        input.byteLength < 1 ||
        input.byteLength > coverLetterProviderByteLimits[slot]
      )
        throw new CoverLetterProviderTransportError();
      const pinned = { ...prior };
      const bytes = Uint8Array.from(input);
      const next = decodeCoverLetterProviderObject(slot, bytes);
      if (
        next.documentId !== documentId ||
        !("state" in next) ||
        next.state !== (slot === "dispatch" ? "claimed" : "ready")
      )
        throw new CoverLetterProviderTransportError();
      const timeout = deadline(signal);
      timeout.throwIfAborted();
      await this.requireSingleWriteAttempt(timeout);
      const previous = decodeCoverLetterProviderObject(
        slot,
        await this.read(documentId, slot, pinned, timeout),
      );
      if (
        !("state" in previous) ||
        previous.state !== (slot === "dispatch" ? "issued" : "pending") ||
        previous.requestSha256 !== next.requestSha256
      )
        throw new CoverLetterProviderTransportError();
      const sha256 = coverLetterProviderSha256(bytes);
      timeout.throwIfAborted();
      await this.requireSingleWriteAttempt(timeout);
      let response: Record<string, unknown>;
      try {
        response = await bounded(
          this.client.send(
            new PutObjectCommand({
              Bucket: this.bucketName,
              Key: key,
              Body: bytes,
              IfMatch: pinned.etag,
              ContentType: "application/json",
              ServerSideEncryption: "aws:kms",
              SSEKMSKeyId: this.kmsKeyArn,
              ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
              Metadata: {
                "document-id": documentId,
                "generation-slot": slot,
                "generation-sha256": sha256,
              },
            }),
            { abortSignal: timeout },
          ),
          timeout,
        );
      } catch (error) {
        if (
          isStatus(error, 404, "NotFound") ||
          isStatus(error, 409, "ConditionalRequestConflict") ||
          isStatus(error, 412, "PreconditionFailed")
        )
          return { changed: false };
        throw error;
      }
      if (
        !this.acknowledgedWrite(response) ||
        typeof response.VersionId !== "string" ||
        !response.VersionId ||
        response.VersionId === "null"
      )
        throw new CoverLetterProviderTransportError();
      const reference = await this.head(documentId, slot, timeout, response.VersionId);
      if (
        reference.etag === pinned.etag ||
        reference.sha256 !== sha256 ||
        reference.sizeBytes !== bytes.byteLength
      )
        throw new CoverLetterProviderTransportError();
      return { changed: true, reference };
    } catch {
      throw new CoverLetterProviderTransportError();
    }
  }

  async read(
    documentId: string,
    slot: CoverLetterProviderSlot,
    reference: CoverLetterProviderReference,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let bodyToClose: unknown;
    try {
      const key = coverLetterProviderKey(documentId, slot);
      if (!validateCoverLetterProviderReference(reference, slot))
        throw new CoverLetterProviderTransportError();
      const pinned = { ...reference };
      const timeout = deadline(signal);
      timeout.throwIfAborted();
      const head = await this.head(documentId, slot, timeout, pinned.objectVersion);
      if (
        head.etag !== pinned.etag ||
        head.sha256 !== pinned.sha256 ||
        head.sizeBytes !== pinned.sizeBytes
      )
        throw new CoverLetterProviderTransportError();
      timeout.throwIfAborted();
      const result = await bounded(
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            VersionId: pinned.objectVersion,
          }),
          { abortSignal: timeout },
        ),
        timeout,
      );
      const body = result.Body;
      bodyToClose = body;
      if (result.VersionId !== pinned.objectVersion) throw new CoverLetterProviderTransportError();
      const chunks: Uint8Array[] = [];
      let length = 0;
      const add = (chunk: unknown) => {
        timeout.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new CoverLetterProviderTransportError();
        length += chunk.byteLength;
        if (length > pinned.sizeBytes || length > coverLetterProviderByteLimits[slot])
          throw new CoverLetterProviderTransportError();
        chunks.push(Uint8Array.from(chunk));
      };
      if (body instanceof Uint8Array) add(body);
      else if (body && typeof body === "object" && Symbol.asyncIterator in body) {
        // Retain the original SDK body and its fixed stream protocol across async reads.
        const stream = (body as AsyncIterable<unknown>)[Symbol.asyncIterator];
        if (typeof stream !== "function") throw new CoverLetterProviderTransportError();
        const iterator = stream.call(body);
        try {
          for (;;) {
            const chunk = await bounded(iterator.next(), timeout);
            if (chunk.done) break;
            add(chunk.value);
          }
        } finally {
          const closing = iterator.return?.();
          if (closing) void Promise.resolve(closing).catch(() => undefined);
        }
      } else throw new CoverLetterProviderTransportError();
      const bytes = Buffer.concat(chunks);
      if (
        length !== pinned.sizeBytes ||
        coverLetterProviderSha256(bytes) !== pinned.sha256 ||
        decodeCoverLetterProviderObject(slot, bytes).documentId !== documentId
      )
        throw new CoverLetterProviderTransportError();
      return Uint8Array.from(bytes);
    } catch {
      throw new CoverLetterProviderTransportError();
    } finally {
      // AWS Node streams must be destroyed on refusal/abort, including before iteration starts.
      try {
        if (
          bodyToClose &&
          typeof bodyToClose === "object" &&
          "destroy" in bodyToClose &&
          typeof bodyToClose.destroy === "function"
        )
          bodyToClose.destroy();
      } catch {
        // Cleanup never replaces the fixed transport outcome with an SDK/provider exception.
      }
    }
  }
}
