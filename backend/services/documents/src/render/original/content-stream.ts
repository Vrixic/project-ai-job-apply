import { OriginalEditUnsupported } from "./errors.js";

/**
 * A bounded reader for the one thing the original-page editor needs from a page: its content stream
 * as operations, grouped by the `q ... Q` blocks the exporting program wrote. Nothing here
 * interprets fonts or draws; it only finds where text, paths and images begin and end so whole
 * blocks can be dropped or moved. Anything it cannot read exactly makes the whole edit unsupported.
 */

export const CONTENT_LIMITS = {
  bytes: 3_000_000,
  tokens: 600_000,
  operations: 200_000,
  nesting: 32,
  operandsPerOperation: 6_000,
} as const;

export type TokenKind =
  | "number"
  | "name"
  | "string"
  | "hex"
  | "array-open"
  | "array-close"
  | "dict-open"
  | "dict-close"
  | "operator";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
}

export interface Operation {
  /** The operator, or `BI-IMAGE` for a whole inline image. */
  op: string;
  operands: Token[];
  start: number;
  end: number;
}

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/u;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index] ?? 0);
  return text;
}

export function tokenize(bytes: Uint8Array): Token[] {
  if (bytes.byteLength > CONTENT_LIMITS.bytes)
    throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
  const tokens: Token[] = [];
  const length = bytes.byteLength;
  let index = 0;
  const push = (kind: TokenKind, start: number, end: number) => {
    if (tokens.length >= CONTENT_LIMITS.tokens)
      throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
    tokens.push({ kind, start, end });
  };
  while (index < length) {
    const byte = bytes[index] ?? 0;
    if (WHITESPACE.has(byte)) {
      index += 1;
      continue;
    }
    if (byte === 0x25) {
      while (index < length && bytes[index] !== 10 && bytes[index] !== 13) index += 1;
      continue;
    }
    const start = index;
    if (byte === 0x28) {
      let depth = 1;
      index += 1;
      while (index < length && depth > 0) {
        const inner = bytes[index];
        if (inner === 0x5c) index += 2;
        else {
          if (inner === 0x28) depth += 1;
          else if (inner === 0x29) depth -= 1;
          index += 1;
        }
      }
      if (depth !== 0) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
      push("string", start, index);
      continue;
    }
    if (byte === 0x3c && bytes[index + 1] === 0x3c) {
      index += 2;
      push("dict-open", start, index);
      continue;
    }
    if (byte === 0x3e && bytes[index + 1] === 0x3e) {
      index += 2;
      push("dict-close", start, index);
      continue;
    }
    if (byte === 0x3c) {
      index += 1;
      while (index < length && bytes[index] !== 0x3e) index += 1;
      if (index >= length) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
      index += 1;
      push("hex", start, index);
      continue;
    }
    if (byte === 0x5b || byte === 0x5d) {
      index += 1;
      push(byte === 0x5b ? "array-open" : "array-close", start, index);
      continue;
    }
    if (byte === 0x2f) {
      index += 1;
      while (
        index < length &&
        !WHITESPACE.has(bytes[index] ?? 0) &&
        !DELIMITERS.has(bytes[index] ?? 0)
      )
        index += 1;
      push("name", start, index);
      continue;
    }
    if (byte === 0x29 || byte === 0x3e || byte === 0x7b || byte === 0x7d)
      throw new OriginalEditUnsupported("CONTENT_MALFORMED");
    while (
      index < length &&
      !WHITESPACE.has(bytes[index] ?? 0) &&
      !DELIMITERS.has(bytes[index] ?? 0)
    )
      index += 1;
    const word = ascii(bytes, start, index);
    if (NUMBER.test(word)) push("number", start, index);
    else if (word === "BI") {
      // An inline image carries binary data: take it whole, through its `EI`.
      const rest = ascii(bytes, index, Math.min(length, index + CONTENT_LIMITS.bytes));
      const match = /\sEI(?=\s|$)/u.exec(rest);
      if (!match) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
      index += match.index + match[0].length;
      push("operator", start, index);
    } else push("operator", start, index);
  }
  return tokens;
}

