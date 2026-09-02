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
