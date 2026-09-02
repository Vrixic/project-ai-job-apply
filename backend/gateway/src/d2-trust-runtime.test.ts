import type { D2LambdaGatewayTrustConfiguration } from "@ai-job-apply/config";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createConfiguredD2TrustRuntime } from "./d2-trust-runtime.js";
import { trustReviewerId } from "./trust-reviewer-authority.js";

const configuration: D2LambdaGatewayTrustConfiguration = {
  reviewerAssignments: [
    {
      issuer: "https://identity.example.test/",
      subject: "auth0|reviewer-synthetic",
      roles: ["case_reader"],
      verifiedRequesterTakedown: false,
    },
  ],
  evidenceAllowlist: [],
  policyVersion: "d2-synthetic-trust.v1",
  appealWindowMilliseconds: 1_000,
  systemActorId: "019d04cf-1f80-7000-8000-000000000099",
};

describe("configured D2 Trust runtime", () => {
  it("derives reviewer authority only from the exact configured issuer and subject", async () => {
    const client = vi.fn() as unknown as postgres.Sql;
    const runtime = createConfiguredD2TrustRuntime(client, configuration);
    const configuredReviewerId = trustReviewerId(
      "https://identity.example.test/",
      "auth0|reviewer-synthetic",
    );

    expect(runtime.reviewerAssignments).toEqual([
      {
        issuer: "https://identity.example.test/",
        subject: "auth0|reviewer-synthetic",
        roles: ["case_reader"],
      },
    ]);
    await expect(
      runtime.service.readReviewerCase({
        reviewerId: trustReviewerId("https://identity.example.test/", "auth0|unassigned-reviewer"),
        caseId: "019d04cf-1f80-8000-8000-000000000010",
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(configuredReviewerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(client).not.toHaveBeenCalled();
  });

  it("denies an owner when the authoritative Profile account is not active", async () => {
    const client = vi.fn(async () => [{ active: false }]) as unknown as postgres.Sql;
    const runtime = createConfiguredD2TrustRuntime(client, configuration);

    await expect(
      runtime.service.readOwnerCase({
        contributorUserId: "019d04cf-1f80-7000-8000-000000000001",
        contributionId: "019d04cf-1f80-7000-8000-000000000010",
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(client).toHaveBeenCalledOnce();
  });
});