export function operations(bytes: Uint8Array, tokens: readonly Token[]): Operation[] {
  const result: Operation[] = [];
  let operands: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "array-open" || token.kind === "dict-open") depth += 1;
    if (token.kind === "array-close" || token.kind === "dict-close") depth -= 1;
    if (depth < 0) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
    if (token.kind === "operator" && depth === 0) {
      const text = ascii(bytes, token.start, Math.min(token.end, token.start + 2));
      const op = text === "BI" ? "BI-IMAGE" : ascii(bytes, token.start, token.end);
      if (result.length >= CONTENT_LIMITS.operations)
        throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
      result.push({
        op,
        operands,
        start: operands[0]?.start ?? token.start,
        end: token.end,
      });
      operands = [];
    } else {
      if (operands.length >= CONTENT_LIMITS.operandsPerOperation)
        throw new OriginalEditUnsupported("CONTENT_TOO_LARGE");
      operands.push(token);
    }
  }
  if (depth !== 0 || operands.length > 0) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return result;
}

export function numberOf(bytes: Uint8Array, token: Token | undefined): number {
  if (token?.kind !== "number") throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  const value = Number.parseFloat(ascii(bytes, token.start, token.end));
  if (!Number.isFinite(value)) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return value;
}

export function nameOf(bytes: Uint8Array, token: Token | undefined): string {
  if (token?.kind !== "name") throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return ascii(bytes, token.start, token.end);
}

/**
 * One top-level block: a `q ... Q` pair, a path that is drawn outside any pair (an underline or rule
 * written as `re ... f*`), or a single other operation outside every pair (a color, line width or
 * marked-content marker), which is "loose".
 */
export interface Group {
  ops: Operation[];
  start: number;
  end: number;
  /**
   * True for operations that sit outside every unit and draw nothing: a color or marker, or the head,
   * glue and tail of a wrapper (`q`, a clip, `Q`) whose children are the units.
   */
  loose: boolean;
  /**
   * The colors and clip a unit inherits from the glue before it (set by expandWrappers). Text moves
   * only between places with the same state.
   */
  state?: string;
}

const PATH_BUILDERS = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const PATH_CLIPS = new Set(["W", "W*"]);
const PATH_ENDERS = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s", "n"]);

export function topLevelGroups(all: readonly Operation[]): Group[] {
  const groups: Group[] = [];
  let depth = 0;
  let current: Group | undefined;
  let path: Operation[] = [];
  const flushLoose = () => {
    // A path that never reached a painting or ending operation is malformed.
    if (path.length > 0) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  };
  for (const operation of all) {
    if (operation.op === "q") {
      flushLoose();
      if (depth === 0)
        current = { ops: [], start: operation.start, end: operation.end, loose: false };
      depth += 1;
      if (depth > CONTENT_LIMITS.nesting) throw new OriginalEditUnsupported("CONTENT_MALFORMED");
    }
    if (current) {
      current.ops.push(operation);
      current.end = operation.end;
    } else if (
      PATH_BUILDERS.has(operation.op) ||
      (path.length > 0 && PATH_CLIPS.has(operation.op))
    ) {
      path.push(operation);
    } else if (path.length > 0 && PATH_ENDERS.has(operation.op)) {
      path.push(operation);
      groups.push({
        ops: path,
        start: path[0]?.start ?? operation.start,
        end: operation.end,
        loose: false,
      });
      path = [];
    } else {
      if (operation.op === "Q") throw new OriginalEditUnsupported("CONTENT_MALFORMED");
      flushLoose();
      groups.push({ ops: [operation], start: operation.start, end: operation.end, loose: true });
    }
    if (operation.op === "Q") {
      depth -= 1;
      if (depth === 0 && current) {
        groups.push(current);
        current = undefined;
      }
    }
  }
  if (depth !== 0 || current || path.length > 0)
    throw new OriginalEditUnsupported("CONTENT_MALFORMED");
  return groups;
}

/** Operations a wrapper may carry itself besides state: markers that group children but draw nothing. */
const WRAPPER_OWN = new Set(["BDC", "BMC", "EMC", "MP", "DP"]);
/** Graphics state an inheriting child depends on. */
const STATE_OPS = new Set([
  "g",
  "G",
  "rg",
  "RG",
  "k",
  "K",
  "cs",
  "CS",
  "sc",
  "SC",
  "scn",
  "SCN",
  "gs",
  "w",
  "J",
  "j",
  "M",
  "d",
  "i",
  "ri",
]);
const PATH_BUILD = new Set(["m", "l", "c", "v", "y", "h", "re", "W", "W*"]);
const PAINT_END = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s"]);

