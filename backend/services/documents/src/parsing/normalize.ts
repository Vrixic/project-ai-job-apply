import { canonicalizeLeadingBullet } from "../leading-bullet.js";
import { assertLayoutShape, type BlockLayout, type PageGeometry } from "./layout.js";
import { DOCUMENT_LIMITS, InvalidDocumentError, ParseLimitError } from "./limits.js";

export interface ParsedTextBlock {
  text: string;
  page?: number;
  layout?: BlockLayout;
}

export interface NormalizedResumeBlock {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  page?: number;
  /** How the source line looked; present on every block or on none. */
  layout?: BlockLayout;
}

export interface NormalizedResumeDocument {
  documentId: string;
  version: number;
  parserVersion: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sourceSha256: string;
  blocks: NormalizedResumeBlock[];
  /** Page size of a laid-out document; present exactly when every block has a layout. */
  page?: PageGeometry;
  createdAt: string;
}

function removeUnsupportedControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 || codePoint === 9 || codePoint === 10 || codePoint === 13;
    })
    .filter((character) => character.codePointAt(0) !== 127)
    .join("");
}

export function normalizeBlocks(blocks: readonly ParsedTextBlock[]): NormalizedResumeBlock[] {
  const normalized: NormalizedResumeBlock[] = [];
  let documentOffset = 0;
  for (const candidate of blocks) {
    const text = canonicalizeLeadingBullet(
      removeUnsupportedControlCharacters(candidate.text)
        .replace(/[\t ]+/gu, " ")
        .replace(/\s*\r?\n\s*/gu, " ")
        .trim(),
    );
    if (!text) continue;
    if (text.length > DOCUMENT_LIMITS.blockCharacters) {
      throw new ParseLimitError("BLOCK_CHARACTER_LIMIT");
    }
    if (normalized.length >= DOCUMENT_LIMITS.blocks) {
      throw new ParseLimitError("BLOCK_COUNT_LIMIT");
    }
    const startOffset = documentOffset;
    const endOffset = startOffset + text.length;
    if (endOffset > DOCUMENT_LIMITS.characters) {
      throw new ParseLimitError("DOCUMENT_CHARACTER_LIMIT");
    }
    normalized.push({
      index: normalized.length,
      text,
      startOffset,
      endOffset,
      ...(candidate.page ? { page: candidate.page } : {}),
      ...(candidate.layout ? { layout: candidate.layout } : {}),
    });
    documentOffset = endOffset + 1;
  }
  if (normalized.length === 0) {
    throw new InvalidDocumentError("NO_USABLE_TEXT");
  }
  // A layout is all or nothing, so a partly described document is drawn without any.
  if (normalized.some((block) => block.layout === undefined)) {
    for (const block of normalized) delete block.layout;
  }
  return normalized;
}

export function characterCount(blocks: readonly NormalizedResumeBlock[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

export function parseNormalizedResumeDocument(value: unknown): NormalizedResumeDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDocumentError("NORMALIZED_SCHEMA");
  }
  const candidate = value as Partial<NormalizedResumeDocument>;
  if (
    typeof candidate.documentId !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(candidate.documentId) ||
    !Number.isInteger(candidate.version) ||
    (candidate.version ?? 0) < 1 ||
    typeof candidate.parserVersion !== "string" ||
    candidate.parserVersion.length < 1 ||
    candidate.parserVersion.length > 64 ||
    (candidate.mediaType !== "application/pdf" &&
      candidate.mediaType !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    typeof candidate.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.sourceSha256) ||
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    !Array.isArray(candidate.blocks) ||
    candidate.blocks.length < 1 ||
    candidate.blocks.length > DOCUMENT_LIMITS.blocks
  ) {
    throw new InvalidDocumentError("NORMALIZED_SCHEMA");
  }
  let expectedIndex = 0;
  let priorEnd = -1;
  for (const block of candidate.blocks) {
    if (
      !block ||
      typeof block !== "object" ||
      block.index !== expectedIndex ||
      typeof block.text !== "string" ||
      !block.text.trim() ||
      block.text.length > DOCUMENT_LIMITS.blockCharacters ||
      !Number.isInteger(block.startOffset) ||
      !Number.isInteger(block.endOffset) ||
      block.startOffset <= priorEnd ||
      block.endOffset !== block.startOffset + block.text.length ||
      block.endOffset > DOCUMENT_LIMITS.characters ||
      (block.page !== undefined &&
        (!Number.isInteger(block.page) || block.page < 1 || block.page > DOCUMENT_LIMITS.pages))
    ) {
      throw new InvalidDocumentError("NORMALIZED_SCHEMA");
    }
    expectedIndex += 1;
    priorEnd = block.endOffset;
  }
  assertLayoutShape(candidate.page, candidate.blocks);
  return candidate as NormalizedResumeDocument;
}
