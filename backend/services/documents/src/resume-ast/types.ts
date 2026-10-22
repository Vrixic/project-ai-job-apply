import type { LayoutRule, LayoutRun, PageGeometry } from "../parsing/layout.js";

export const RESUME_AST_VERSION = "resume-ast.v1" as const;

export const sectionKinds = [
  "contact",
  "summary",
  "experience",
  "education",
  "skills",
  "projects",
  "certifications",
  "other",
] as const;
export type SectionKind = (typeof sectionKinds)[number];

/** One source line as it looked: where it sat and how it was set, for drawing it again. */
export interface AstLine {
  page: number;
  /** Baseline from the top of the page, in points. */
  y: number;
  /** Baseline distance from the line before it in the source; absent for the first line of a page. */
  dy?: number;
  runs: LayoutRun[];
  rules?: LayoutRule[];
}

/**
 * One whole source block, or a bullet with the wrapped lines that continue it. `span` points at the
 * exact source text so provenance is checkable.
 */
export interface AstNode {
  id: string;
  text: string;
  span: { blockIndex: number; startOffset: number; endOffset: number; page?: number };
  /** The source lines of this node, when the document carries layout. */
  lines?: AstLine[];
}

export interface AstEntry {
  id: string;
  /** Non-bullet lines: titles, employers, dates, or free lines of a simple section. */
  lines: AstNode[];
  bullets: AstNode[];
}

export interface AstSection {
  id: string;
  kind: SectionKind;
  heading?: AstNode;
  entries: AstEntry[];
}

/**
 * Normalized resume tree derived deterministically from one immutable normalized document.
 * Nothing is rewritten: every node's text is exactly a source block.
 */
export interface ResumeAst {
  schemaVersion: 1;
  astVersion: typeof RESUME_AST_VERSION;
  documentId: string;
  documentVersion: number;
  parserVersion: string;
  sourceSha256: string;
  /** Page size, when the document carries layout. */
  page?: PageGeometry;
  sections: AstSection[];
}