type State = Map<string, string>;
const stateKey = (state: State): string => JSON.stringify([...state.entries()].sort());

function piece(ops: Operation[]): Group | undefined {
  const first = ops[0];
  const last = ops.at(-1);
  if (!first || !last) return undefined;
  return { ops, start: first.start, end: last.end, loose: true };
}

/**
 * Opens a wrapper: a `q ... Q` that sets state (a clip, colors) and holds self-contained `q ... Q`
 * children and small filled shapes of its own. The wrapper's head, the glue between its parts and its
 * tail stay exactly where they are; each child and each shape becomes a unit that can be dropped or
 * moved alone. A wrapper that changes the matrix, shows text itself or does anything else is not
 * opened (it stays one unit).
 */
function openWrapper(bytes: Uint8Array, group: Group, inherited: State): Group[] | undefined {
  if (group.ops[0]?.op !== "q" || group.ops.at(-1)?.op !== "Q") return undefined;
  const state: State = new Map(inherited);
  const out: Group[] = [];
  let depth = 0;
  let glueFrom = 0;
  let childFrom = -1;
  let pathFrom = -1;
  let clip = state.get("clip") ?? "";
  let units = 0;
  const flushGlue = (upTo: number) => {
    const glue = piece(group.ops.slice(glueFrom, upTo));
    if (glue) out.push(glue);
  };
  for (let index = 0; index < group.ops.length; index += 1) {
    const operation = group.ops[index];
    if (!operation) return undefined;
    const name = operation.op;
    if (name === "q") {
      if (depth === 1) {
        if (pathFrom >= 0) return undefined;
        childFrom = index;
      }
      depth += 1;
      continue;
    }
    if (name === "Q") {
      depth -= 1;
      if (depth === 1 && childFrom >= 0) {
        flushGlue(childFrom);
        const ops = group.ops.slice(childFrom, index + 1);
        const first = ops[0];
        const last = ops.at(-1);
        if (!first || !last) return undefined;
        const child: Group = { ops, start: first.start, end: last.end, loose: false };
        out.push(...(openWrapper(bytes, child, state) ?? [{ ...child, state: stateKey(state) }]));
        units += 1;
        glueFrom = index + 1;
        childFrom = -1;
      }
      continue;
    }
    if (depth !== 1) continue;
    if (PATH_BUILD.has(name)) {
      if (pathFrom < 0) pathFrom = index;
      continue;
    }
    if (name === "n" && pathFrom >= 0) {
      const from = group.ops[pathFrom];
      if (!from) return undefined;
      clip += `${ascii(bytes, from.start, operation.end)};`;
      state.set("clip", clip);
      pathFrom = -1;
      continue;
    }
    if (PAINT_END.has(name) && pathFrom >= 0) {
      flushGlue(pathFrom);
      const ops = group.ops.slice(pathFrom, index + 1);
      const first = ops[0];
      if (!first) return undefined;
      out.push({
        ops,
        start: first.start,
        end: operation.end,
        loose: false,
        state: stateKey(state),
      });
      units += 1;
      glueFrom = index + 1;
      pathFrom = -1;
      continue;
    }
    if (STATE_OPS.has(name)) {
      state.set(name, ascii(bytes, operation.start, operation.end));
      continue;
    }
    if (WRAPPER_OWN.has(name)) continue;
    return undefined;
  }
  if (units === 0 || pathFrom >= 0 || depth !== 0) return undefined;
  flushGlue(group.ops.length);
  return out;
}

/**
 * Splits every top-level group that is a wrapper into its parts, and records for each unit the
 * graphics state (colors, clip) it inherits where it stands. Text may later be moved to another
 * place in the stream only where that state is the same, so reordering never changes how it paints.
 */
export function expandWrappers(bytes: Uint8Array, groups: readonly Group[]): Group[] {
  const result: Group[] = [];
  const top: State = new Map();
  for (const group of groups) {
    const only = group.ops[0];
    if (group.loose) {
      if (group.ops.length === 1 && only && STATE_OPS.has(only.op))
        top.set(only.op, ascii(bytes, only.start, only.end));
      result.push(group);
      continue;
    }
    result.push(...(openWrapper(bytes, group, top) ?? [{ ...group, state: stateKey(top) }]));
  }
  return result;
}
