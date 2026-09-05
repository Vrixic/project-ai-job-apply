import { describe, expect, it } from "vitest";
import { projectIndependentJobReviewEvidence } from "./contribution-review-evidence.js";

const input = {
  contributionId: "019d04cf-1f80-7000-8000-000000000010",
  evidenceDigestSha256: "a".repeat(64),
  verifiedAt: "2026-09-05T12:00:00.000Z",
  observation: {
    provider: "greenhouse",
    sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
    companyName: "Synthetic company",
    title: "Synthetic role",
    locations: ["Remote"],
    description: "Complete independently verified content.\nSecond paragraph.",
    ownerUserId: "must not project",
    rawSnapshot: "must not project",
    externalJobId: "123",
  },
};

describe("Jobs-owned readable review evidence", () => {
  it("projects full public truth without owner identity, raw snapshots, or internal provider keys", () => {
    const result = projectIndependentJobReviewEvidence(input);
    expect(result.description).toBe(input.observation.description);
    expect(result).not.toHaveProperty("ownerUserId");
    expect(result).not.toHaveProperty("rawSnapshot");
    expect(result).not.toHaveProperty("externalJobId");
    result.locations.push("not persisted");
    expect(input.observation.locations).toEqual(["Remote"]);
  });
  it("denies unsafe URLs, HTML, control characters, missing values, and oversized descriptions", () => {
    for (const observation of [
      { ...input.observation, sourceUrl: "javascript:alert(1)" },
      { ...input.observation, sourceUrl: "https://attacker.example/job" },
      { ...input.observation, sourceUrl: `${input.observation.sourceUrl}?token=secret` },
      { ...input.observation, description: "<script>untrusted()</script>" },
      { ...input.observation, companyName: "Synthetic\u0000Company" },
      { ...input.observation, title: "" },
      { ...input.observation, description: "x".repeat(100_001) },
    ])
      expect(() => projectIndependentJobReviewEvidence({ ...input, observation })).toThrow();
  });
});
