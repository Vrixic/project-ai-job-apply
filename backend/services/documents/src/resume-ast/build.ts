import { createHash } from "node:crypto";
import type { NormalizedResumeBlock, NormalizedResumeDocument } from "../parsing/normalize.js";
import {
  type AstEntry,
  type AstLine,
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
  { kind: "projects", pattern: /^(?:selected\s+|personal\s+)?projects?$/iu },
  { kind: "certifications", pattern: /^(?:licenses\s+(?:&|and)\s+)?certifications?$/iu },
];

// A true bullet glyph may touch its text; a dash or asterisk needs a space, or it is just punctuation.
const BULLET = /^(?:[•●◦⁃∙]\s*|[*\-–—]\s+)\S/u;
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

/** The line a block's layout describes, with its distance from the block before it. */
function lineOf(
  document: NormalizedResumeDocument,
  block: NormalizedResumeBlock,
): AstLine | undefined {
  if (!block.layout) return undefined;
  const page = block.page ?? 1;
  const before = document.blocks[block.index - 1];
  const sameLine = before?.layout && (before.page ?? 1) === page;
  return {
    page,
    y: block.layout.y,
    ...(sameLine && before.layout
      ? { dy: Math.round((block.layout.y - before.layout.y) * 10) / 10 }
      : {}),
    runs: block.layout.runs,
    ...(block.layout.rules ? { rules: block.layout.rules } : {}),
  };
}

/** Where a bullet's own text starts, so a wrapped line can be told from a new entry. */
function bulletTextStart(block: NormalizedResumeBlock): number | undefined {
  const runs = block.layout?.runs;
  const first = runs?.[0];
  if (!runs || !first) return undefined;
  const second = runs[1];
  // The marker is usually its own run; otherwise it is the first character and a space.
  if (first.text.length <= 2 && second) return second.x;
  return first.x + 2 * (first.w / Math.max(1, first.text.length));
}

const rightEdge = (block: NormalizedResumeBlock): number =>
  Math.max(...(block.layout?.runs ?? []).map((run) => run.x + run.w));

/** Where long body lines end, which is where a wrapped line stops short of. */
function bodyRight(document: NormalizedResumeDocument): number {
  const long = document.blocks.filter((block) => block.layout && block.text.length >= 60);
  return long.length > 0 ? Math.max(...long.map(rightEdge)) : 0;
}

/**
 * A line continues the bullet before it when it is not itself a bullet or heading and sits on the same
 * page one ordinary line below. It then either starts at or after where the bullet's text starts
 * (a hanging indent), or, when wrapped lines start at the marker itself, the line before it ran to
 * the right margin and its sentence had not ended. Without layout nothing is merged, as before.
 */
function continuesBullet(
  first: NormalizedResumeBlock,
  previous: NormalizedResumeBlock,
  next: NormalizedResumeBlock,
  right: number,
  pageWidth: number,
): boolean {
  if (!first.layout || !previous.layout || !next.layout) return false;
  if (isBulletText(next.text) || classifyHeading(next.text)) return false;
  if ((previous.page ?? 1) !== (next.page ?? 1)) return false;
  const start = bulletTextStart(first);
  const marker = first.layout.runs[0]?.x;
  if (start === undefined || marker === undefined) return false;
  const size = Math.max(...previous.layout.runs.map((run) => run.size));
  const gap = next.layout.y - previous.layout.y;
  const left = Math.min(...next.layout.runs.map((run) => run.x));
  if (gap <= 0 || gap > size * 1.9) return false;
  if (left >= start - 3 && left > marker + 2) return true;
  // No hanging indent: the wrapped line starts where the marker did.
  if (Math.abs(left - marker) > 3) return false;
  const reachesMargin = right > 0 && rightEdge(previous) >= right - pageWidth * 0.08;
  const sentenceEnded = /[.!?:;]$/u.test(previous.text.trim());
  const startsLower = /^[a-z(]/u.test(next.text.trim());
  return reachesMargin && (startsLower || !sentenceEnded);
}

/** Groups source blocks into the units the tree is built from: a bullet and its wrapped lines. */
function unitsOf(document: NormalizedResumeDocument): NormalizedResumeBlock[][] {
  const units: NormalizedResumeBlock[][] = [];
  const right = bodyRight(document);
  const pageWidth = document.page?.width ?? 612;
  for (const block of document.blocks) {
    const unit = units.at(-1);
    const first = unit?.[0];
    const previous = unit?.at(-1);
    if (
      unit &&
      first &&
      previous &&
      isBulletText(first.text) &&
      continuesBullet(first, previous, block, right, pageWidth)
    )
      unit.push(block);
    else units.push([block]);
  }
  return units;
}

function toNode(document: NormalizedResumeDocument, unit: NormalizedResumeBlock[]): AstNode {
  const [block] = unit;
  const last = unit.at(-1);
  if (!block || !last) throw new Error("A resume unit has at least one block");
  const lines = unit.map((item) => lineOf(document, item));
  return {
    id: nodeId(document, block),
    text: unit.map((item) => item.text).join(" "),
    span: {
      blockIndex: block.index,
      startOffset: 0,
      endOffset: unit.reduce((total, item) => total + item.text.length, unit.length - 1),
      ...(block.page ? { page: block.page } : {}),
    },
    ...(lines.every((line) => line !== undefined) ? { lines: lines as AstLine[] } : {}),
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
      entries: groupEntries(current.nodes),
    });
  };

  for (const unit of unitsOf(document)) {
    const node = toNode(document, unit);
    const headingKind = classifyHeading(node.text);
    if (headingKind && !isBulletText(node.text)) {
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
    ...(document.page ? { page: document.page } : {}),
    sections,
  };
}

/**
 * A new entry starts when non-bullet lines follow bullets, in every section, so a section that mixes
 * lines and bullets keeps its source order instead of listing all of its lines and then all of its
 * bullets. A section without bullets (contact, skills) stays a single entry.
 */
function groupEntries(nodes: AstNode[]): AstEntry[] {
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
  for (const node of nodes) {
    const bullet = isBulletText(node.text);
    if (!entry) entry = { lines: [], bullets: [] };
    if (!bullet && entry.bullets.length > 0) {
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
