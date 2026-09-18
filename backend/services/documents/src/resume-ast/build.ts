import { createHash } from "node:crypto";
import type { NormalizedResumeBlock, NormalizedResumeDocument } from "../parsing/normalize.js";
import {
  type AstEntry,
  type AstNode,
  type AstSection,
  RESUME_AST_VERSION,
  type ResumeAst,
  type SectionKind,
} from "./types.js";

const HEADINGS: ReadonlyArray<{ kind: SectionKind; pattern: RegExp }> = [
  {
    kind: "summary",
    pattern: /^(?:professional\s+)?(?:summary|profile|objective|about(?:\s+me)?)$/iu,
  },
  {
    kind: "experience",
    pattern:
      /^(?:(?:professional|work|relevant|employment)\s+)?(?:experience|history)(?:\s+history)?$|^employment$/iu,
  },
  { kind: "education", pattern: /^education(?:\s+(?:and|&)\s+training)?$/iu },
  {
    kind: "skills",
    pattern: /^(?:(?:technical|core|key)\s+)?(?:skills|competencies)(?:\s*(?:&|and)\s*tools)?$/iu,
  },
  { kind: "projects", pattern: /^(?:selected\s+|personal\s+)?projects$/iu },
  { kind: "certifications", pattern: /^(?:licenses\s+(?:&|and)\s+)?certifications?$/iu },
];

const BULLET = /^[•●◦⁃∙*\-–—]\s+\S/u;
const MAX_HEADING_LENGTH = 48;

/** A block is a section heading only when it is short and matches a known heading exactly. */
export function classifyHeading(text: string): SectionKind | null {
  const candidate = text.trim().replace(/[:\s]+$/u, "");
  if (candidate.length === 0 || candidate.length > MAX_HEADING_LENGTH) return null;
  for (const { kind, pattern } of HEADINGS) {
    if (pattern.test(candidate)) return kind;
  }
  return null;
}

export function isBulletText(text: string): boolean {
  return BULLET.test(text);
}

function nodeId(document: NormalizedResumeDocument, block: NormalizedResumeBlock): string {
  return `n_${createHash("sha256")
    .update(`${document.documentId}:${document.version}:${block.index}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function structuralId(prefix: string, firstNodeId: string, ordinal: number): string {
  return `${prefix}_${createHash("sha256").update(`${firstNodeId}:${ordinal}`).digest("hex").slice(0, 16)}`;
}

function toNode(document: NormalizedResumeDocument, block: NormalizedResumeBlock): AstNode {
  return {
    id: nodeId(document, block),
    text: block.text,
    span: {
      blockIndex: block.index,
      startOffset: 0,
      endOffset: block.text.length,
      ...(block.page ? { page: block.page } : {}),
    },
  };
}

/**
 * Builds the normalized resume tree. The mapping is total: every block becomes exactly one node,
 * in source order, so no candidate content is dropped or duplicated. Text before the first
 * recognized heading is the contact section; unrecognized headings stay inside the section that
 * precedes them rather than being guessed into a new kind.
 */
export function buildResumeAst(document: NormalizedResumeDocument): ResumeAst {
  const sections: AstSection[] = [];
  let current: { kind: SectionKind; heading?: AstNode; nodes: AstNode[] } | null = null;

  const flush = () => {
    if (!current || (current.nodes.length === 0 && !current.heading)) return;
    const first = current.heading ?? current.nodes[0];
    if (!first) return;
    sections.push({
      id: structuralId("s", first.id, sections.length),
      kind: current.kind,
      ...(current.heading ? { heading: current.heading } : {}),
      entries: groupEntries(current.kind, current.nodes),
    });
  };

  for (const block of document.blocks) {
    const node = toNode(document, block);
    const headingKind = classifyHeading(block.text);
    if (headingKind && !isBulletText(block.text)) {
      flush();
      current = { kind: headingKind, heading: node, nodes: [] };
      continue;
    }
    if (!current) current = { kind: "contact", nodes: [] };
    current.nodes.push(node);
  }
  flush();

  return {
    schemaVersion: 1,
    astVersion: RESUME_AST_VERSION,
    documentId: document.documentId,
    documentVersion: document.version,
    parserVersion: document.parserVersion,
    sourceSha256: document.sourceSha256,
    sections,
  };
}

const ENTRY_KINDS: readonly SectionKind[] = [
  "experience",
  "education",
  "projects",
  "certifications",
];

/**
 * Entry-structured sections start a new entry when non-bullet lines follow bullets. Other sections
 * (contact, summary, skills, other) are a single entry so nothing is regrouped by guesswork.
 */
function groupEntries(kind: SectionKind, nodes: AstNode[]): AstEntry[] {
  if (nodes.length === 0) return [];
  const entries: AstEntry[] = [];
  let entry: { lines: AstNode[]; bullets: AstNode[] } | null = null;
  const close = () => {
    if (!entry) return;
    const first = entry.lines[0] ?? entry.bullets[0];
    if (first) {
      entries.push({
        id: structuralId("e", first.id, entries.length),
        lines: entry.lines,
        bullets: entry.bullets,
      });
    }
    entry = null;
  };
  const structured = ENTRY_KINDS.includes(kind);
  for (const node of nodes) {
    const bullet = isBulletText(node.text);
    if (!entry) entry = { lines: [], bullets: [] };
    if (structured && !bullet && entry.bullets.length > 0) {
      close();
      entry = { lines: [], bullets: [] };
    }
    if (bullet) entry.bullets.push(node);
    else entry.lines.push(node);
  }
  close();
  return entries;
}

export function sectionNodes(section: AstSection): AstNode[] {
  return [
    ...(section.heading ? [section.heading] : []),
    ...section.entries.flatMap((entry) => [...entry.lines, ...entry.bullets]),
  ];
}

/** Every node in the tree, grouped in tree order (a section's lines then bullets per entry). */
export function flattenAst(ast: ResumeAst): AstNode[] {
  return ast.sections.flatMap(sectionNodes);
}
