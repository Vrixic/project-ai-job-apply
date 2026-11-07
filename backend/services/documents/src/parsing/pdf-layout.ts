import { canonicalizeLeadingBullet } from "../leading-bullet.js";
import {
  type BlockLayout,
  LAYOUT_LIMITS,
  type LayoutRule,
  type LayoutRun,
  type PageGeometry,
} from "./layout.js";

/** The parts of PDF.js's text item that layout needs. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL: boolean;
}

export interface PdfOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface PdfFontTraits {
  name?: string | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  serif?: boolean | undefined;
  mono?: boolean | undefined;
}

export interface PdfPageLayoutInput {
  /** The page's visible box: left, bottom, right, top. */
  view: readonly [number, number, number, number];
  rotate: number;
  /** Text items already split into lines at each end-of-line mark. */
  groups: readonly (readonly PdfTextItem[])[];
  fontTraits(fontName: string): PdfFontTraits | undefined;
  operators: PdfOperatorList | undefined;
  /** PDF.js operator codes. */
  ops: Readonly<Record<string, number>>;
}

interface TextRecord {
  x: number;
  yTop: number;
  text: string;
  color: string;
}

interface RuleRecord {
  x0: number;
  x1: number;
  /** Top edge, from the top of the page. */
  yTop: number;
  h: number;
  color: string;
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  // Applies `a` first, then `b` (PDF row-vector convention).
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function asMatrix(value: unknown): Matrix | undefined {
  const source =
    Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as number[]) : [];
  if (
    source.length !== 6 ||
    !source.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
    return undefined;
  return source as unknown as Matrix;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as number[]) : [];
}

const BLACK = "#000000";

/**
 * Walks the page's drawing operators once for what text items do not say: the fill color of text and
 * the thin filled bars that draw rules and underlines. Anything unexpected (unknown transforms, tiling)
 * simply yields less information, never a different document.
 */
