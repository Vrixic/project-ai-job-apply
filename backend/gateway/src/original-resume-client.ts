import { createHash } from "node:crypto";
import type {
  UploadedResumeFileBody,
  UploadedResumeSource,
} from "@ai-job-apply/applications-service";
import {
  ORIGINAL_RESUME_MAXIMUM_BYTES,
  ORIGINAL_RESUME_REQUEST_KIND,
  ORIGINAL_RESUME_RESULT_SCHEMA,
  type OriginalResumeMode,
  type OriginalResumeResult,
} from "@ai-job-apply/documents-service";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

/**
 * The Gateway's only path to the candidate's original resume bytes. The Documents runtime reads the
 * exact stored version; the Gateway never reads the object store. Errors carry no payload text.
 */
export class OriginalResumeTransportError extends Error {
  constructor() {
    super("The original resume runtime is unavailable");
    this.name = "OriginalResumeTransportError";
  }
}

interface LambdaSender {
  send(
    command: InvokeCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{ FunctionError?: string; Payload?: Uint8Array }>;
}

const MAXIMUM_RESPONSE_BYTES = 6 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const validFileName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 255 &&
  ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f || character === "/" || character === "\\";
  });
const MEDIA = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

function isResult(value: unknown): value is OriginalResumeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as { schema?: unknown; status?: unknown };
  return (
    result.schema === ORIGINAL_RESUME_RESULT_SCHEMA &&
    ["ready", "no_resume", "unavailable"].includes(String(result.status))
  );
}

/** Invokes the exact, reviewed processor alias synchronously with one fixed request kind. */
export class LambdaOriginalResumeClient implements UploadedResumeSource {
  constructor(
    private readonly functionArn: string,
    private readonly client: LambdaSender = new LambdaClient({}) as unknown as LambdaSender,
    private readonly timeoutMilliseconds = 15_000,
  ) {}

  private async invoke(
    mode: OriginalResumeMode,
    ownerUserId: string,
    target: { documentId?: string; applicationId?: string; generationId?: string } = {},
  ): Promise<OriginalResumeResult> {
    let payload: Uint8Array | undefined;
    try {
      const response = await this.client.send(
        new InvokeCommand({
          FunctionName: this.functionArn,
          InvocationType: "RequestResponse",
          Payload: new TextEncoder().encode(
            JSON.stringify({
              kind: ORIGINAL_RESUME_REQUEST_KIND,
              mode,
              ownerUserId,
              ...(target.documentId ? { documentId: target.documentId } : {}),
              ...(target.applicationId ? { applicationId: target.applicationId } : {}),
              ...(target.generationId ? { generationId: target.generationId } : {}),
            }),
          ),
        }),
        { abortSignal: AbortSignal.timeout(this.timeoutMilliseconds) },
      );
      if (response.FunctionError) throw new OriginalResumeTransportError();
      payload = response.Payload;
    } catch {
      throw new OriginalResumeTransportError();
    }
    if (!payload || payload.byteLength < 2 || payload.byteLength > MAXIMUM_RESPONSE_BYTES)
      throw new OriginalResumeTransportError();
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      throw new OriginalResumeTransportError();
    }
    if (!isResult(value)) throw new OriginalResumeTransportError();
    return value;
  }

  /** The candidate's current resume identity. An unreadable document is an outage, not "none". */
  async descriptor(ownerUserId: string) {
    const result = await this.invoke("descriptor", ownerUserId);
    if (result.status === "no_resume") return undefined;
    if (result.status !== "ready" || !validDocument(result.document))
      throw new OriginalResumeTransportError();
    return {
      documentId: result.document.id,
      sha256: result.document.sha256,
      sizeBytes: result.document.sizeBytes,
    };
  }

  async file(ownerUserId: string, documentId: string): Promise<UploadedResumeFileBody | undefined> {
    const result = await this.invoke("file", ownerUserId, { documentId });
    return this.verifiedFile(result, documentId);
  }

  /** The original a generated resume was made from. Documents finds it; the caller names no document. */
  async generationFile(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
  ): Promise<UploadedResumeFileBody | undefined> {
    const result = await this.invoke("generation_file", ownerUserId, {
      applicationId,
      generationId,
    });
    return this.verifiedFile(result);
  }

  /** `expectedDocumentId` pins the document where the caller chose it; a generation's is Documents' to name. */
  private verifiedFile(
    result: OriginalResumeResult,
    expectedDocumentId?: string,
  ): UploadedResumeFileBody | undefined {
    if (result.status === "no_resume") return undefined;
    if (
      result.status !== "ready" ||
      !validDocument(result.document) ||
      typeof result.contentBase64 !== "string" ||
      (expectedDocumentId !== undefined && result.document.id !== expectedDocumentId)
    )
      throw new OriginalResumeTransportError();
    const { document } = result;
    // Defence in depth: the bytes must be exactly the file the Documents runtime described.
    const bytes = Buffer.from(result.contentBase64, "base64");
    if (
      document.sizeBytes > ORIGINAL_RESUME_MAXIMUM_BYTES ||
      bytes.byteLength !== document.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== document.sha256
    )
      throw new OriginalResumeTransportError();
    return {
      documentId: document.id,
      sha256: document.sha256,
      sizeBytes: document.sizeBytes,
      fileName: document.fileName,
      format: document.format,
      mediaType: document.mediaType,
      contentBase64: result.contentBase64,
    };
  }
}

function validDocument(
  value: unknown,
): value is Extract<OriginalResumeResult, { status: "ready" }>["document"] {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === "string" &&
    UUID.test(document.id) &&
    typeof document.sha256 === "string" &&
    SHA256.test(document.sha256) &&
    validFileName(document.fileName) &&
    (document.format === "pdf" || document.format === "docx") &&
    document.mediaType === MEDIA[document.format] &&
    Number.isSafeInteger(document.sizeBytes) &&
    (document.sizeBytes as number) >= 1 &&
    (document.sizeBytes as number) <= 5 * 1024 * 1024
  );
}
