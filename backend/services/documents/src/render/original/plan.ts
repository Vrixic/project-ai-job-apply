import type { PageGeometry } from "../../parsing/layout.js";
import type { AstLine } from "../../resume-ast/types.js";
import type { RenderBlock } from "../../tailoring/tailor.js";
import { OriginalEditUnsupported } from "./errors.js";
import type { PageUnits, Rect } from "./page-units.js";

/** Tolerances, in points. Source positions come from the same file, so these are tight. */
const BASELINE_TOLERANCE = 0.8;
const X_TOLERANCE = 2;
/** Room below the lowest source line before an edit would need another page. */
const BOTTOM_ALLOWANCE = 12;
const MOVE_EPSILON = 0.01;

export interface SourceLine extends AstLine {
  /** Set by the planner: where the line sits in page coordinates (origin bottom left). */
  pdfY?: number;
}

export interface PagePlan {
  /** Per top-level block of the page's content, in order. */
  keep: boolean[];
  /** Per block, how far it moves up (positive) or down (negative), in points. */
  move: number[];
  /**
   * Per block of text, where it falls in the new reading order (blocks without text have none). The
   * text is written in this order so a reader that follows the file, not the page, sees the same order.
   */
  order: Array<number | undefined>;
  /** For a link or any rectangle: the line that owns it, if any. */
  ownerOf(rect: Rect): { kept: boolean; move: number } | undefined;
}

const keyOf = (line: { page: number; y: number; runs: ReadonlyArray<{ x: number }> }) =>
  `${line.page}:${line.y.toFixed(2)}:${(line.runs[0]?.x ?? 0).toFixed(1)}`;

const sizeOf = (line: AstLine) => Math.max(...line.runs.map((run) => run.size));
const minX = (line: AstLine) => Math.min(...line.runs.map((run) => run.x));
const maxX = (line: AstLine) => Math.max(...line.runs.map((run) => run.x + run.w));

/**
 * Where each kept source line goes. A kept line keeps the gap it had after the line before it in the
 * source; the first kept line of a page takes the page's first source baseline. Lines that were left
 * out simply close up. Every line stays on its own page: an edit that would need text on another page
 * is not an in-place edit.
 */
function newBaselines(
  blocks: readonly RenderBlock[],
  sourceLines: readonly AstLine[],
): { baselines: Map<string, number>; rank: Map<string, number> } {
  const firstOfPage = new Map<number, number>();
  for (const line of sourceLines)
    firstOfPage.set(
      line.page,
      Math.min(firstOfPage.get(line.page) ?? Number.POSITIVE_INFINITY, line.y),
    );
  const result = new Map<string, number>();
  const rank = new Map<string, number>();
  const previous = new Map<number, number>();
  let lastPage = -1;
  for (const block of blocks) {
    for (const line of block.lines ?? []) {
      if (line.page < lastPage) throw new OriginalEditUnsupported("MOVES_BETWEEN_PAGES");
      lastPage = line.page;
      const before = previous.get(line.page);
      const y =
        before === undefined
          ? (firstOfPage.get(line.page) ?? line.y)
          : before + (line.dy ?? sizeOf(line) * 1.3);
      result.set(keyOf(line), y);
      rank.set(keyOf(line), rank.size);
      previous.set(line.page, y);
    }
  }
  return { baselines: result, rank };
}

/**
 * Decides, for every top-level block of every original page, whether it stays and how far it moves.
 * A block of text belongs to the one source line it sits on; a thin rule, underline, bullet shape or
 * icon belongs to the line whose band it sits in. Anything big (a background, a sidebar) never moves.
 * Anything that cannot be placed with certainty makes the edit unsupported rather than wrong.
 */
