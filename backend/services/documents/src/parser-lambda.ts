import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  characterCount,
  DOCUMENT_LIMITS,
  InvalidDocumentError,
  ParseLimitError,
  parseResume,
} from "./parsing/index.js";
import { parsePdf } from "./parsing/pdf.js";

export async function verifyBundledPdfParser(bytes: Uint8Array): Promise<void> {
  const blocks = await parsePdf(bytes);
  if (blocks.length !== 1 || blocks[0]?.text.trim() !== "Bundled parser verification") {
    throw new Error("BundledPdfParserVerificationFailed");
  }
}

export interface DocumentParserInput {
  documentId: string;
  documentVersion: number;
  sourceObjectKey: string;
  sourceObjectVersion: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  objectAccess: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiresAt: string;
  };
}

export interface DocumentParserSuccess {
  ok: true;
  normalizedObjectKey: string;
  normalizedObjectVersion: string;
  normalizedSha256: string;
  parserVersion: string;
  pageCount: number;
  characterCount: number;
}

export interface DocumentParserRejection {
  ok: false;
  failureCode: "invalid_document" | "parse_failed" | "object_mismatch";
  reasonCode: string;
}

export type DocumentParserResult = DocumentParserSuccess | DocumentParserRejection;

interface S3Sender {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export interface DocumentParserConfig {
  bucketName: string;
  kmsKeyArn: string;
  parserVersion: string;
}

function validateInput(input: DocumentParserInput): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      input.documentId,
    ) ||
    input.sourceObjectKey !== `quarantine/${input.documentId}/source` ||
    !input.sourceObjectVersion ||
    !Number.isInteger(input.documentVersion) ||
    input.documentVersion < 1 ||
    input.sizeBytes < 1 ||
    input.sizeBytes > DOCUMENT_LIMITS.sourceBytes ||
    (input.mediaType !== "application/pdf" &&
      input.mediaType !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    !/^[a-f0-9]{64}$/u.test(input.sha256) ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    !input.objectAccess ||
    !input.objectAccess.accessKeyId ||
    !input.objectAccess.secretAccessKey ||
    !input.objectAccess.sessionToken ||
    Number.isNaN(Date.parse(input.objectAccess.expiresAt)) ||
    Date.parse(input.objectAccess.expiresAt) <= Date.now()
  ) {
    throw new InvalidDocumentError("PARSER_INPUT");
  }
}

async function exactBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("SourceObjectBodyUnavailable");
  }
  const transform = (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray;
  const bytes = await transform.call(body);
  if (bytes.byteLength > DOCUMENT_LIMITS.sourceBytes) {
    throw new InvalidDocumentError("SOURCE_SIZE");
  }
  return new Uint8Array(bytes);
}

