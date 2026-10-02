import type { ProfileFact } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { profileFactToGraphFact } from "./profile-fact-graph.js";

const fact: ProfileFact = {
  id: "019a4000-0000-7000-8000-000000000001",
  kind: "skill",
  key: "skill",
  value: ["TypeScript"],
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "resume", reference: "synthetic" },
  version: 2,
  createdAt: "2026-10-02T12:00:00Z",
  updatedAt: "2026-10-02T12:01:00Z",
};

describe("Profile-owned fact graph projection", () => {
  it("retains factual content/provenance but excludes transport timestamps", () => {
    const result = profileFactToGraphFact(fact);
    expect(result).toEqual({
      id: fact.id,
      kind: fact.kind,
      key: fact.key,
      value: fact.value,
      verification: fact.verification,
      sensitivity: fact.sensitivity,
      source: fact.source,
      version: 2,
    });
  });
  it("detaches arrays and source references", () => {
    const source = structuredClone(fact);
    const result = profileFactToGraphFact(source);
    (source.value as string[]).push("changed");
    source.source.reference = "changed";
    expect(result.value).toEqual(["TypeScript"]);
    expect(result.source.reference).toBe("synthetic");
  });
  it("retains invalidation and effective dates without making evidence usable", () => {
    const source: ProfileFact = {
      ...fact,
      availability: { state: "invalidated", reasonCode: "source_security_hold" },
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-02-01",
    };
    expect(profileFactToGraphFact(source)).toMatchObject({
      availability: source.availability,
      effectiveFrom: source.effectiveFrom,
      effectiveTo: source.effectiveTo,
    });
  });
  it("detaches supporting spans and preserves exact parser provenance", () => {
    const source: ProfileFact = {
      ...fact,
      evidence: {
        supportingSpans: [
          {
            documentId: fact.id,
            documentVersion: 1,
            parserVersion: "synthetic.v1",
            blockIndex: 0,
            startOffset: 0,
            endOffset: 3,
            page: 1,
          },
        ],
      },
    };
    const result = profileFactToGraphFact(source);
    source.evidence?.supportingSpans.splice(0);
    expect(result.evidence?.supportingSpans).toHaveLength(1);
    expect(result.evidence?.supportingSpans[0]?.parserVersion).toBe("synthetic.v1");
  });
});
