import type { D2LambdaGatewayTrustConfiguration } from "@ai-job-apply/config";
import { PostgresContributionReviewEvidenceReader } from "@ai-job-apply/jobs-service";
import { PostgresTrustStore, type TrustCase } from "@ai-job-apply/trust-service";
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
  it("binds a new initial acceptance to the exact latest fresh provider proof in SQL", async () => {
    const contributionId = "019d04cf-1f80-7000-8000-000000000010";
    const contributorUserId = "019d04cf-1f80-7000-8000-000000000011";
    const caseId = "019d04cf-1f80-8000-8000-000000000012";
    const current: TrustCase = {
      id: caseId,
      contributionId,
      contributorUserId,
      state: "needs_review",
      policyVersion: configuration.policyVersion,
      appealWindowMilliseconds: 1_000,
      version: 1,
      appealCount: 0,
      adverseDecision: null,
      pendingAppealEvidenceDigestSha256: null,
      independentEvidenceDigestSha256: null,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    };
    const proof = {
      contributionId,
      evidenceDigestSha256: "a".repeat(64),
      verifiedAt: new Date().toISOString(),
      provider: "greenhouse" as const,
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      title: "Synthetic engineer",
      companyName: "Synthetic",
      description: "Synthetic public evidence",
      locations: ["Remote"],
    };
    const query = vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) =>
      strings.join("").includes('AS "independentlyVerified"')
        ? [{ contributionId, contributorUserId, independentlyVerified: true }]
        : [{ verified: true }],
    );
    const read = vi
      .spyOn(PostgresTrustStore.prototype, "readReviewerCase")
      .mockResolvedValue(current);
    const evidence = vi
      .spyOn(PostgresContributionReviewEvidenceReader.prototype, "read")
      .mockResolvedValue(proof);
    const review = vi.spyOn(PostgresTrustStore.prototype, "review").mockResolvedValue({
      ...current,
      state: "accepted",
      version: 2,
      independentEvidenceDigestSha256: proof.evidenceDigestSha256,
    });
    try {
      const assignment = configuration.reviewerAssignments[0];
      if (!assignment) throw new Error("Synthetic reviewer missing");
      const runtime = createConfiguredD2TrustRuntime(query as unknown as postgres.Sql, {
        ...configuration,
        reviewerAssignments: [{ ...assignment, roles: ["initial_reviewer", "case_reader"] }],
      });
      await runtime.service.decideInitialReview({
        reviewerId: trustReviewerId(assignment.issuer, assignment.subject),
        caseId,
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256: proof.evidenceDigestSha256,
      });
      const last = query.mock.calls.at(-1);
      expect(last?.[0].join("")).toContain("interval '24 hours'");
      expect(last?.[0].join("")).toContain("newer.verified_at, newer.id");
      expect(
        last?.slice(1).filter((value) => typeof value === "string" && value.endsWith("Z")).length,
      ).toBeGreaterThan(0);
      expect(review).toHaveBeenCalledWith(
        caseId,
        1,
        expect.objectContaining({
          independentEvidenceDigestSha256: proof.evidenceDigestSha256,
        }),
      );
    } finally {
      read.mockRestore();
      evidence.mockRestore();
      review.mockRestore();
    }
  });
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

  it("uses exact Jobs verification evidence for initial review without granting takedown evidence", async () => {
    const contributionId = "019d04cf-1f80-7000-8000-000000000010";
    const contributorUserId = "019d04cf-1f80-7000-8000-000000000011";
    const caseId = "019d04cf-1f80-8000-8000-000000000012";
    const reviewerId = trustReviewerId(
      "https://identity.example.test/",
      "auth0|reviewer-synthetic",
    );
    const current: TrustCase = {
      id: caseId,
      contributionId,
      contributorUserId,
      state: "needs_review",
      policyVersion: configuration.policyVersion,
      appealWindowMilliseconds: 1_000,
      version: 1,
      appealCount: 0,
      adverseDecision: null,
      pendingAppealEvidenceDigestSha256: null,
      independentEvidenceDigestSha256: null,
      createdAt: new Date("2026-09-05T12:00:00.000Z"),
      updatedAt: new Date("2026-09-05T12:00:00.000Z"),
    };
    let verified = true;
    const query = vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('AS "independentlyVerified"')
        ? [{ contributionId, contributorUserId, independentlyVerified: true }]
        : [{ verified }],
    );
    const read = vi
      .spyOn(PostgresTrustStore.prototype, "readReviewerCase")
      .mockResolvedValue(current);
    const review = vi
      .spyOn(PostgresTrustStore.prototype, "review")
      .mockResolvedValue({ ...current, state: "rejected", version: 2 });
    try {
      const assignment = configuration.reviewerAssignments[0];
      if (!assignment) throw new Error("Expected a synthetic reviewer assignment");
      const runtime = createConfiguredD2TrustRuntime(query as unknown as postgres.Sql, {
        ...configuration,
        reviewerAssignments: [
          { ...assignment, roles: ["case_reader", "initial_reviewer", "takedown_reviewer"] },
        ],
      });
      const input = {
        reviewerId,
        caseId,
        expectedVersion: 1,
        outcome: "rejected" as const,
        reasonCode: "insufficient_evidence" as const,
        evidenceDigestSha256: "a".repeat(64),
      };
      await expect(runtime.service.decideInitialReview(input)).resolves.toMatchObject({
        state: "rejected",
      });
      expect(review).toHaveBeenCalledOnce();
      expect(query.mock.calls.at(-1)?.[0].join("")).toContain("evidence_digest_sha256");
      verified = false;
      await expect(runtime.service.decideInitialReview(input)).rejects.toMatchObject({
        code: "evidence_not_verified",
      });
      read.mockResolvedValue({ ...current, state: "accepted" });
      query.mockClear();
      await expect(
        runtime.service.takeDownAcceptedContribution({
          reviewerId,
          caseId,
          expectedVersion: 1,
          reasonCode: "rights_or_policy_violation",
          evidenceDigestSha256: "a".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "evidence_not_verified" });
      expect(query).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      review.mockRestore();
    }
  });
});
