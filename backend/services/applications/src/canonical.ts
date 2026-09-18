import { createHash } from "node:crypto";

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class NonCanonicalValueError extends Error {
  constructor(reason: string) {
    super(`Value cannot be canonicalized: ${reason}`);
    this.name = "NonCanonicalValueError";
  }
}

/**
 * Deterministic JSON: object keys are sorted, numbers must be finite, and undefined, bigint,
 * function, symbol, and non-plain-object values are refused so a hash can never depend on
 * runtime-specific serialization.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, 0);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function serialize(value: unknown, depth: number): string {
  if (depth > 32) throw new NonCanonicalValueError("nesting exceeds 32 levels");
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new NonCanonicalValueError("non-finite number");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new NonCanonicalValueError(`unsupported ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item, depth + 1)).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NonCanonicalValueError("non-plain object");
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry, depth + 1)}`)
    .join(",")}}`;
}