function scanOperators(
  operators: PdfOperatorList,
  ops: Readonly<Record<string, number>>,
  view: PdfPageLayoutInput["view"],
): { texts: TextRecord[]; rules: RuleRecord[] } {
  const texts: TextRecord[] = [];
  const rules: RuleRecord[] = [];
  const stack: Array<{ ctm: Matrix; fill: string; stroke: string; lineWidth: number }> = [];
  let ctm: Matrix = IDENTITY;
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let fill = BLACK;
  let stroke = BLACK;
  let lineWidth = 1;
  let positioned = false;
  let fontSize = 1;
  let charSpacing = 0;
  let wordSpacing = 0;
  let horizontalScale = 1;
  const count = Math.min(operators.fnArray.length, 400_000);
  for (let index = 0; index < count; index += 1) {
    const op = operators.fnArray[index];
    const args = operators.argsArray[index];
    const list = Array.isArray(args) ? (args as unknown[]) : [];
    switch (op) {
      case ops.save:
        stack.push({ ctm, fill, stroke, lineWidth });
        break;
      case ops.restore:
        {
          // Colors and line width belong to the graphics state, so they come back with it.
          const saved = stack.pop();
          if (saved) ({ ctm, fill, stroke, lineWidth } = saved);
        }
        break;
      case ops.transform: {
        const matrix = asMatrix(list) ?? asMatrix(list[0]);
        if (matrix) ctm = multiply(matrix, ctm);
        break;
      }
      case ops.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        positioned = false;
        break;
      case ops.setTextMatrix: {
        const matrix = asMatrix(list) ?? asMatrix(list[0]);
        if (matrix) {
          tm = matrix;
          tlm = matrix;
          positioned = true;
        }
        break;
      }
      case ops.moveText: {
        const [tx, ty] = numbers(list);
        tlm = multiply([1, 0, 0, 1, tx ?? 0, ty ?? 0], tlm);
        tm = tlm;
        positioned = true;
        break;
      }
      case ops.setLeadingMoveText: {
        const [tx, ty] = numbers(list);
        leading = -(ty ?? 0);
        tlm = multiply([1, 0, 0, 1, tx ?? 0, ty ?? 0], tlm);
        tm = tlm;
        positioned = true;
        break;
      }
      case ops.setLeading:
        leading = numbers(list)[0] ?? leading;
        break;
      case ops.setFont:
        fontSize = typeof list[1] === "number" ? list[1] : fontSize;
        break;
      case ops.setCharSpacing:
        charSpacing = numbers(list)[0] ?? charSpacing;
        break;
      case ops.setWordSpacing:
        wordSpacing = numbers(list)[0] ?? wordSpacing;
        break;
      case ops.setHScale:
        horizontalScale = (numbers(list)[0] ?? 100) / 100;
        break;
      case ops.nextLine:
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        positioned = true;
        break;
      case ops.setLineWidth:
        lineWidth = numbers(list)[0] ?? lineWidth;
        break;
      case ops.setStrokeRGBColor: {
        const value = typeof list[0] === "string" ? list[0].toLowerCase() : undefined;
        if (value && /^#[0-9a-f]{6}$/u.test(value)) stroke = value;
        break;
      }
      case ops.setFillRGBColor: {
        const value = typeof list[0] === "string" ? list[0].toLowerCase() : undefined;
        if (value && /^#[0-9a-f]{6}$/u.test(value)) fill = value;
        break;
      }
      case ops.showText:
      case ops.showSpacedText:
      case ops.nextLineShowText:
      case ops.nextLineSetSpacingShowText: {
        if (op === ops.nextLineShowText || op === ops.nextLineSetSpacingShowText) {
          tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
          positioned = true;
        }
        const glyphs = (op === ops.nextLineSetSpacingShowText ? list[2] : list[0]) as unknown;
        const text = Array.isArray(glyphs)
          ? glyphs
              .map((glyph: unknown) =>
                glyph &&
                typeof glyph === "object" &&
                typeof (glyph as { unicode?: unknown }).unicode === "string"
                  ? (glyph as { unicode: string }).unicode
                  : "",
              )
              .join("")
          : "";
        if (positioned) {
          const place = multiply(tm, ctm);
          texts.push({
            x: place[4] - view[0],
            yTop: view[3] - place[5],
            text,
            color: fill,
          });
          // The next show continues along the line from where this one ended.
          let advance = 0;
          if (Array.isArray(glyphs)) {
            for (const glyph of glyphs as unknown[]) {
              if (typeof glyph === "number") advance -= (glyph / 1000) * fontSize * horizontalScale;
              else if (glyph && typeof glyph === "object") {
                const { width, isSpace } = glyph as { width?: unknown; isSpace?: unknown };
                if (typeof width === "number")
                  advance +=
                    ((width / 1000) * fontSize +
                      charSpacing +
                      (isSpace === true ? wordSpacing : 0)) *
                    horizontalScale;
              }
            }
          }
          tm = multiply([1, 0, 0, 1, advance, 0], tm);
        }
        break;
      }
      case ops.constructPath: {
        const paint = list[0];
        const box = numbers(list[2]);
        const filled =
          paint === ops.fill ||
          paint === ops.eoFill ||
          paint === ops.fillStroke ||
          paint === ops.eoFillStroke;
        const stroked = paint === ops.stroke || paint === ops.closeStroke;
        if (box.length !== 4 || (!filled && !stroked)) break;
        // Bars are axis-aligned; the page's own flip (a negative vertical scale) is common.
        const [a, b, c, d] = ctm;
        if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || d === 0) break;
        const [left = 0, bottom = 0, right = 0, top = 0] = box;
        const xs = [left * a + ctm[4], right * a + ctm[4]];
        const ys = [bottom * d + ctm[5], top * d + ctm[5]];
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const yMin = Math.min(...ys);
        const yMax = Math.max(...ys);
        const thickness = filled ? yMax - yMin : lineWidth * Math.abs(d);
        // Only rules: wide, hairline bars (a stroked path must itself be a single horizontal line).
        if (thickness > 0 && thickness <= 4 && x1 - x0 >= 6 && (filled || yMax - yMin < 0.01)) {
          rules.push({
            x0: x0 - view[0],
            x1: x1 - view[0],
            yTop: view[3] - (filled ? yMax : yMax + thickness / 2),
            h: thickness,
            color: filled ? fill : stroke,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return { texts, rules };
}

const round = (value: number) => Math.round(value * 10) / 10;
const compact = (value: string) => value.replace(/\s+/gu, "");

function removeControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code > 31 && code !== 127) || code === 9 || code === 10 || code === 13)
      result += character;
  }
  return result;
}

const SERIF =
  /times|georgia|garamond|cambria|palatino|minion|baskerville|bodoni|didot|constantia|book antiqua|century|caslon|serif(?!.*sans)/iu;
const MONO = /courier|consolas|menlo|monaco|mono|typewriter|lucida console/iu;
const BOLD = /bold|black|heavy|semibold|demibold|extrabold/iu;
const ITALIC = /italic|oblique/iu;

function traitsOf(info: PdfFontTraits | undefined): Pick<LayoutRun, "bold" | "italic" | "family"> {
  const name = (info?.name ?? "").replace(/^[A-Z]{6}\+/u, "");
  const result: Pick<LayoutRun, "bold" | "italic" | "family"> = {};
  if (info?.bold || BOLD.test(name)) result.bold = true;
  if (info?.italic || ITALIC.test(name)) result.italic = true;
  // PDF.js's own monospace flag is unreliable (it marks Times New Roman as monospace), so the font's
  // name decides, and its serif flag is used only when the name says nothing.
  if (MONO.test(name)) result.family = "mono";
  else if (
    SERIF.test(name) ||
    (info?.serif && !/arial|helvetica|calibri|verdana|tahoma|segoe/iu.test(name))
  )
    result.family = "serif";
  return result;
}

interface Piece {
  text: string;
  x: number;
  xEnd: number;
  color: string;
}

/** Splits one text item where the fill color changes, when the drawing operators agree with its text. */
function pieces(item: PdfTextItem, itemX: number, records: readonly TextRecord[]): Piece[] {
  const end = itemX + item.width;
  const whole = (color: string): Piece[] => [{ text: item.str, x: itemX, xEnd: end, color }];
  const inside = records
    .filter((record) => record.x >= itemX - 1 && record.x <= end + 1)
    .sort((left, right) => left.x - right.x);
  if (inside.length === 0) return whole(BLACK);
  const colors = new Set(inside.map((record) => record.color));
  if (colors.size === 1) return whole(inside[0]?.color ?? BLACK);
  if (compact(inside.map((record) => record.text).join("")) !== compact(item.str))
    return whole(inside[0]?.color ?? BLACK);
  const groups: Array<{ color: string; x: number; text: string }> = [];
  for (const record of inside) {
    const last = groups.at(-1);
    if (last && (last.color === record.color || compact(record.text) === ""))
      last.text += record.text;
    else groups.push({ color: record.color, x: record.x, text: record.text });
  }
  const result: Piece[] = [];
  let cursor = 0;
  groups.forEach((group, groupIndex) => {
    const wanted = compact(group.text).length;
    let consumed = 0;
    let stop = cursor;
    while (stop < item.str.length && (consumed < wanted || groupIndex === groups.length - 1)) {
      if (!/\s/u.test(item.str[stop] ?? "")) consumed += 1;
      stop += 1;
    }
    const next = groups[groupIndex + 1];
    result.push({
      text: item.str.slice(cursor, stop),
      x: groupIndex === 0 ? itemX : group.x,
      xEnd: next ? next.x : end,
      color: group.color,
    });
    cursor = stop;
  });
  return result;
}

function runsOf(
  items: readonly PdfTextItem[],
  input: PdfPageLayoutInput,
  texts: readonly TextRecord[],
): { runs: LayoutRun[]; baseline: number } | undefined {
  const runs: LayoutRun[] = [];
  let baseline = Number.NaN;
  let longest = -1;
  let maximumSize = 0;
  const bounds: number[] = [];
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const [a, b, c, d, e, f] = item.transform;
    if (
      [a, b, c, d, e, f].some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
      Math.abs(b as number) > 1e-3 ||
      Math.abs(c as number) > 1e-3 ||
      (a as number) <= 0 ||
      !Number.isFinite(item.width) ||
      item.width < 0
    )
      return undefined;
    const size = Math.abs(d as number);
    if (size < LAYOUT_LIMITS.minSize || size > LAYOUT_LIMITS.maxSize) return undefined;
    const x = (e as number) - input.view[0];
    const yTop = input.view[3] - (f as number);
    bounds.push(yTop);
    if (item.str.length > longest) {
      longest = item.str.length;
      baseline = yTop;
    }
    maximumSize = Math.max(maximumSize, size);
    const traits = traitsOf(input.fontTraits(item.fontName));
    for (const piece of pieces(
      item,
      x,
      texts.filter((record) => Math.abs(record.yTop - yTop) < size * 0.4),
    )) {
      const raw = removeControlCharacters(piece.text);
      const span = piece.xEnd - piece.x;
      const perCharacter = raw.length > 0 ? span / raw.length : 0;
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim().replace(/\s+/gu, " ");
      if (text === "") continue;
      const run: LayoutRun = {
        x: round(piece.x + lead * perCharacter),
        w: round(Math.max(0, span - (raw.length - raw.trim().length) * perCharacter)),
        size: round(size),
        text,
        ...traits,
        ...(piece.color !== BLACK ? { color: piece.color } : {}),
      };
      runs.push(run);
    }
  }
  if (runs.length === 0 || !Number.isFinite(baseline)) return undefined;
  // Mixed baselines (columns, subscripts) are not something a flow of lines can reproduce.
  if (bounds.some((value) => Math.abs(value - baseline) > maximumSize * 0.6)) return undefined;
  runs.sort((left, right) => left.x - right.x);
  const joined = runs.map((run) => run.text).join(" ");
  if (canonicalizeLeadingBullet(joined) !== joined) {
    const first = runs[0];
    if (first) first.text = `•${first.text.slice(1)}`;
  }
  return { runs, baseline };
}

export interface PdfPageLayout {
  /** One entry per group, in order; absent for a group with no drawable text. */
  blocks: Array<BlockLayout | undefined>;
}

/**
 * The look of every text line of one page, or nothing when the page cannot be reproduced faithfully
 * (rotated, columnar, or text that cannot be matched to its lines). A document is laid out only when
 * every page is.
 */
export function layoutPdfPage(input: PdfPageLayoutInput): PdfPageLayout | undefined {
  if (input.rotate !== 0) return undefined;
  const scan = input.operators
    ? scanOperators(input.operators, input.ops, input.view)
    : { texts: [], rules: [] };
  const found = input.groups.map((items) => runsOf(items, input, scan.texts));
  const blocks: Array<BlockLayout | undefined> = [];
  for (const [index, group] of input.groups.entries()) {
    const result = found[index];
    if (!result) {
      if (group.some((item) => item.str.trim() !== "")) return undefined;
      blocks.push(undefined);
      continue;
    }
    blocks.push({ y: round(result.baseline), runs: result.runs });
  }
  const placed = blocks.flatMap((block, index) => (block ? [{ block, index }] : []));
  // Where the reading order jumps back up the page (a second column, a sidebar) a new zone starts. A
  // page that reads top to bottom has one zone and carries none, so existing output is unchanged; a
  // page with zones can be edited in place but never redrawn from layout, which would tangle them.
  let zone = 0;
  for (let index = 1; index < placed.length; index += 1) {
    const before = placed[index - 1]?.block;
    const after = placed[index]?.block;
    if (before && after && after.y < before.y - 1) zone += 1;
    if (zone >= LAYOUT_LIMITS.zonesPerPage) return undefined;
    if (zone > 0 && after) after.zone = zone;
  }
  for (const rule of scan.rules) {
    let best: { block: BlockLayout; gap: number } | undefined;
    for (const { block } of placed) {
      const gap = rule.yTop - block.y;
      // A heading's rule can sit well below it, after the heading's own spacing.
      if (gap < -1.5 || gap > 45) continue;
      const left = Math.min(...block.runs.map((run) => run.x));
      const right = Math.max(...block.runs.map((run) => run.x + run.w));
      if (rule.x1 <= left || rule.x0 >= right) continue;
      if (!best || gap < best.gap) best = { block, gap };
    }
    if (!best) continue;
    const entry: LayoutRule = {
      x0: round(rule.x0),
      x1: round(rule.x1),
      dy: round(rule.yTop - best.block.y),
      h: round(Math.max(0.1, rule.h)),
      ...(rule.color !== BLACK ? { color: rule.color } : {}),
    };
    if ((best.block.rules?.length ?? 0) < LAYOUT_LIMITS.rulesPerBlock)
      best.block.rules = [...(best.block.rules ?? []), entry];
  }
  return { blocks };
}

export function pageGeometryOf(view: PdfPageLayoutInput["view"]): PageGeometry {
  return { width: round(view[2] - view[0]), height: round(view[3] - view[1]) };
}
