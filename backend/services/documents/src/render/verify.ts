import { parseResume } from "../parsing/index.js";
import type { RenderBlock } from "../tailoring/tailor.js";
import type { RenderedDocument } from "./render.js";

export type RenderIssueCode =
  | "unparseable"
  | "content_mismatch"
  | "missing_text"
  | "extra_text"
  | "too_many_pages";

export interface RenderVerification {
  ok: boolean;
  issues: RenderIssueCode[];
  /** Counts only; rendered candidate text is never returned or logged. */
  expectedCharacters: number;
  renderedCharacters: number;
}

const MAX_PAGES = 2;

function squash(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Re-parses the rendered artifact with the hardened production parser and requires its extracted
 * text to equal the intended blocks in order. A renderer that dropped, duplicated, reordered, or
 * altered content therefore fails before any artifact can be hashed into a packet.
 */
export async function verifyRenderedResume(
  rendered: RenderedDocument,
  expected: readonly RenderBlock[],
): Promise<RenderVerification> {
  const expectedText = squash(expected.map((block) => block.text).join(" "));
  const issues: RenderIssueCode[] = [];
  let renderedText = "";
  try {
    const parsed = await parseResume({
      documentId: "00000000-0000-7000-8000-000000000000",
      documentVersion: 1,
      parserVersion: "render-verification",
      mediaType: rendered.mediaType,
      sourceSha256: rendered.sha256,
      createdAt: "2026-01-01T00:00:00.000Z",
      bytes: rendered.bytes,
    });
    renderedText = squash(parsed.blocks.map((block) => block.text).join(" "));
  } catch {
    issues.push("unparseable");
  }
  if (issues.length === 0 && renderedText !== expectedText) {
    issues.push("content_mismatch");
    if (renderedText.length < expectedText.length) issues.push("missing_text");
    if (renderedText.length > expectedText.length) issues.push("extra_text");
  }
  if (rendered.pageCount !== undefined && rendered.pageCount > MAX_PAGES) {
    issues.push("too_many_pages");
  }
  return {
    ok: issues.length === 0,
    issues,
    expectedCharacters: expectedText.length,
    renderedCharacters: renderedText.length,
  };
}
