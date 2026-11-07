import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MAXIMUM_ORIGINAL_PDF_BYTES } from "./original-pdf.js";

interface S3Sender {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export interface SourceDocument {
  documentId: string;
  objectKey: string;
  objectVersion: string;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
}

/** Reads the candidate's retained original, exactly the object the parser read. */
export interface SourceDocumentReader {
  /** Resolves to nothing when the original is not a PDF small enough to be edited. */
  read(source: SourceDocument): Promise<Uint8Array | undefined>;
}

async function boundedBytes(body: unknown, limit: number): Promise<Uint8Array> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("SourceObjectBodyUnavailable");
  }
  const bytes = await (
    body as { transformToByteArray(): Promise<Uint8Array> }
  ).transformToByteArray();
  if (bytes.byteLength < 1 || bytes.byteLength > limit) throw new Error("SourceObjectSizeInvalid");
  return new Uint8Array(bytes);
}

/**
 * Applies every check the parser applies before it trusts the object (the clean malware-scan tag, the
 * exact version, the encryption key, the recorded metadata) and then requires the bytes to hash to the
 * document's recorded digest, so what is edited is provably the file that was parsed.
 */
export class S3SourceDocumentReader implements SourceDocumentReader {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly client: S3Sender = new S3Client({}),
  ) {}

  async read(source: SourceDocument): Promise<Uint8Array | undefined> {
    if (
      source.mediaType !== "application/pdf" ||
      !Number.isInteger(source.sizeBytes) ||
      source.sizeBytes < 1 ||
      source.sizeBytes > MAXIMUM_ORIGINAL_PDF_BYTES
    )
      return undefined;
    if (
      source.objectKey !== `quarantine/${source.documentId}/source` ||
      !source.objectVersion ||
      !/^[a-f0-9]{64}$/u.test(source.sha256)
    )
      throw new Error("SourceObjectKeyInvalid");
    const location = {
      Bucket: this.bucketName,
      Key: source.objectKey,
      VersionId: source.objectVersion,
    };
    const tags = await this.client.send(new GetObjectTaggingCommand(location));
    const tagSet = (tags.TagSet ?? []) as Array<{ Key?: string; Value?: string }>;
    if (
      !tagSet.some(
        (tag) => tag.Key === "GuardDutyMalwareScanStatus" && tag.Value === "NO_THREATS_FOUND",
      )
    )
      throw new Error("SourceObjectNotScanned");
    const head = await this.client.send(new HeadObjectCommand(location));
    const metadata = (head.Metadata ?? {}) as Record<string, string | undefined>;
    if (
      head.VersionId !== source.objectVersion ||
      head.ContentLength !== source.sizeBytes ||
      head.ContentType !== source.mediaType ||
      head.ServerSideEncryption !== "aws:kms" ||
      head.SSEKMSKeyId !== this.kmsKeyArn ||
      metadata["document-id"] !== source.documentId ||
      metadata.sha256 !== source.sha256
    )
      throw new Error("SourceObjectMetadataInvalid");
    const object = await this.client.send(new GetObjectCommand(location));
    const bytes = await boundedBytes(object.Body, MAXIMUM_ORIGINAL_PDF_BYTES);
    if (
      bytes.byteLength !== source.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== source.sha256
    )
      throw new Error("SourceObjectDigestInvalid");
    return bytes;
  }
}
