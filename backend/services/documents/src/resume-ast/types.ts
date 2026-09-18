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

/** One whole normalized block. `span` points at the exact source text so provenance is checkable. */
export interface AstNode {
  id: string;
  text: string;
  span: { blockIndex: number; startOffset: number; endOffset: number; page?: number };
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
  sections: AstSection[];
}
