import { describe, expect, it } from "vitest";
import { isVaultStorable, matchVaultEntry, type VaultEntryState } from "./answer-vault.js";
import { FactGraph, factConfidence, factUsability, type GraphFact } from "./fact-graph.js";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const DOCUMENT = "019d04cf-1f80-7000-8000-000000000001";

function fact(id: string, overrides: Partial<GraphFact> = {}): GraphFact {
  return {
    id,
    kind: "skill",
    key: "skill",
    value: "TypeScript",
    verification: "confirmed",
    sensitivity: "standard",
    source: { type: "user", reference: "direct-entry" },
    version: 1,
    ...overrides,
  };
}

const span = (blockIndex: number, startOffset = 0) => ({
  supportingSpans: [
    {
      documentId: DOCUMENT,
      documentVersion: 1,
      parserVersion: "parser-1",
      blockIndex,
      startOffset,
      endOffset: startOffset + 5,
    },
  ],
});

describe("fact usability and confidence", () => {
  it("uses only confirmed, available, currently effective facts", () => {
    expect(factUsability(fact("a"), NOW)).toEqual({ usable: true, confidence: 1 });
    expect(factUsability(fact("a", { verification: "proposed" }), NOW)).toEqual({
      usable: false,
      reason: "not_confirmed",
    });
    expect(factUsability(fact("a", { verification: "rejected" }), NOW)).toMatchObject({
      reason: "rejected",
    });
    expect(
      factUsability(
        fact("a", { availability: { state: "invalidated", reasonCode: "source_security_hold" } }),
        NOW,
      ),
    ).toMatchObject({ reason: "invalidated" });
    expect(factUsability(fact("a", { effectiveFrom: "2026-09-19" }), NOW)).toMatchObject({
      reason: "not_yet_effective",
    });
    expect(factUsability(fact("a", { effectiveTo: "2026-09-17" }), NOW)).toMatchObject({
      reason: "expired",
    });
    expect(factUsability(fact("a", { effectiveTo: "2026-09-18" }), NOW).usable).toBe(true);
  });

  it("ranks confidence by provenance, with derived facts below the review threshold", () => {
    expect(factConfidence(fact("a"))).toBe(1);
    expect(
      factConfidence(fact("a", { source: { type: "resume", reference: "d" }, evidence: span(0) })),
    ).toBe(0.95);
    expect(factConfidence(fact("a", { source: { type: "resume", reference: "d" } }))).toBe(0.9);
    expect(factConfidence(fact("a", { source: { type: "derived", reference: "d" } }))).toBeLessThan(
      0.9,
    );
  });
});

describe("FactGraph", () => {
  it("keeps only the highest version of a fact and excludes unusable ones from lookups", () => {
    const graph = FactGraph.build(
      [
        fact("a", { value: "old", version: 1 }),
        fact("a", { value: "new", version: 2 }),
        fact("b", { verification: "proposed" }),
        fact("c", { kind: "employment", key: "employer" }),
      ],
      NOW,
    );
    expect(graph.get("a")?.value).toBe("new");
    expect(graph.usable("skill").map((entry) => entry.id)).toEqual(["a"]);
    expect(graph.usable("employment", "employer").map((entry) => entry.id)).toEqual(["c"]);
    expect(graph.usable("employment", "title")).toEqual([]);
  });

  it("reports provenance neighbours, not inferred relationships", () => {
    const graph = FactGraph.build(
      [
        fact("a", { evidence: span(3, 0) }),
        fact("b", { evidence: span(3, 20) }),
        fact("c", { evidence: span(4) }),
        fact("d"),
      ],
      NOW,
    );
    expect(graph.neighbors("a").map((entry) => entry.id)).toEqual(["b"]);
    expect(graph.neighbors("c")).toEqual([]);
    expect(graph.neighbors("d")).toEqual([]);
    expect(graph.neighbors("missing")).toEqual([]);
  });

  it("grounds a claim only when every cited fact is confirmed and usable", () => {
    const graph = FactGraph.build(
      [
        fact("a"),
        fact("b", { source: { type: "derived", reference: "x" } }),
        fact("c", { verification: "proposed" }),
        fact("d", { effectiveTo: "2020-01-01" }),
      ],
      NOW,
    );
    expect(graph.ground({ text: "Built X", factIds: ["a"] })).toEqual({
      grounded: true,
      factIds: ["a"],
      confidence: 1,
    });
    expect(graph.ground({ text: "Built X", factIds: ["b", "a", "a"] })).toEqual({
      grounded: true,
      factIds: ["a", "b"],
      confidence: 0.85,
    });
    expect(graph.ground({ text: "Built X", factIds: [] })).toEqual({
      grounded: false,
      reason: "no_evidence",
    });
    expect(graph.ground({ text: "Built X", factIds: ["a", "missing"] })).toEqual({
      grounded: false,
      reason: "unknown_fact",
      factId: "missing",
    });
    expect(graph.ground({ text: "Built X", factIds: ["c"] })).toMatchObject({
      grounded: false,
      reason: "not_confirmed",
    });
    expect(graph.ground({ text: "Built X", factIds: ["d"] })).toMatchObject({
      grounded: false,
      reason: "expired",
    });
  });
});

