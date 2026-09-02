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
    client: { surface: "browser_extension", version: "0.1.0" },
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
      contentSha256: "960e85b7cb3fc5656ea38c98064e64fe9ee04e563597b0efd8304bebb631bce9",
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
      previewDigestSha256: "0521e8b621f7c0a3b2fabc4fb3f7d7f75838dfdbdf3f749bd331d69e38cfb510",
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

  it("binds exact client surface and version to both canonical digests", () => {
    const first = vector();
    const second = vector();
    second.client.version = "0.1.1";
    expect(jobContributionContentDigestInput(second)).not.toBe(
      jobContributionContentDigestInput(first),
    );
    expect(jobContributionPreviewDigestInput(second)).not.toBe(
      jobContributionPreviewDigestInput(first),
    );
  });
});
