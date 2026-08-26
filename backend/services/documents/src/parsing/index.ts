import { createHash } from "node:crypto";
import { parseDocx } from "./docx.js";
import { DOCUMENT_LIMITS, InvalidDocumentError } from "./limits.js";
import { type NormalizedResumeDocument, normalizeBlocks } from "./normalize.js";
import { parsePdf } from "./pdf.js";

export { DOCUMENT_LIMITS, InvalidDocumentError, ParseLimitError } from "./limits.js";
export type { NormalizedResumeBlock, NormalizedResumeDocument } from "./normalize.js";
export { characterCount, parseNormalizedResumeDocument } from "./normalize.js";

export interface ParseResumeInput {
  documentId: string;
  documentVersion: number;
  parserVersion: string;
  mediaType: NormalizedResumeDocument["mediaType"];
  sourceSha256: string;
  createdAt: string;
  bytes: Uint8Array;
}

export async function parseResume(input: ParseResumeInput): Promise<NormalizedResumeDocument> {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > DOCUMENT_LIMITS.sourceBytes) {
    throw new InvalidDocumentError("SOURCE_SIZE");
  }
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  if (digest !== input.sourceSha256) throw new InvalidDocumentError("SOURCE_DIGEST");
  const rawBlocks =
    input.mediaType === "application/pdf"
      ? await parsePdf(input.bytes)
      : await parseDocx(input.bytes);
  return {
    documentId: input.documentId,
    version: input.documentVersion,
    parserVersion: input.parserVersion,
    mediaType: input.mediaType,
    sourceSha256: input.sourceSha256,
    blocks: normalizeBlocks(rawBlocks),
    createdAt: input.createdAt,
  };
}
