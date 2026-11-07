import { type Group, nameOf, numberOf, type Operation, topLevelGroups } from "./content-stream.js";
import { OriginalEditUnsupported } from "./errors.js";

/** Where something sits on the page, in the page's own coordinates (origin bottom left). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextAnchor {
  /** Where the text object's first line starts. */
  x: number;
  /** Its baseline. */
  y: number;
  size: number;
}

export interface GroupInfo {
  texts: TextAnchor[];
  /** Bounds of everything painted (filled or stroked paths, images) by this group. */
  paints: Rect[];
  /** Resource names of XObjects this group paints. */
  xobjects: string[];
}

export interface PageUnits {
  groups: Group[];
  info: GroupInfo[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `next` applied first, then `current` (PDF's `cm`: the new matrix pre-multiplies the old one). */
function multiply(next: Matrix, current: Matrix): Matrix {
  const [a, b, c, d, e, f] = next;
  const [a2, b2, c2, d2, e2, f2] = current;
  return [
    a * a2 + b * c2,
    a * b2 + b * d2,
    c * a2 + d * c2,
    c * b2 + d * d2,
    e * a2 + f * c2 + e2,
    e * b2 + f * d2 + f2,
  ];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

const PAINT_OPERATORS = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s"]);
const END_PATH = new Set(["n"]);
const PATH_OPERATORS = new Set(["m", "l", "c", "v", "y", "h", "re"]);
/** Operations that may stand outside every `q ... Q` without changing where anything is. */
const HARMLESS_LOOSE = new Set([
  "gs",
  "cs",
  "CS",
  "sc",
  "SC",
  "scn",
  "SCN",
  "g",
  "G",
  "rg",
  "RG",
  "k",
  "K",
  "w",
  "J",
  "j",
  "M",
  "d",
  "i",
  "ri",
  "BDC",
  "BMC",
  "EMC",
  "MP",
  "DP",
]);
/** Text positioning that this editor does not follow (it moves text by whole text matrices only). */
const UNFOLLOWED_TEXT = new Set(["Td", "TD", "T*", "'", '"']);

function numbers(bytes: Uint8Array, operation: Operation, count: number): number[] {
  if (operation.operands.length < count) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return operation.operands.slice(-count).map((token) => numberOf(bytes, token));
}

function unionRect(points: ReadonlyArray<readonly [number, number]>): Rect | undefined {
  if (points.length === 0) return undefined;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function measure(bytes: Uint8Array, group: Group): GroupInfo {
  const info: GroupInfo = { texts: [], paints: [], xobjects: [] };
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let path: Array<[number, number]> = [];
  let fontSize = 0;
  let inText = false;
  for (const operation of group.ops) {
    const op = operation.op;
    if (op === "q") {
      stack.push(ctm);
      continue;
    }
    if (op === "Q") {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (op === "cm") {
      const [a, b, c, d, e, f] = numbers(bytes, operation, 6) as Matrix;
      ctm = multiply([a, b, c, d, e, f], ctm);
      continue;
    }
    if (op === "BT") {
      inText = true;
      continue;
    }
    if (op === "ET") {
      inText = false;
      continue;
    }
    if (inText || op === "Tf" || op === "Tm" || op === "Tj" || op === "TJ") {
      if (UNFOLLOWED_TEXT.has(op)) throw new OriginalEditUnsupported("UNSUPPORTED_TEXT_STATE");
      if (op === "Tf") {
        const size = operation.operands.at(-1);
        fontSize = Math.abs(numberOf(bytes, size));
      } else if (op === "Tm") {
        const [a, b, , , e, f] = numbers(bytes, operation, 6) as Matrix;
        const [x, y] = apply(ctm, e, f);
        const scale = Math.hypot(a, b) * Math.hypot(ctm[0], ctm[1]);
        info.texts.push({ x, y, size: Math.max(fontSize * (scale || 1), 1) });
      }
      continue;
    }
    if (op === "re") {
      const [x = 0, y = 0, w = 0, h = 0] = numbers(bytes, operation, 4);
      for (const [px, py] of [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ] as const)
        path.push(apply(ctm, px, py));
      continue;
    }
    if (PATH_OPERATORS.has(op)) {
      if (op === "h") continue;
      const count = op === "m" || op === "l" ? 2 : op === "c" ? 6 : 4;
      const values = numbers(bytes, operation, count);
      for (let index = 0; index + 1 < values.length; index += 2)
        path.push(apply(ctm, values[index] ?? 0, values[index + 1] ?? 0));
      continue;
    }
    if (PAINT_OPERATORS.has(op)) {
      const rect = unionRect(path);
      if (rect) info.paints.push(rect);
      path = [];
      continue;
    }
    if (END_PATH.has(op)) {
      path = [];
      continue;
    }
    if (op === "Do") {
      info.xobjects.push(nameOf(bytes, operation.operands.at(-1)));
      const rect = unionRect([
        apply(ctm, 0, 0),
        apply(ctm, 1, 0),
        apply(ctm, 1, 1),
        apply(ctm, 0, 1),
      ]);
      if (rect) info.paints.push(rect);
      continue;
    }
    if (op === "BI-IMAGE") {
      const rect = unionRect([
        apply(ctm, 0, 0),
        apply(ctm, 1, 0),
        apply(ctm, 1, 1),
        apply(ctm, 0, 1),
      ]);
      if (rect) info.paints.push(rect);
      continue;
    }
    if (op === "sh") {
      // A shading paints the whole clip: treat as a background, which never moves.
      info.paints.push({ x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
    }
  }
  if (stack.length !== 0) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return info;
}

/** Splits a page's operations into their top-level blocks and says where each one draws. */
export function pageUnits(bytes: Uint8Array, all: readonly Operation[]): PageUnits {
  const groups = topLevelGroups(all);
  const info = groups.map((group) => {
    if (group.loose) {
      // Text, a path or an image outside every q ... Q cannot be moved with its line.
      const operation = group.ops[0];
      if (!operation || !HARMLESS_LOOSE.has(operation.op))
        throw new OriginalEditUnsupported("AMBIGUOUS_GRAPHIC");
      return { texts: [], paints: [], xobjects: [] } satisfies GroupInfo;
    }
    return measure(bytes, group);
  });
  return { groups, info };
}
