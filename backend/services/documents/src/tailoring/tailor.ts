import { canonicalizeLeadingBullet } from "../leading-bullet.js";
import type { AstEntry, AstLine, AstNode, AstSection, ResumeAst } from "../resume-ast/types.js";

export const TAILORING_VERSION = "tailoring.v1" as const;
/** Same structure and the same factuality gate; only the choice of which existing bullets to keep and in what order
 * comes from a model (ADR-059). It writes no text. */
export const LIVE_TAILORING_VERSION = "tailoring.live.v1" as const;
export const DEFAULT_MAX_BULLETS_PER_ENTRY = 6;

export interface JobTextFacts {
  title: string;
  /** Plain-text description from the canonical job. Never fetched or inferred here. */
  description: string;
}

export interface TailoringOptions {
  maxBulletsPerEntry?: number;
}

export interface TailoredEntry {
  entryId: string;
  lineNodeIds: string[];
  bulletNodeIds: string[];
}

export interface TailoredSection {
  sectionId: string;
  kind: AstSection["kind"];
  headingNodeId?: string;
  entries: TailoredEntry[];
}

export type DiffOp =
  | { op: "keep"; nodeId: string }
  | { op: "move"; nodeId: string; fromIndex: number; toIndex: number; matchedTerms: string[] }
  | { op: "omit"; nodeId: string; reason: "lower_relevance" };

/**
 * A tailored variant only ever references nodes of one immutable base tree, so no text can be
 * added, reworded, or moved into a different entry. Generated rewrites are a separate, grounded
 * path that must pass factuality checks (see D3-004).
 */
export interface TailoredResume {
  tailoringVersion: typeof TAILORING_VERSION | typeof LIVE_TAILORING_VERSION;
  base: { documentId: string; documentVersion: number; sourceSha256: string };
  /** Job terms that already appear in the candidate's own content. Never terms merely wished for. */
  matchedTerms: string[];
  sections: TailoredSection[];
  diff: DiffOp[];
}

const STOP_WORDS = new Set(
  (
    "a an and are as at be but by for from has have in into is it its of on or our that the their " +
    "this to we will with you your who what when where which while also can may must such than then " +
    "they them these those etc per via about across all any each other more most new not only own " +
    "same some so too very able work working experience team teams role job ability strong years year"
  ).split(" "),
);