export function planEdits(input: {
  blocks: readonly RenderBlock[];
  sourceLines: readonly AstLine[];
  page: PageGeometry;
  pages: readonly PageUnits[];
}): PagePlan[] {
  const { blocks, sourceLines, page, pages } = input;
  const { baselines, rank } = newBaselines(blocks, sourceLines);
  const bottomOf = new Map<number, number>();
  for (const line of sourceLines)
    bottomOf.set(line.page, Math.max(bottomOf.get(line.page) ?? 0, line.y));
  const newBottom = new Map<number, number>();
  for (const line of sourceLines) {
    const y = baselines.get(keyOf(line));
    if (y !== undefined) newBottom.set(line.page, Math.max(newBottom.get(line.page) ?? 0, y));
  }
  for (const [pageNumber, bottom] of newBottom) {
    if (bottom > (bottomOf.get(pageNumber) ?? 0) + BOTTOM_ALLOWANCE)
      throw new OriginalEditUnsupported("MOVES_BETWEEN_PAGES");
  }

  return pages.map((units, pageNumber) => {
    // Source lines number pages from 1; `pages` is indexed from 0.
    const lines = sourceLines.filter((line) => line.page === pageNumber + 1);
    const pdfBaseline = (line: AstLine) => page.height - line.y;
    const shiftOf = (line: AstLine): { kept: boolean; move: number } => {
      const y = baselines.get(keyOf(line));
      return y === undefined ? { kept: false, move: 0 } : { kept: true, move: line.y - y };
    };

    const lineForText = (x: number, y: number): AstLine | undefined => {
      const matches = lines.filter(
        (line) =>
          Math.abs(pdfBaseline(line) - y) <= BASELINE_TOLERANCE &&
          x >= minX(line) - X_TOLERANCE &&
          x <= maxX(line) + X_TOLERANCE,
      );
      if (matches.length > 1) throw new OriginalEditUnsupported("LINE_NOT_FOUND");
      return matches[0];
    };
    /** The lines above an anchor that are close enough to be its neighbours, nearest first. */
    const linesAbove = (anchor: { x: number; y: number }, size: number, reach = 4): AstLine[] =>
      lines
        .map((line) => ({ line, gap: pdfBaseline(line) - anchor.y }))
        .filter(
          ({ line, gap }) =>
            gap > BASELINE_TOLERANCE &&
            gap <= reach * Math.max(size, sizeOf(line)) &&
            anchor.x >= minX(line) - 40 &&
            anchor.x <= maxX(line) + X_TOLERANCE,
        )
        .sort((a, b) => a.gap - b.gap)
        .map(({ line }) => line);
    const lineForRect = (rect: Rect): AstLine | undefined => {
      const cy = (rect.y0 + rect.y1) / 2;
      let best: AstLine | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      let tied = false;
      for (const line of lines) {
        const size = sizeOf(line);
        const baseline = pdfBaseline(line);
        // A rule runs the width of the page: it belongs to a line when it reaches under or beside it.
        if (
          cy < baseline - 0.45 * size ||
          cy > baseline + 1.0 * size ||
          rect.x1 < minX(line) - 40 ||
          rect.x0 > maxX(line) + 20
        )
          continue;
        const distance = Math.abs(cy - (baseline + 0.3 * size));
        if (distance < bestDistance - 0.25) {
          best = line;
          bestDistance = distance;
          tied = false;
        } else if (Math.abs(distance - bestDistance) <= 0.25) tied = true;
      }
      if (tied) throw new OriginalEditUnsupported("AMBIGUOUS_GRAPHIC");
      return best;
    };

    const keep: boolean[] = [];
    const move: number[] = [];
    const order: Array<number | undefined> = [];
    const rankOf = (line: AstLine) => rank.get(keyOf(line));
    units.groups.forEach((group, index) => {
      const info = units.info[index];
      if (!info || group.loose || (info.texts.length === 0 && info.paints.length === 0)) {
        keep.push(true);
        move.push(0);
        order.push(undefined);
        return;
      }
      if (info.texts.length > 0) {
        const matched = info.texts.map((anchor) => lineForText(anchor.x, anchor.y));
        const owners = new Set(matched.filter((line): line is AstLine => !!line));
        if (owners.size > 1) throw new OriginalEditUnsupported("LINE_NOT_FOUND");
        const owner = [...owners][0];
        // Text the parser did not read as part of a line (a space the exporter placed past the margin)
        // travels with the lines on its baseline, as long as they all move the same way.
        const sameBaseline = (anchors: ReadonlyArray<{ y: number }>) =>
          lines.filter((line) =>
            anchors.every((anchor) => Math.abs(pdfBaseline(line) - anchor.y) <= BASELINE_TOLERANCE),
          );
        if (owner) {
          const unread = info.texts.filter((_, at) => !matched[at]);
          if (sameBaseline(unread).every((line) => line !== owner))
            throw new OriginalEditUnsupported("TEXT_NOT_MATCHED");
        }
        let candidates = owner ? [owner] : sameBaseline(info.texts);
        if (candidates.length === 0) {
          // Text on a baseline no line has is a blank paragraph the exporter wrote between lines. It
          // keeps its gap below the line above it, so it moves with that line.
          const anchor = info.texts[0];
          const above = anchor ? linesAbove(anchor, anchor.size)[0] : undefined;
          if (!anchor || !above) throw new OriginalEditUnsupported("TEXT_NOT_MATCHED");
          candidates = [above];
        }
        const [first, ...rest] = candidates.map(shiftOf);
        if (!first) throw new OriginalEditUnsupported("TEXT_NOT_MATCHED");
        if (rest.some((s) => s.kept !== first.kept || Math.abs(s.move - first.move) > MOVE_EPSILON))
          throw new OriginalEditUnsupported("LINE_NOT_FOUND");
        const shift = first;
        keep.push(shift.kept);
        move.push(shift.move);
        // Right after the line it travels with, when it is not itself that line's text.
        const ranks = candidates
          .map(rankOf)
          .filter((value): value is number => value !== undefined);
        order.push(owner ? rankOf(owner) : ranks.length > 0 ? Math.min(...ranks) + 0.5 : undefined);
        return;
      }
      // A graphic. Big ones (backgrounds, sidebars) belong to the page and stay.
      const area = info.paints.reduce(
        (sum, rect) => sum + Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0),
        0,
      );
      const tall = info.paints.some((rect) => rect.y1 - rect.y0 > page.height * 0.2);
      if (area >= page.width * page.height * 0.1 || tall) {
        keep.push(true);
        move.push(0);
        order.push(undefined);
        return;
      }
      const owners = new Set(
        info.paints.map((rect) => lineForRect(rect)).filter((line): line is AstLine => !!line),
      );
      if (owners.size > 1) throw new OriginalEditUnsupported("AMBIGUOUS_GRAPHIC");
      const owner = [...owners][0];
      if (!owner) {
        // A rule or box between lines (the border under a header) is not part of any line. It keeps its
        // distance from the nearest kept line above it, and stays where it is when nothing is above.
        const top = Math.max(...info.paints.map((rect) => rect.y1));
        const left = Math.min(...info.paints.map((rect) => rect.x0));
        const right = Math.max(...info.paints.map((rect) => rect.x1));
        const anchor = { x: (left + right) / 2, y: top };
        const follows = linesAbove(anchor, 12, 8)
          .map(shiftOf)
          .find((shift) => shift.kept);
        keep.push(true);
        move.push(follows?.move ?? 0);
        order.push(undefined);
        return;
      }
      const shift = shiftOf(owner);
      keep.push(shift.kept);
      move.push(shift.move);
      order.push(undefined);
    });
    return {
      keep,
      move,
      order,
      ownerOf(rect: Rect) {
        const owner = lineForRect(rect);
        return owner ? shiftOf(owner) : undefined;
      },
    };
  });
}
