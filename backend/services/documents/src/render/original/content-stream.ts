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
  /** True for a single operation that sits outside every `q ... Q` and draws nothing. */
  loose: boolean;
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