const TOKEN = /[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/gu;

export function extractTerms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of text.toLowerCase().matchAll(TOKEN)) {
    const term = match[0].replace(/\.+$/u, "");
    if (term.length < 2 || STOP_WORDS.has(term) || /^\d+$/u.test(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 200)
    .map(([term]) => term);
}

function termsIn(text: string): Set<string> {
  return new Set(extractTerms(text));
}

function overlap(bullet: Set<string>, jobTerms: ReadonlySet<string>): string[] {
  return [...bullet].filter((term) => jobTerms.has(term)).sort();
}

export const TAILORABLE_KINDS: readonly AstSection["kind"][] = ["experience", "projects"];

/** The bullets of one tailorable entry, in the order to show, and the ones left out (in the order the diff lists them). */
export interface BulletChoice {
  kept: readonly AstNode[];
  omitted: readonly AstNode[];
}
export type BulletChooser = (entry: AstEntry, section: AstSection) => BulletChoice;

export function tailorResume(
  ast: ResumeAst,
  job: JobTextFacts,
  options: TailoringOptions = {},
): TailoredResume {
  const maxBullets = options.maxBulletsPerEntry ?? DEFAULT_MAX_BULLETS_PER_ENTRY;
  const jobTerms = termsIn(`${job.title} ${job.description}`);
  return buildTailored(ast, job, TAILORING_VERSION, (entry) =>
    rankBullets(entry, jobTerms, maxBullets),
  );
}

/**
 * The tailored structure for any choice of bullets. Lines, headings and non tailorable sections always come from the
 * base tree unchanged, so a chooser can only pick among the entry's own bullets and cannot add, reword or move text.
 */
export function buildTailored(
  ast: ResumeAst,
  job: JobTextFacts,
  version: TailoredResume["tailoringVersion"],
  choose: BulletChooser,
): TailoredResume {
  const jobTerms = termsIn(`${job.title} ${job.description}`);
  const matched = new Set<string>();
  const diff: DiffOp[] = [];

  const sections: TailoredSection[] = ast.sections.map((section) => {
    const tailorable = TAILORABLE_KINDS.includes(section.kind);
    return {
      sectionId: section.id,
      kind: section.kind,
      ...(section.heading ? { headingNodeId: section.heading.id } : {}),
      entries: section.entries.map((entry) => {
        const lineNodeIds = entry.lines.map((line) => line.id);
        for (const line of entry.lines) diff.push({ op: "keep", nodeId: line.id });
        if (!tailorable) {
          for (const bullet of entry.bullets) diff.push({ op: "keep", nodeId: bullet.id });
          return {
            entryId: entry.id,
            lineNodeIds,
            bulletNodeIds: entry.bullets.map((bullet) => bullet.id),
          };
        }
        return {
          entryId: entry.id,
          lineNodeIds,
          bulletNodeIds: recordChoice(entry, choose(entry, section), jobTerms, matched, diff),
        };
      }),
    };
  });

  return {
    tailoringVersion: version,
    base: {
      documentId: ast.documentId,
      documentVersion: ast.documentVersion,
      sourceSha256: ast.sourceSha256,
    },
    matchedTerms: [...matched].sort(),
    sections,
    diff,
  };
}

function rankBullets(
  entry: AstEntry,
  jobTerms: ReadonlySet<string>,
  maxBullets: number,
): BulletChoice {
  const scored = entry.bullets.map((bullet, index) => {
    const terms = overlap(termsIn(bullet.text), jobTerms);
    return { bullet, index, terms };
  });
  // Highest overlap first; ties keep the candidate's own order so nothing is reshuffled without a reason.
  const ranked = [...scored].sort((a, b) => b.terms.length - a.terms.length || a.index - b.index);
  return {
    kept: ranked.slice(0, maxBullets).map(({ bullet }) => bullet),
    omitted: ranked.slice(maxBullets).map(({ bullet }) => bullet),
  };
}

/** Records the diff and the job terms the kept bullets really contain. Terms are computed from the candidate's own
 * text here, never taken from whatever chose the bullets. */
function recordChoice(
  entry: AstEntry,
  choice: BulletChoice,
  jobTerms: ReadonlySet<string>,
  matched: Set<string>,
  diff: DiffOp[],
): string[] {
  const position = new Map(entry.bullets.map((bullet, index) => [bullet.id, index]));
  choice.kept.forEach((bullet, toIndex) => {
    const index = position.get(bullet.id) ?? toIndex;
    const terms = overlap(termsIn(bullet.text), jobTerms);
    for (const term of terms) matched.add(term);
    diff.push(
      toIndex === index
        ? { op: "keep", nodeId: bullet.id }
        : { op: "move", nodeId: bullet.id, fromIndex: index, toIndex, matchedTerms: terms },
    );
  });
  for (const bullet of choice.omitted) {
    diff.push({ op: "omit", nodeId: bullet.id, reason: "lower_relevance" });
  }
  return choice.kept.map((bullet) => bullet.id);
}

export interface FactualityIssue {
  code:
    | "unknown_node"
    | "duplicate_node"
    | "node_in_wrong_entry"
    | "unknown_section"
    | "unknown_entry"
    | "base_mismatch"
    | "heading_mismatch";
  nodeId?: string;
}

/**
 * Structural factuality gate for a tailored variant: it may only rearrange or omit nodes of the
 * exact base tree, and a node can never leave the entry (employer, dates) it belongs to.
 */
export function verifyTailoredFactuality(
  ast: ResumeAst,
  tailored: TailoredResume,
): FactualityIssue[] {
  const issues: FactualityIssue[] = [];
  if (
    tailored.base.documentId !== ast.documentId ||
    tailored.base.documentVersion !== ast.documentVersion ||
    tailored.base.sourceSha256 !== ast.sourceSha256
  ) {
    issues.push({ code: "base_mismatch" });
  }
  const sections = new Map(ast.sections.map((section) => [section.id, section]));
  const seen = new Set<string>();
  const use = (nodeId: string): boolean => {
    if (seen.has(nodeId)) {
      issues.push({ code: "duplicate_node", nodeId });
      return false;
    }
    seen.add(nodeId);
    return true;
  };
  for (const section of tailored.sections) {
    const base = sections.get(section.sectionId);
    if (!base || base.kind !== section.kind) {
      issues.push({ code: "unknown_section" });
      continue;
    }
    if ((base.heading?.id ?? undefined) !== section.headingNodeId) {
      issues.push({
        code: "heading_mismatch",
        ...(section.headingNodeId ? { nodeId: section.headingNodeId } : {}),
      });
    } else if (section.headingNodeId) {
      use(section.headingNodeId);
    }
    const entries = new Map(base.entries.map((entry) => [entry.id, entry]));
    for (const entry of section.entries) {
      const baseEntry = entries.get(entry.entryId);
      if (!baseEntry) {
        issues.push({ code: "unknown_entry" });
        continue;
      }
      const lines = new Set(baseEntry.lines.map((node: AstNode) => node.id));
      const bullets = new Set(baseEntry.bullets.map((node: AstNode) => node.id));
      for (const nodeId of entry.lineNodeIds) {
        if (!lines.has(nodeId)) issues.push({ code: "node_in_wrong_entry", nodeId });
        else use(nodeId);
      }
      for (const nodeId of entry.bulletNodeIds) {
        if (!bullets.has(nodeId)) issues.push({ code: "node_in_wrong_entry", nodeId });
        else use(nodeId);
      }
    }
  }
  return issues;
}

/** Flat, ordered text blocks for rendering, resolved only from the base tree. */
export interface RenderBlock {
  kind: "heading" | "line" | "bullet";
  text: string;
  nodeId: string;
  /** How the source lines of this block looked, when the document carries layout. */
  lines?: AstLine[];
}

/** Text as drawn in generated documents: only a leading visual bullet marker is canonicalized. */
export function canonicalRenderText(text: string): string {
  return canonicalizeLeadingBullet(text);
}

export function materializeTailoredResume(ast: ResumeAst, tailored: TailoredResume): RenderBlock[] {
  const nodes = new Map<string, AstNode>();
  for (const section of ast.sections) {
    if (section.heading) nodes.set(section.heading.id, section.heading);
    for (const entry of section.entries) {
      for (const node of [...entry.lines, ...entry.bullets]) nodes.set(node.id, node);
    }
  }
  const resolve = (nodeId: string, kind: RenderBlock["kind"]): RenderBlock => {
    const node = nodes.get(nodeId);
    if (!node) throw new Error("Tailored resume references a node outside its base tree");
    return {
      kind,
      text: canonicalRenderText(node.text),
      nodeId,
      ...(node.lines ? { lines: structuredClone(node.lines) } : {}),
    };
  };
  return tailored.sections.flatMap((section) => [
    ...(section.headingNodeId ? [resolve(section.headingNodeId, "heading")] : []),
    ...section.entries.flatMap((entry) => [
      ...entry.lineNodeIds.map((id) => resolve(id, "line")),
      ...entry.bulletNodeIds.map((id) => resolve(id, "bullet")),
    ]),
  ]);
}

/** A reviewable line-level diff against the base, in base order, with fixed reason codes. */
export interface VisibleDiffLine {
  nodeId: string;
  text: string;
  op: DiffOp["op"];
  matchedTerms?: string[];
  reason?: "lower_relevance";
}

export function describeDiff(ast: ResumeAst, tailored: TailoredResume): VisibleDiffLine[] {
  const text = new Map<string, string>();
  for (const section of ast.sections) {
    if (section.heading) text.set(section.heading.id, section.heading.text);
    for (const entry of section.entries) {
      for (const node of [...entry.lines, ...entry.bullets]) text.set(node.id, node.text);
    }
  }
  return tailored.diff.map((entry) => ({
    nodeId: entry.nodeId,
    text: text.get(entry.nodeId) ?? "",
    op: entry.op,
    ...(entry.op === "move" ? { matchedTerms: entry.matchedTerms } : {}),
    ...(entry.op === "omit" ? { reason: entry.reason } : {}),
  }));
}
