import { createHash } from "node:crypto";
import { parseDocx } from "./docx.js";
import { LAYOUT_LIMITS } from "./layout.js";
import { DOCUMENT_LIMITS, InvalidDocumentError } from "./limits.js";
import { type NormalizedResumeDocument, normalizeBlocks } from "./normalize.js";
import { parsePdfWithLayout } from "./pdf.js";

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
  const parsed =
    input.mediaType === "application/pdf"
      ? await parsePdfWithLayout(input.bytes)
      : { blocks: await parseDocx(input.bytes) };
  const blocks = normalizeBlocks(parsed.blocks);
  // How the lines looked travels with them only when every line has it and it stays small.
  const laidOut =
    parsed.page !== undefined &&
    blocks.every((block) => block.layout !== undefined) &&
    Buffer.byteLength(JSON.stringify(blocks.map((block) => block.layout))) <= LAYOUT_LIMITS.bytes;
  if (!laidOut) for (const block of blocks) delete block.layout;
  return {
    documentId: input.documentId,
    version: input.documentVersion,
    parserVersion: input.parserVersion,
    mediaType: input.mediaType,
    sourceSha256: input.sourceSha256,
    blocks,
    ...(laidOut && parsed.page ? { page: parsed.page } : {}),
    createdAt: input.createdAt,
  };
}
