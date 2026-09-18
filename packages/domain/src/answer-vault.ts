/**
 * Restricted answer vault rules (ADR-010). A stored answer is only ever reused for a semantically
 * identical question: the exact field key, and the exact context when one was recorded. Reuse never
 * happens silently; the caller must still show the value in the final review.
 */

export interface VaultEntryState {
  id: string;
  fieldKey: string;
  /** Optional narrowing such as a jurisdiction. An entry without context matches only context-free questions. */
  context?: string;
  sensitivity: "standard" | "confidential" | "restricted";
  /** When the candidate supplied and chose to save this value. */
  confirmedAt: Date;
  expiresAt?: Date;
  version: number;
  state: "active" | "deleted";
}

export type VaultMatch<T extends VaultEntryState = VaultEntryState> =
  | { kind: "match"; entry: T }
  | { kind: "none"; reason: "no_entry" | "deleted" | "expired" | "context_mismatch" | "ambiguous" };

export interface VaultQuestion {
  fieldKey: string;
  context?: string;
}

/** Keys the vault refuses to hold: consent artifacts must always be given fresh. */
const NEVER_STORED_PREFIXES = ["attestation.", "signature.", "challenge.", "captcha.", "mfa."];

export function isVaultStorable(fieldKey: string): boolean {
  return !NEVER_STORED_PREFIXES.some((prefix) => fieldKey.startsWith(prefix));
}

/**
 * Picks the single reusable entry for a question. Entries are append-only versions; only the
 * highest version per id counts, so a corrected or deleted answer can never be resurrected by a
 * queued workflow that still holds an older version.
 */
export function matchVaultEntry<T extends VaultEntryState>(
  entries: readonly T[],
  question: VaultQuestion,
  now: Date,
): VaultMatch<T> {
  const current = new Map<string, T>();
  for (const entry of entries) {
    const existing = current.get(entry.id);
    if (!existing || entry.version > existing.version) current.set(entry.id, entry);
  }
  const sameKey = [...current.values()].filter((entry) => entry.fieldKey === question.fieldKey);
  if (sameKey.length === 0) return { kind: "none", reason: "no_entry" };
  const sameContext = sameKey.filter((entry) => entry.context === question.context);
  if (sameContext.length === 0) return { kind: "none", reason: "context_mismatch" };
  const active = sameContext.filter((entry) => entry.state === "active");
  if (active.length === 0) return { kind: "none", reason: "deleted" };
  const fresh = active.filter((entry) => !entry.expiresAt || entry.expiresAt > now);
  if (fresh.length === 0) return { kind: "none", reason: "expired" };
  if (fresh.length > 1) return { kind: "none", reason: "ambiguous" };
  return { kind: "match", entry: fresh[0] as T };
}
