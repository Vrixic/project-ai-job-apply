import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type { GenerationBase, GenerationBaseSource } from "./generation-base-source.js";
import {
  ORIGINAL_RESUME_MAXIMUM_BYTES,
  ORIGINAL_RESUME_RESULT_SCHEMA,
  type OriginalResumeDocument,
  type OriginalResumeResult,
  type OriginalResumeUnavailableReason,
  parseOriginalResumeRequest,
} from "./original-resume-contract.js";
import type { ParsedResumeRecord, ParsedResumeSource } from "./parsed-resume-source.js";

export * from "./original-resume-contract.js";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Reads the exact stored version of one original upload. It cannot select another object. */
export interface OriginalResumeObjectReader {
  read(record: ParsedResumeRecord): Promise<Uint8Array>;
}

interface S3Sender {
  send(command: unknown): Promise<Record<string, unknown>>;
}
interface StsSender {
  send(command: AssumeRoleCommand): Promise<{
    Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string };
  }>;
}

async function boundedBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body))
    throw new Error("OriginalResumeBodyUnavailable");
  const bytes = await (
    body as { transformToByteArray(): Promise<Uint8Array> }
  ).transformToByteArray();
  if (bytes.byteLength < 1 || bytes.byteLength > ORIGINAL_RESUME_MAXIMUM_BYTES)
    throw new Error("OriginalResumeSizeInvalid");
  return bytes;
}

/**
 * Uses the reviewed object-access role with the same exact-object, exact-version session policy the
 * parser receives: one `s3:GetObject*` on this key and version plus KMS decrypt through S3. No other
 * object is reachable, and the credentials last only for this read.
 */
export class S3OriginalResumeReader implements OriginalResumeObjectReader {
  constructor(
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly objectAccessRoleArn: string,
    private readonly region: string,
    private readonly sts: StsSender = new STSClient({}),
    private readonly s3: (credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    }) => S3Sender = (credentials) => new S3Client({ region: this.region, credentials }),
  ) {}

  async read(record: ParsedResumeRecord): Promise<Uint8Array> {
    if (!record.sourceObjectVersion) throw new Error("OriginalResumeVersionUnavailable");
    const assumed = await this.sts.send(
      new AssumeRoleCommand({
        RoleArn: this.objectAccessRoleArn,
        RoleSessionName: `resume-original-${record.id}`.slice(0, 64),
        DurationSeconds: 900,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: "s3:GetObject*",
              Resource: `arn:aws:s3:::${this.bucketName}/${record.sourceObjectKey}`,
              Condition: { StringEquals: { "s3:VersionId": record.sourceObjectVersion } },
            },
            {
              Effect: "Allow",
              Action: ["kms:Decrypt"],
              Resource: this.kmsKeyArn,
              Condition: {
                StringEquals: { "kms:ViaService": `s3.${this.region}.amazonaws.com` },
              },
            },
          ],
        }),
      }),
    );
    const credentials = assumed.Credentials;
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken)
      throw new Error("OriginalResumeAccessUnavailable");
    const object = await this.s3({
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
    }).send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: record.sourceObjectKey,
        VersionId: record.sourceObjectVersion,
      }),
    );
    if (object.VersionId !== record.sourceObjectVersion) throw new Error("OriginalResumeVersion");
    return boundedBytes(object.Body);
  }
}

function unavailable(reason: OriginalResumeUnavailableReason): OriginalResumeResult {
  return { schema: ORIGINAL_RESUME_RESULT_SCHEMA, status: "unavailable", reason };
}

function describe(record: ParsedResumeRecord): OriginalResumeDocument | undefined {
  if (record.mediaType !== PDF && record.mediaType !== DOCX) return undefined;
  return {
    id: record.id,
    fileName: record.fileName,
    format: record.mediaType === PDF ? "pdf" : "docx",
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
  };
}

/**
 * Serves the candidate's own uploaded resume. The bytes leave this function only inside the owner's
 * own response and are never logged or persisted. The stored digest is re-verified against the bytes
 * read, so a substituted or damaged object yields a fixed refusal instead of a wrong attachment.
 */
export function createOriginalResumeService(dependencies: {
  source: ParsedResumeSource;
  reader: OriginalResumeObjectReader;
  /** Without it, `generation_file` is refused as an invalid request. */
  generations?: GenerationBaseSource;
}) {
  return async function originalResume(raw: unknown): Promise<OriginalResumeResult> {
    const request = parseOriginalResumeRequest(raw);
    if (!request) return unavailable("invalid_request");
    let documentId = request.documentId;
    let base: GenerationBase | null = null;
    if (request.mode === "generation_file") {
      if (!dependencies.generations || !request.applicationId || !request.generationId)
        return unavailable("invalid_request");
      base = await dependencies.generations.findGenerationBase(
        request.ownerUserId,
        request.applicationId,
        request.generationId,
      );
      if (!base) return { schema: ORIGINAL_RESUME_RESULT_SCHEMA, status: "no_resume" };
      documentId = base.documentId;
    }
    const record = await dependencies.source.findParsedResume(request.ownerUserId, documentId);
    if (!record) return { schema: ORIGINAL_RESUME_RESULT_SCHEMA, status: "no_resume" };
    // The exact file the generation was made from, not a later upload under the same document.
    if (base && (record.version !== base.version || record.sha256 !== base.sha256))
      return { schema: ORIGINAL_RESUME_RESULT_SCHEMA, status: "no_resume" };
    const document = describe(record);
    if (!document) return unavailable("document_unreadable");
    if (request.mode === "descriptor")
      return { schema: ORIGINAL_RESUME_RESULT_SCHEMA, status: "ready", document };
    if (document.sizeBytes > ORIGINAL_RESUME_MAXIMUM_BYTES) return unavailable("too_large");
    let bytes: Uint8Array | undefined;
    try {
      bytes = await dependencies.reader.read(record);
      if (
        bytes.byteLength !== document.sizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !== document.sha256
      )
        return unavailable("document_unreadable");
      return {
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "ready",
        document,
        contentBase64: Buffer.from(bytes).toString("base64"),
      };
    } catch {
      return unavailable("document_unreadable");
    } finally {
      bytes?.fill(0);
    }
  };
}
