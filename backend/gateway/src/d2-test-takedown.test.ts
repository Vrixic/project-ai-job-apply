import type { D2LambdaGatewayTrustConfiguration } from "@ai-job-apply/config";
import { PostgresTrustStore, type TrustCase } from "@ai-job-apply/trust-service";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createConfiguredD2TrustRuntime } from "./d2-trust-runtime.js";
import { trustReviewerId } from "./trust-reviewer-authority.js";

describe("development-only exact-contribution test takedown", () => {
  it.each([
    "allowed",
    "disabled",
    "wrong_contribution",
    "wrong_digest",
    "ordinary_evidence",
    "wrong_role",
  ] as const)("enforces %s", async (mode) => {
    const issuer = "https://identity.example.test/";
    const subject = "auth0|synthetic-test-reviewer";
    const contributionId = "019d04cf-1f80-7000-8000-000000000010";
    const caseId = "019d04cf-1f80-8000-8000-000000000012";
    const current: TrustCase = {
      id: caseId,
      contributionId,
      contributorUserId: "019d04cf-1f80-7000-8000-000000000011",
      state: "accepted",
      policyVersion: "synthetic-test-v1",
      appealWindowMilliseconds: 1000,
      version: 2,
      appealCount: 0,
      adverseDecision: null,
      pendingAppealEvidenceDigestSha256: null,
      independentEvidenceDigestSha256: "a".repeat(64),
      createdAt: new Date("2026-09-01T12:00:00Z"),
      updatedAt: new Date("2026-09-01T13:00:00Z"),
    };
    const configuration: D2LambdaGatewayTrustConfiguration = {
      developmentTestTakedownEnabled: mode !== "disabled",
      reviewerAssignments: [
        {
          issuer,
          subject,
          roles: mode === "wrong_role" ? ["case_reader"] : ["case_reader", "takedown_reviewer"],
          verifiedRequesterTakedown: false,
        },
      ],
      evidenceAllowlist: [
        {
          contributionId:
            mode === "wrong_contribution" ? "019d04cf-1f80-7000-8000-000000000099" : contributionId,
          evidenceDigestSha256: mode === "wrong_digest" ? "c".repeat(64) : "b".repeat(64),
          purposes: [mode === "ordinary_evidence" ? "takedown" : "development_test_takedown"],
        },
      ],
      policyVersion: current.policyVersion,
      appealWindowMilliseconds: 1000,
      systemActorId: "019d04cf-1f80-7000-8000-000000000098",
    };
    const read = vi
      .spyOn(PostgresTrustStore.prototype, "readReviewerCase")
      .mockResolvedValue(current);
    const takeDown = vi
      .spyOn(PostgresTrustStore.prototype, "takeDown")
      .mockResolvedValue({ ...current, state: "taken_down", version: 3 });
    try {
      const service = createConfiguredD2TrustRuntime(
        vi.fn() as unknown as postgres.Sql,
        configuration,
      ).service;
      const action = service.takeDownAcceptedContribution({
        reviewerId: trustReviewerId(issuer, subject),
        caseId,
        expectedVersion: 2,
        reasonCode: "development_test_removal",
        evidenceDigestSha256: "b".repeat(64),
      });
      if (mode === "allowed") {
        await expect(action).resolves.toMatchObject({ state: "taken_down", version: 3 });
        expect(takeDown).toHaveBeenCalledTimes(1);
      } else {
        await expect(action).rejects.toMatchObject({ code: "access_denied" });
        expect(takeDown).not.toHaveBeenCalled();
      }
    } finally {
      read.mockRestore();
      takeDown.mockRestore();
    }
  });
});