export function createDocumentParserHandler(
  config: DocumentParserConfig,
  s3: S3Sender = new S3Client({}),
) {
  if (
    !config.bucketName ||
    !config.kmsKeyArn ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(config.parserVersion)
  ) {
    throw new Error("Document parser configuration is incomplete");
  }
  return async (input: DocumentParserInput): Promise<DocumentParserResult> => {
    try {
      validateInput(input);
      const tags = await s3.send(
        new GetObjectTaggingCommand({
          Bucket: config.bucketName,
          Key: input.sourceObjectKey,
          VersionId: input.sourceObjectVersion,
        }),
      );
      const tagSet = (tags.TagSet ?? []) as Array<{ Key?: string; Value?: string }>;
      if (
        !tagSet.some(
          (tag) => tag.Key === "GuardDutyMalwareScanStatus" && tag.Value === "NO_THREATS_FOUND",
        )
      ) {
        throw new Error("GuardDutyCleanTagNotAvailable");
      }

      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: config.bucketName,
          Key: input.sourceObjectKey,
          VersionId: input.sourceObjectVersion,
        }),
      );
      const metadata = (head.Metadata ?? {}) as Record<string, string | undefined>;
      if (
        head.VersionId !== input.sourceObjectVersion ||
        head.ContentLength !== input.sizeBytes ||
        head.ContentType !== input.mediaType ||
        head.ServerSideEncryption !== "aws:kms" ||
        head.SSEKMSKeyId !== config.kmsKeyArn ||
        metadata["document-id"] !== input.documentId ||
        metadata.sha256 !== input.sha256
      ) {
        return { ok: false, failureCode: "object_mismatch", reasonCode: "SOURCE_METADATA" };
      }

      const source = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucketName,
          Key: input.sourceObjectKey,
          VersionId: input.sourceObjectVersion,
        }),
      );
      const bytes = await exactBytes(source.Body);
      const normalized = await parseResume({
        documentId: input.documentId,
        documentVersion: input.documentVersion,
        parserVersion: config.parserVersion,
        mediaType: input.mediaType,
        sourceSha256: input.sha256,
        createdAt: input.createdAt,
        bytes,
      });
      const normalizedBytes = new TextEncoder().encode(JSON.stringify(normalized));
      const normalizedSha256 = createHash("sha256").update(normalizedBytes).digest("hex");
      const normalizedObjectKey = `normalized/${input.documentId}/${input.sha256}/${config.parserVersion}/resume.json`;
      let normalizedObjectVersion: string | undefined;
      try {
        const put = await s3.send(
          new PutObjectCommand({
            Bucket: config.bucketName,
            Key: normalizedObjectKey,
            Body: normalizedBytes,
            ContentType: "application/json",
            ServerSideEncryption: "aws:kms",
            SSEKMSKeyId: config.kmsKeyArn,
            ChecksumSHA256: Buffer.from(normalizedSha256, "hex").toString("base64"),
            IfNoneMatch: "*",
            Metadata: {
              "document-id": input.documentId,
              "parser-version": config.parserVersion,
              "source-sha256": input.sha256,
              "normalized-sha256": normalizedSha256,
            },
          }),
        );
        normalizedObjectVersion = put.VersionId as string | undefined;
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "PreconditionFailed") throw error;
        const prior = await s3.send(
          new HeadObjectCommand({ Bucket: config.bucketName, Key: normalizedObjectKey }),
        );
        const priorMetadata = (prior.Metadata ?? {}) as Record<string, string | undefined>;
        if (
          prior.ContentLength !== normalizedBytes.byteLength ||
          prior.ContentType !== "application/json" ||
          prior.ServerSideEncryption !== "aws:kms" ||
          prior.SSEKMSKeyId !== config.kmsKeyArn ||
          priorMetadata["normalized-sha256"] !== normalizedSha256 ||
          priorMetadata["source-sha256"] !== input.sha256 ||
          priorMetadata["parser-version"] !== config.parserVersion
        ) {
          throw new Error("NormalizedObjectCollision");
        }
        normalizedObjectVersion = prior.VersionId as string | undefined;
      }
      if (!normalizedObjectVersion) throw new Error("NormalizedObjectVersionUnavailable");
      const pages = normalized.blocks.flatMap((block) => (block.page ? [block.page] : []));
      return {
        ok: true,
        normalizedObjectKey,
        normalizedObjectVersion,
        normalizedSha256,
        parserVersion: config.parserVersion,
        pageCount: pages.length > 0 ? Math.max(...pages) : 1,
        characterCount: characterCount(normalized.blocks),
      };
    } catch (error) {
      if (error instanceof InvalidDocumentError || error instanceof ParseLimitError) {
        return {
          ok: false,
          failureCode: error.failureCode,
          reasonCode: error.reasonCode,
        };
      }
      throw error;
    }
  };
}

export async function handler(input: DocumentParserInput): Promise<DocumentParserResult> {
  const runtimeHandler = createDocumentParserHandler(
    {
      bucketName: process.env.CANDIDATE_DOCUMENT_BUCKET ?? "",
      kmsKeyArn: process.env.PLATFORM_KMS_KEY_ARN ?? "",
      parserVersion: process.env.DOCUMENT_PARSER_VERSION ?? "",
    },
    new S3Client({
      credentials: {
        accessKeyId: input.objectAccess.accessKeyId,
        secretAccessKey: input.objectAccess.secretAccessKey,
        sessionToken: input.objectAccess.sessionToken,
      },
    }),
  );
  return runtimeHandler(input);
}
