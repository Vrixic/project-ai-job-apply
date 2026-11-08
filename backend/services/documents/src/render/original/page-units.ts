import {
  expandWrappers,
  type Group,
  IDENTITY,
  type Matrix,
  multiply,
  nameOf,
  numberOf,
  type Operation,
  topLevelGroups,
} from "./content-stream.js";
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

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

const PAINT_OPERATORS = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s"]);
const END_PATH = new Set(["n"]);
const PATH_OPERATORS = new Set(["m", "l", "c", "v", "y", "h", "re"]);
/** Operations that may stand outside every unit without changing where anything is. */
const HARMLESS_LOOSE = new Set([
  // A top-level matrix: expandWrappers has already folded it into every later unit's base matrix.
  "cm",
  "q",
  "Q",
  "re",
  "W",
  "W*",
  "n",
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
/** Text positioning that this editor does not follow. `Td` and `TD` are followed (see `measure`). */
const UNFOLLOWED_TEXT = new Set(["T*", "'", '"']);

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
  const base: Matrix = group.matrix ?? IDENTITY;
  const stack: Matrix[] = [];
  let ctm: Matrix = base;
  let path: Array<[number, number]> = [];
  let fontSize = 0;
  let inText = false;
  // The text matrix and the start of the current text line, which `Td` moves relative to.
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  for (const operation of group.ops) {
    const op = operation.op;
    if (op === "q") {
      stack.push(ctm);
      continue;
    }
    if (op === "Q") {
      ctm = stack.pop() ?? base;
      continue;
    }
    if (op === "cm") {
      const [a, b, c, d, e, f] = numbers(bytes, operation, 6) as Matrix;
      ctm = multiply([a, b, c, d, e, f], ctm);
      continue;
    }
    if (op === "BT") {
      inText = true;
      tm = IDENTITY;
      tlm = IDENTITY;
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
        tm = numbers(bytes, operation, 6) as Matrix;
        tlm = tm;
      } else if (op === "Td" || op === "TD") {
        const [tx = 0, ty = 0] = numbers(bytes, operation, 2);
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm;
      } else if (op === "Tj" || op === "TJ") {
        // Where the shown text starts, through the text matrix and the page's own matrix.
        const [x, y] = apply(ctm, tm[4], tm[5]);
        const scale = Math.hypot(tm[0], tm[1]) * Math.hypot(ctm[0], ctm[1]);
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
  const groups = expandWrappers(bytes, topLevelGroups(all));
  const info = groups.map((group) => {
    if (group.loose) {
      // Text, a path or an image outside every unit cannot be moved with its line.
      if (!group.ops.every((operation) => HARMLESS_LOOSE.has(operation.op)))
        throw new OriginalEditUnsupported("AMBIGUOUS_GRAPHIC");
      return { texts: [], paints: [], xobjects: [] } satisfies GroupInfo;
    }
    return measure(bytes, group);
  });
  return { groups, info };
}
