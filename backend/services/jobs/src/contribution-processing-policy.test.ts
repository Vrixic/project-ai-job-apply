import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobContributionInput } from "./contribution.js";
import { normalizeContributionForProcessing } from "./contribution-processing-policy.js";

function input(): JobContributionInput {
  return {
    schemaVersion: 1,
    contributionId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e20",
    client: { surface: "browser_extension", version: "0.2.0" },
    source: {
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: "https://jobs.eu.lever.co/Synthetic/synthetic-123",
      externalJobId: "SYNTHETIC-123",
      adapterVersion: "d2-job-page-v1",
    },
    posting: {
      companyName: "Synthetic Company",
      title: "Senior   Engineer",
      locations: ["Remote - US", "New York, NY", "Remote - US"],
      description: "Generated public posting content.",
      department: "Product Engineering",
      applicationUrl: "https://apply.example.test/synthetic-123",
      employmentType: "full_time",
      workMode: "remote",
    },
    observation: {
      observedAt: "2026-09-01T12:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
    approval: {
      consentId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e21",
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: "synthetic-ugc-policy-v1",
      approvedAt: "2026-09-01T12:01:00.000Z",
      approvedFields: [],
      previewDigestSha256: "b".repeat(64),
    },
  };
}

describe("normalizeContributionForProcessing", () => {
  it.each([
    ["Threshold < 10, throughput > 5.", "threshold < 10, throughput > 5."],
    ["Threshold <= 10, throughput >= 5.", "threshold <= 10, throughput >= 5."],
    ["Range 1 < 2 > 1; budget <$100.", "range 1 < 2 > 1; budget <$100."],
    ["Keep x < y and y > z unchanged.", "keep x < y and y > z unchanged."],
    ["Threshold\t＜  10,\nthroughput ＞ 5.", "threshold < 10, throughput > 5."],
  ])("hashes exact normalized comparison text: %s", (description, normalized) => {
    const value = input();
    value.posting.description = description;
    const original = JSON.stringify(value);
    const first = normalizeContributionForProcessing(value);
    const replay = normalizeContributionForProcessing(structuredClone(value));
    expect(first.normalizedDescriptionSha256).toBe(
      createHash("sha256").update(normalized).digest("hex"),
    );
    expect(replay).toEqual(first);
    expect(JSON.stringify(value)).toBe(original);
    expect(JSON.stringify(first)).not.toContain(description);
  });

  it("never normalizes different operators or numbers to the same description digest", () => {
    const digests = [
      "Threshold < 10 and throughput > 5.",
      "Threshold > 10 and throughput > 5.",
      "Threshold <= 10 and throughput > 5.",
      "Threshold < 11 and throughput > 5.",
      "Threshold 10 and throughput 5.",
    ].map((description) => {
      const value = input();
      value.posting.description = description;
      return normalizeContributionForProcessing(value).normalizedDescriptionSha256;
    });
    expect(new Set(digests).size).toBe(digests.length);
  });

  it.each([
    "<b>Selected description</b>",
    "Threshold < 10 followed by <img",
    "Incomplete <script",
    "Incomplete </div",
    "Incomplete <!-- comment",
    "Incomplete <!DOCTYPE",
    "Incomplete <?xml",
    "Full-width ＜script＞hidden＜/script＞",
    "Mixed-width <ｓｃｒｉｐｔ",
    "Unsafe\u0000control",
    "Unsafe\u007fcontrol",
    "Unsafe\u0085control",
    "Unsafe\u202eoverride",
    "Unsafe\u2066isolate",
    " leading comparison < 10",
    "Trailing comparison > 5 ",
    "",
    "x".repeat(50_001),
    "ﬃ".repeat(16_667),
  ])("rejects unsupported description text before normalization (#%#)", (description) => {
    const value = input();
    value.posting.description = description;
    expect(() => normalizeContributionForProcessing(value)).toThrow("invalid normalized field");
  });

  it("keeps comparison symbols forbidden outside descriptions", () => {
    const changes = [
      (value: JobContributionInput) => {
        value.posting.title = "Engineer > 5";
      },
      (value: JobContributionInput) => {
        value.posting.companyName = "Company < 10";
      },
      (value: JobContributionInput) => {
        value.posting.locations = ["Region > 5"];
      },
      (value: JobContributionInput) => {
        value.posting.department = "Team <= 10";
      },
    ];
    for (const change of changes) {
      const value = input();
      change(value);
      expect(() => normalizeContributionForProcessing(value)).toThrow("invalid normalized field");
    }
  });

  it("retains the exact description limit and optional omission", () => {
    const exact = input();
    exact.posting.description = `< 10 ${"x".repeat(49_995)}`;
    expect(normalizeContributionForProcessing(exact).normalizedDescriptionSha256).toBe(
      createHash("sha256").update(exact.posting.description).digest("hex"),
    );
    delete exact.posting.description;
    expect(normalizeContributionForProcessing(exact).normalizedDescriptionSha256).toBeUndefined();
  });

  it("creates one deterministic bounded proposal and keeps provenance separate", () => {
    const first = normalizeContributionForProcessing(input());
    const second = normalizeContributionForProcessing(input());

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      normalizedCompanyName: "synthetic company",
      normalizedTitle: "senior engineer",
      normalizedLocations: ["new york, ny", "remote - us"],
      normalizedDepartment: "product engineering",
      provenance: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        atsTenant: "synthetic",
        externalJobId: "synthetic-123",
      },
      dedupe: {
        exactIdentityKeys: [
          "ats:lever:synthetic:synthetic-123",
          expect.stringMatching(/^url:[a-f0-9]{64}$/u),
        ],
        fuzzyFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      proposalSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(first)).not.toContain("Generated public posting content.");
    expect(JSON.stringify(first)).not.toContain("https://apply.example.test/synthetic-123");
  });

  it("does not treat the normalized proposal as independent provider evidence", () => {
    const proposal = normalizeContributionForProcessing(input());
    expect(proposal).not.toHaveProperty("verifiedAt");
    expect(proposal).not.toHaveProperty("verificationId");
    expect(proposal).not.toHaveProperty("lastVerifiedAt");
    expect(proposal).not.toHaveProperty("expiresAt");
  });

  it("rejects a provider/variant/domain mismatch and page-controlled markup", () => {
    const wrongVariant = input();
    wrongVariant.source.pageVariant = "ashby-job-board-v1";
    expect(() => normalizeContributionForProcessing(wrongVariant)).toThrow(
      "provider provenance is invalid",
    );

    const markup = input();
    markup.posting.title = "<script>synthetic</script>";
    expect(() => normalizeContributionForProcessing(markup)).toThrow("invalid normalized field");
  });

  it("rejects unbounded fields and noncanonical provider URLs", () => {
    const tooManyLocations = input();
    tooManyLocations.posting.locations = Array.from({ length: 21 }, (_, index) => `Place ${index}`);
    expect(() => normalizeContributionForProcessing(tooManyLocations)).toThrow(
      "too many locations",
    );

    const tracked = input();
    tracked.source.sourceUrl = `${tracked.source.sourceUrl}?utm_source=private`;
    expect(() => normalizeContributionForProcessing(tracked)).toThrow(
      "provider provenance is invalid",
    );
  });
});
