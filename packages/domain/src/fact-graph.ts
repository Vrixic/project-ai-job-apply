/**
 * Candidate fact graph: a read-only view over Profile-owned facts that answers one question for
 * every generator and form filler - "is this claim backed by confirmed, currently usable evidence,
 * and how strongly?". It never invents, merges, or infers a fact.
 */

export type FactVerification = "proposed" | "confirmed" | "rejected";
export type FactSourceType = "user" | "resume" | "import" | "derived";

export interface FactEvidenceSpan {
  documentId: string;
  documentVersion: number;
  parserVersion: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  page?: number;
}

/** The subset of the version-one `ProfileFact` contract the graph reads. */
export interface GraphFact {
  id: string;
  kind: string;
  key: string;
  value: string | number | boolean | readonly string[];
  verification: FactVerification;
  sensitivity: "standard" | "confidential" | "restricted";
  source: { type: FactSourceType; reference: string };
  evidence?: { supportingSpans: readonly FactEvidenceSpan[] };
  availability?:
    | { state: "available" }
    | { state: "invalidated"; reasonCode: "source_security_hold" };
  effectiveFrom?: string;
  effectiveTo?: string;
  version: number;
}

export type FactUnusableReason =
  | "not_confirmed"
  | "rejected"
  | "invalidated"
  | "not_yet_effective"
  | "expired";

export type FactUsability =
  | { usable: true; confidence: number }
  | { usable: false; reason: FactUnusableReason };

/**
 * Deterministic provenance-based confidence. Candidate confirmation is required for use at all, so
 * these values rank how the confirmed fact originated, not whether it is trustworthy enough to skip
 * confirmation.
 *
 * - `user`: the candidate typed it: 1.00
 * - `resume`/`import` with supporting spans: 0.95; without spans: 0.90
 * - `derived`: 0.85 (below the default 0.90 review threshold, so always reviewed)
 */
export function factConfidence(fact: Pick<GraphFact, "source" | "evidence">): number {
  switch (fact.source.type) {
    case "user":
      return 1;
    case "resume":
    case "import":
      return fact.evidence && fact.evidence.supportingSpans.length > 0 ? 0.95 : 0.9;
    case "derived":
      return 0.85;
  }
}

export function factUsability(fact: GraphFact, now: Date): FactUsability {
  if (fact.verification === "rejected") return { usable: false, reason: "rejected" };
  if (fact.verification !== "confirmed") return { usable: false, reason: "not_confirmed" };
  if (fact.availability?.state === "invalidated") return { usable: false, reason: "invalidated" };
  const today = now.toISOString().slice(0, 10);
  if (fact.effectiveFrom && fact.effectiveFrom > today) {
    return { usable: false, reason: "not_yet_effective" };
  }
  if (fact.effectiveTo && fact.effectiveTo < today) return { usable: false, reason: "expired" };
  return { usable: true, confidence: factConfidence(fact) };
}

export interface Claim {
  /** The generated statement. It is never parsed or trusted; only its evidence is checked. */
  text: string;
  factIds: readonly string[];
}

export type ClaimGrounding =
  | { grounded: true; factIds: readonly string[]; confidence: number }
  | {
      grounded: false;
      reason: "no_evidence" | "unknown_fact" | FactUnusableReason;
      factId?: string;
    };

export class FactGraph {
  private readonly byId = new Map<string, GraphFact>();
  private readonly byBlock = new Map<string, Set<string>>();

  private constructor(
    facts: readonly GraphFact[],
    private readonly now: Date,
  ) {
    for (const fact of facts) {
      const existing = this.byId.get(fact.id);
      // Facts are append-only versions; only the highest version of an id is current.
      if (existing && existing.version >= fact.version) continue;
      this.byId.set(fact.id, fact);
    }
    for (const fact of this.byId.values()) {
      for (const span of fact.evidence?.supportingSpans ?? []) {
        const block = blockKey(span);
        const members = this.byBlock.get(block) ?? new Set<string>();
        members.add(fact.id);
        this.byBlock.set(block, members);
      }
    }
  }

  static build(facts: readonly GraphFact[], now: Date): FactGraph {
    return new FactGraph(facts, now);
  }

  get(id: string): GraphFact | undefined {
    return this.byId.get(id);
  }

  usability(id: string): FactUsability | undefined {
    const fact = this.byId.get(id);
    return fact ? factUsability(fact, this.now) : undefined;
  }

  /** All currently usable facts of a kind, optionally narrowed to one key, in stable id order. */
  usable(kind: string, key?: string): GraphFact[] {
    return [...this.byId.values()]
      .filter(
        (fact) =>
          fact.kind === kind &&
          (key === undefined || fact.key === key) &&
          factUsability(fact, this.now).usable,
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Facts that share a supporting block with `id`. They are provenance neighbours, not inferred
   * relationships: a neighbour only says the same source text evidences both.
   */
  neighbors(id: string): GraphFact[] {
    const fact = this.byId.get(id);
    if (!fact) return [];
    const related = new Set<string>();
    for (const span of fact.evidence?.supportingSpans ?? []) {
      for (const member of this.byBlock.get(blockKey(span)) ?? []) {
        if (member !== id) related.add(member);
      }
    }
    return [...related]
      .sort()
      .map((relatedId) => this.byId.get(relatedId))
      .filter((candidate): candidate is GraphFact => candidate !== undefined);
  }

  /**
   * A claim is grounded only when it cites at least one fact and every cited fact exists, is
   * confirmed, and is currently usable. Its confidence is the weakest cited fact.
   */
  ground(claim: Claim): ClaimGrounding {
    if (claim.factIds.length === 0) return { grounded: false, reason: "no_evidence" };
    let confidence = 1;
    for (const factId of claim.factIds) {
      const fact = this.byId.get(factId);
      if (!fact) return { grounded: false, reason: "unknown_fact", factId };
      const usability = factUsability(fact, this.now);
      if (!usability.usable) return { grounded: false, reason: usability.reason, factId };
      confidence = Math.min(confidence, usability.confidence);
    }
    return { grounded: true, factIds: [...new Set(claim.factIds)].sort(), confidence };
  }
}

function blockKey(span: FactEvidenceSpan): string {
  return `${span.documentId}:${span.documentVersion}:${span.blockIndex}`;
}