describe("answer vault matching", () => {
  const entry = (overrides: Partial<VaultEntryState> = {}): VaultEntryState => ({
    id: "v1",
    fieldKey: "authorization.us_authorized",
    sensitivity: "restricted",
    confirmedAt: new Date("2026-09-01T00:00:00Z"),
    version: 1,
    state: "active",
    ...overrides,
  });
  const question = { fieldKey: "authorization.us_authorized" };

  it("matches only an identical question", () => {
    expect(matchVaultEntry([entry()], question, NOW)).toMatchObject({ kind: "match" });
    expect(
      matchVaultEntry([entry()], { fieldKey: "authorization.sponsorship_required" }, NOW),
    ).toEqual({ kind: "none", reason: "no_entry" });
    expect(matchVaultEntry([], question, NOW)).toEqual({ kind: "none", reason: "no_entry" });
  });

  it("requires the recorded context to match exactly", () => {
    const scoped = entry({ context: "US" });
    expect(matchVaultEntry([scoped], { ...question, context: "US" }, NOW).kind).toBe("match");
    expect(matchVaultEntry([scoped], { ...question, context: "CA" }, NOW)).toEqual({
      kind: "none",
      reason: "context_mismatch",
    });
    expect(matchVaultEntry([scoped], question, NOW)).toEqual({
      kind: "none",
      reason: "context_mismatch",
    });
    expect(matchVaultEntry([entry()], { ...question, context: "US" }, NOW)).toEqual({
      kind: "none",
      reason: "context_mismatch",
    });
  });

  it("never resurrects a deleted or superseded answer, and refuses expired or ambiguous ones", () => {
    expect(
      matchVaultEntry([entry(), entry({ version: 2, state: "deleted" })], question, NOW),
    ).toEqual({ kind: "none", reason: "deleted" });
    expect(
      matchVaultEntry(
        [entry({ version: 2, state: "deleted" }), entry({ version: 1 })],
        question,
        NOW,
      ),
    ).toEqual({ kind: "none", reason: "deleted" });
    expect(
      matchVaultEntry([entry({ expiresAt: new Date("2026-09-17T00:00:00Z") })], question, NOW),
    ).toEqual({ kind: "none", reason: "expired" });
    expect(matchVaultEntry([entry(), entry({ id: "v2" })], question, NOW)).toEqual({
      kind: "none",
      reason: "ambiguous",
    });
  });

  it("refuses to store consent artifacts", () => {
    for (const key of [
      "attestation.truthful",
      "signature.electronic",
      "captcha.token",
      "mfa.code",
    ]) {
      expect(isVaultStorable(key)).toBe(false);
    }
    expect(isVaultStorable("authorization.us_authorized")).toBe(true);
  });
});
