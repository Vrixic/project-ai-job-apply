import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { PostgresTrustDecisionSignalStore } from "./decision-signal-store.js";

const ids = {
  contributionId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
  contributorUserId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
  decisionId: "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9",
};
describe("authoritative Trust proof bindings", () => {
  it.each(["readDecision", "readLatestDecision"] as const)(
    "%s retains accepted evidence from its exact owner-bound event",
    async (method) => {
      const query = vi.fn(async () => [
        {
          ...ids,
          resultingState: "accepted",
          policyVersion: "synthetic-trust-v1",
          decidedAt: "2026-09-09T12:00:00.000Z",
          evidenceDigestSha256: "a".repeat(64),
          independentEvidenceDigestSha256: "b".repeat(64),
        },
      ]);
      const value = await new PostgresTrustDecisionSignalStore(query as unknown as postgres.Sql)[
        method
      ](ids);
      expect(value).toMatchObject({
        status: "accepted",
        evidenceDigestSha256: "a".repeat(64),
        independentEvidenceDigestSha256: "b".repeat(64),
        decisionId: ids.decisionId,
      });
      expect(query.mock.calls[0]?.slice(1)).toContain(ids.contributorUserId);
    },
  );
  it.each(["needs_review", "appeal_pending"] as const)(
    "keeps initial review distinct from %s",
    async (resultingState) => {
      const query = vi.fn(async () => [
        {
          ...ids,
          resultingState,
          policyVersion: "synthetic-trust-v1",
          decidedAt: "2026-09-09T12:00:00.000Z",
          evidenceDigestSha256: null,
          independentEvidenceDigestSha256: null,
        },
      ]);
      const value = await new PostgresTrustDecisionSignalStore(
        query as unknown as postgres.Sql,
      ).readLatestDecision(ids);
      expect(value).toMatchObject({
        status: "needs_review",
        initialReviewPending: resultingState === "needs_review",
      });
    },
  );

  it.each(["readDecision", "readLatestDecision"] as const)(
    "%s never fabricates a historical accepted basis from reviewer evidence",
    async (method) => {
      const query = vi.fn(async () => [
        {
          ...ids,
          resultingState: "accepted",
          policyVersion: "synthetic-trust-v1",
          decidedAt: "2026-09-09T12:00:00.000Z",
          evidenceDigestSha256: "a".repeat(64),
          independentEvidenceDigestSha256: null,
        },
      ]);
      const value = await new PostgresTrustDecisionSignalStore(query as unknown as postgres.Sql)[
        method
      ](ids);
      expect(value).toMatchObject({ status: "accepted", evidenceDigestSha256: "a".repeat(64) });
      expect(value).not.toHaveProperty("independentEvidenceDigestSha256");
    },
  );

  it.each(["readDecision", "readLatestDecision"] as const)(
    "%s fails closed on malformed independent basis",
    async (method) => {
      for (const invalid of [undefined, "", "A".repeat(64), "not-a-digest"]) {
        const query = vi.fn(async () => [
          {
            ...ids,
            resultingState: "accepted",
            policyVersion: "synthetic-trust-v1",
            decidedAt: "2026-09-09T12:00:00.000Z",
            evidenceDigestSha256: "a".repeat(64),
            independentEvidenceDigestSha256: invalid,
          },
        ]);
        expect(
          await new PostgresTrustDecisionSignalStore(query as unknown as postgres.Sql)[method](ids),
        ).toBeNull();
      }
    },
  );

  it.each(["rejected", "withdrawn", "taken_down", "appeal_pending"] as const)(
    "does not transport historical accepted basis for %s",
    async (resultingState) => {
      const query = vi.fn(async () => [
        {
          ...ids,
          resultingState,
          policyVersion: "synthetic-trust-v1",
          decidedAt: "2026-09-09T12:00:00.000Z",
          evidenceDigestSha256: "a".repeat(64),
          independentEvidenceDigestSha256: "b".repeat(64),
        },
      ]);
      const value = await new PostgresTrustDecisionSignalStore(
        query as unknown as postgres.Sql,
      ).readLatestDecision(ids);
      expect(value).not.toBeNull();
      expect(value).not.toHaveProperty("independentEvidenceDigestSha256");
    },
  );
});
