import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DocumentParserSuccess } from "./parser-lambda.js";
import {
  type NormalizedResumeDocument,
  parseNormalizedResumeDocument,
} from "./parsing/normalize.js";
import type { DocumentProcessingJob } from "./processor.js";

const MAXIMUM_NORMALIZED_BYTES = 1_500_000;
interface S3Sender {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export interface NormalizedDocumentReader {
  read(
    job: DocumentProcessingJob,
    result: DocumentParserSuccess,
  ): Promise<NormalizedResumeDocument>;
}

async function boundedBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== "object") {
    throw new Error("NormalizedObjectBodyUnavailable");
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const append = (chunk: Uint8Array) => {
    byteLength += chunk.byteLength;
    if (byteLength > MAXIMUM_NORMALIZED_BYTES) {
      throw new Error("NormalizedObjectSizeInvalid");
    }
    chunks.push(chunk);
  };
  if (Symbol.asyncIterator in body) {
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      append(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
    }
  } else if ("transformToWebStream" in body) {
    const stream = (
      body as { transformToWebStream(): ReadableStream<Uint8Array> }
    ).transformToWebStream();
    const reader = stream.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        append(item.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } else {
    throw new Error("NormalizedObjectBodyUnavailable");
  }
  if (byteLength < 1) {
    throw new Error("NormalizedObjectSizeInvalid");
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class S3NormalizedDocumentReader implements NormalizedDocumentReader {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly client: S3Sender = new S3Client({}),
  ) {}

  async read(
    job: DocumentProcessingJob,
    result: DocumentParserSuccess,
  ): Promise<NormalizedResumeDocument> {
    const expectedKey = `normalized/${job.documentId}/${job.sha256}/${result.parserVersion}/resume.json`;
    if (result.normalizedObjectKey !== expectedKey) throw new Error("NormalizedObjectKeyInvalid");
    const head = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: expectedKey,
        VersionId: result.normalizedObjectVersion,
      }),
    );
    const metadata = (head.Metadata ?? {}) as Record<string, string | undefined>;
    if (
      head.VersionId !== result.normalizedObjectVersion ||
      !Number.isInteger(head.ContentLength) ||
      (head.ContentLength as number) < 1 ||
      (head.ContentLength as number) > MAXIMUM_NORMALIZED_BYTES ||
      head.ContentType !== "application/json" ||
      head.ServerSideEncryption !== "aws:kms" ||
      head.SSEKMSKeyId !== this.kmsKeyArn ||
      metadata["document-id"] !== job.documentId ||
      metadata["source-sha256"] !== job.sha256 ||
      metadata["parser-version"] !== result.parserVersion ||
      metadata["normalized-sha256"] !== result.normalizedSha256
    ) {
      throw new Error("NormalizedObjectMetadataInvalid");
    }
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: expectedKey,
        VersionId: result.normalizedObjectVersion,
      }),
    );
    const bytes = await boundedBytes(object.Body);
    if (bytes.byteLength !== head.ContentLength) {
      throw new Error("NormalizedObjectSizeInvalid");
    }
    if (createHash("sha256").update(bytes).digest("hex") !== result.normalizedSha256) {
      throw new Error("NormalizedObjectDigestInvalid");
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("NormalizedObjectJsonInvalid");
    }
    return parseNormalizedResumeDocument(value);
  }
}
