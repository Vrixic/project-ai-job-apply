import { InvalidDocumentError } from "./limits.js";

/**
 * How one source line looked, kept beside its text so a tailored copy can be drawn the way the
 * candidate's own resume was. It holds positions and font traits only; the words of a run are the
 * same words as the block's text. Nothing here is ever sent anywhere except with the block it
 * describes.
 */
export interface LayoutRun {
  /** Left edge from the page's left side, in points. */
  x: number;
  /** Width as drawn in the source, in points. */
  w: number;
  /** Font size in points. */
  size: number;
  text: string;
  bold?: true;
  italic?: true;
  /** Absent means sans serif. */
  family?: "serif" | "mono";
  /** `#rrggbb`; absent means black. */
  color?: string;
}

/** A thin horizontal rule or underline that belongs to a line, below its baseline. */
export interface LayoutRule {
  x0: number;
  x1: number;
  /** Distance below the line's baseline to the rule's top edge. */
  dy: number;
  h: number;
  color?: string;
}

export interface BlockLayout {
  /** Baseline distance from the top of the page, in points. */
  y: number;
  runs: LayoutRun[];
  rules?: LayoutRule[];
  /**
   * Which reading zone of its page the line is in, counted from 1; absent means the first. A new zone
   * starts where the reading order jumps back up the page (a second column, a sidebar). A document
   * with a zone cannot be redrawn from layout, only edited in place (ADR-058).
   */
  zone?: number;
}

/** One page's size in points. Every page of a laid-out document has this size. */
export interface PageGeometry {
  width: number;
  height: number;
}

export const LAYOUT_LIMITS = {
  /** Beyond this many lines the document is simply drawn without layout. */
  blocks: 700,
  runsPerBlock: 120,
  rulesPerBlock: 24,
  /** Reading zones per page; a page that jumps back up more often is drawn without layout. */
  zonesPerPage: 32,
  /** Keeps the stored normalized object far below its reader's ceiling. */
  bytes: 600_000,
  minSize: 2,
  maxSize: 200,
  maxPageDimension: 3000,
} as const;

const COLOR = /^#[0-9a-f]{6}$/u;

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function isPageGeometry(value: unknown): value is PageGeometry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<PageGeometry>;
  return (
    Object.keys(page).length === 2 &&
    finite(page.width, 50, LAYOUT_LIMITS.maxPageDimension) &&
    finite(page.height, 50, LAYOUT_LIMITS.maxPageDimension)
  );
}

function isRun(value: unknown, textLimit: number): value is LayoutRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<LayoutRun>;
  const allowed = new Set(["x", "w", "size", "text", "bold", "italic", "family", "color"]);
  return (
    Object.keys(run).every((key) => allowed.has(key)) &&
    finite(run.x, -50, 5000) &&
    finite(run.w, 0, 5000) &&
    finite(run.size, LAYOUT_LIMITS.minSize, LAYOUT_LIMITS.maxSize) &&
    typeof run.text === "string" &&
    run.text.length > 0 &&
    run.text.length <= textLimit &&
    (run.bold === undefined || run.bold === true) &&
    (run.italic === undefined || run.italic === true) &&
    (run.family === undefined || run.family === "serif" || run.family === "mono") &&
    (run.color === undefined || (typeof run.color === "string" && COLOR.test(run.color)))
  );
}

function isRule(value: unknown): value is LayoutRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Partial<LayoutRule>;
  const allowed = new Set(["x0", "x1", "dy", "h", "color"]);
  return (
    Object.keys(rule).every((key) => allowed.has(key)) &&
    finite(rule.x0, -50, 5000) &&
    finite(rule.x1, -50, 5000) &&
    (rule.x1 as number) >= (rule.x0 as number) &&
    finite(rule.dy, -50, 100) &&
    finite(rule.h, 0.1, 6) &&
    (rule.color === undefined || (typeof rule.color === "string" && COLOR.test(rule.color)))
  );
}

/** Strict shape check; a layout that does not pass makes the whole normalized document invalid. */
export function isBlockLayout(value: unknown, textLimit: number): value is BlockLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const layout = value as Partial<BlockLayout>;
  const allowed = new Set(["y", "runs", "rules", "zone"]);
  return (
    Object.keys(layout).every((key) => allowed.has(key)) &&
    finite(layout.y, -50, 5000) &&
    (layout.zone === undefined ||
      (Number.isInteger(layout.zone) &&
        (layout.zone as number) >= 1 &&
        (layout.zone as number) <= LAYOUT_LIMITS.zonesPerPage)) &&
    Array.isArray(layout.runs) &&
    layout.runs.length >= 1 &&
    layout.runs.length <= LAYOUT_LIMITS.runsPerBlock &&
    layout.runs.every((run) => isRun(run, textLimit)) &&
    (layout.rules === undefined ||
      (Array.isArray(layout.rules) &&
        layout.rules.length <= LAYOUT_LIMITS.rulesPerBlock &&
        layout.rules.every(isRule)))
  );
}

export function assertLayoutShape(
  page: unknown,
  blocks: ReadonlyArray<{ layout?: unknown; text: string }>,
): void {
  const withLayout = blocks.filter((block) => block.layout !== undefined);
  if (page === undefined && withLayout.length === 0) return;
  // A layout is all or nothing: every block carries one and the page size is known.
  if (!isPageGeometry(page) || withLayout.length !== blocks.length)
    throw new InvalidDocumentError("NORMALIZED_SCHEMA");
  for (const block of blocks) {
    if (!isBlockLayout(block.layout, block.text.length + 8))
      throw new InvalidDocumentError("NORMALIZED_SCHEMA");
  }
}
