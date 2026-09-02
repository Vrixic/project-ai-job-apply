import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CreateJobContributionRequest } from "./index.js";
import {
  expectedJobContributionApprovedFields,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "./job-contribution-canonical.js";

function vector(): CreateJobContributionRequest {
  return {
    schemaVersion: 1,
    contributionId: "019c0000-0000-7000-8000-000000000010",
    source: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      externalJobId: "123",
      adapterVersion: "d2-job-page-v1",
    },
    posting: {
      companyName: "Synthetic Company",
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "Generated public job text for contract verification.",
    },
    observation: {
      observedAt: "2026-09-01T12:00:00.000Z",
      contentSha256: "e52ddc9803019ca0cc9f27ac442be283bb3239ab364656c67e658ff9298f69f3",
    },
    approval: {
      consentId: "019c0000-0000-7000-8000-000000000011",
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: "ugc-policy-v1",
      approvedAt: "2026-09-01T12:01:00.000Z",
      approvedFields: [
        "provider",
        "pageVariant",
        "sourceUrl",
        "externalJobId",
        "companyName",
        "title",
        "locations",
        "description",
      ],
      previewDigestSha256: "f89f4cf43700c58ab63606434ff69ed359ddb11a0b7060dad02f945984bcc37f",
    },
  };
}

describe("shared job contribution canonical vectors", () => {
  it("freezes the client/server content and preview digests", () => {
    const input = vector();
    expect(
      createHash("sha256").update(jobContributionContentDigestInput(input)).digest("hex"),
    ).toBe(input.observation.contentSha256);
    expect(
      createHash("sha256").update(jobContributionPreviewDigestInput(input)).digest("hex"),
    ).toBe(input.approval.previewDigestSha256);
    expect(expectedJobContributionApprovedFields(input)).toEqual(input.approval.approvedFields);
  });

  it("changes the preview vector when a selected field changes", () => {
    const input = vector();
    input.posting.title = "Changed title";
    expect(
      createHash("sha256").update(jobContributionPreviewDigestInput(input)).digest("hex"),
    ).not.toBe(input.approval.previewDigestSha256);
  });
});
