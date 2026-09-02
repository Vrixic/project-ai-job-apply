import { describe, expect, it, vi } from "vitest";
import { AuthoritativeContributionTrustDecisionAdapter } from "./contribution-trust-adapter.js";

const ids = {
  contribution: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
  owner: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
  normalization: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
  verification: "019b4e12-7ea3-7c36-9357-aea35ab542cd",
  opener: "019b4e12-7ea3-7c36-9357-aea35ab542ce",
  decision: "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9",
};

const input = {
  contributionId: ids.contribution,
  contributorUserId: ids.owner,
  normalizationId: ids.normalization,
  independentVerificationId: ids.verification,
  independentEvidenceDigestSha256: "a".repeat(64),
};

function decision(status: "needs_review" | "accepted" | "rejected" = "needs_review") {
  return {
    status,
    contributionId: ids.contribution,
    decisionId: ids.decision,
    policyVersion: "synthetic-trust-v1",
    decidedAt: "2026-09-02T12:00:00.000Z",
  } as const;
}

describe("AuthoritativeContributionTrustDecisionAdapter", () => {
  it("exact-reads an existing terminal owner-bound decision without opening", async () => {
    const openReview = vi.fn();
    const readLatestDecision = vi.fn(async () => decision("accepted"));
    await expect(
      new AuthoritativeContributionTrustDecisionAdapter(
        { openReview },
        { readLatestDecision },
        ids.opener,
      ).evaluate(input),
    ).resolves.toEqual(decision("accepted"));
    expect(openReview).not.toHaveBeenCalled();
  });

  it("opens one review through explicit authority and exact-reads the stable transition", async () => {
    const readLatestDecision = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(decision());
    const openReview = vi.fn(async () => ({
      contributionId: ids.contribution,
      contributorUserId: ids.owner,
    }));
    await expect(
      new AuthoritativeContributionTrustDecisionAdapter(
        { openReview } as never,
        { readLatestDecision },
        ids.opener,
      ).evaluate(input),
    ).resolves.toEqual(decision("needs_review"));
    expect(openReview).toHaveBeenCalledWith({
      reviewerId: ids.opener,
      contributionId: ids.contribution,
    });
    expect(readLatestDecision).toHaveBeenLastCalledWith({
      contributionId: ids.contribution,
      contributorUserId: ids.owner,
    });
  });

  it("converges concurrent opens and an ambiguous committed open on one stable decision", async () => {
    const stable = decision();
    const concurrentReads = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(stable);
    const openReview = vi.fn(async () => ({
      contributionId: ids.contribution,
      contributorUserId: ids.owner,
    }));
    const concurrent = new AuthoritativeContributionTrustDecisionAdapter(
      { openReview } as never,
      { readLatestDecision: concurrentReads },
      ids.opener,
    );
    await expect(
      Promise.all([concurrent.evaluate(input), concurrent.evaluate(input)]),
    ).resolves.toEqual([stable, stable]);
    expect(openReview).toHaveBeenCalledTimes(2);

    let committed = false;
    const ambiguous = new AuthoritativeContributionTrustDecisionAdapter(
      {
        openReview: vi.fn(async () => {
          committed = true;
          throw new Error("response_lost_after_commit");
        }),
      },
      {
        readLatestDecision: vi.fn(async () => (committed ? stable : null)),
      } as never,
      ids.opener,
    );
    await expect(ambiguous.evaluate(input)).resolves.toEqual({ status: "unavailable" });
    await expect(ambiguous.evaluate(input)).resolves.toEqual(stable);
  });

  it("fails closed on cross-owner, malformed, ambiguous, or unavailable authority", async () => {
    const cases = [
      { ...decision("accepted"), contributionId: "019b4e12-7ea3-7c36-9357-aea35ab542df" },
      { ...decision("accepted"), decisionId: ids.verification },
      null,
    ];
    for (const latest of cases) {
      const adapter = new AuthoritativeContributionTrustDecisionAdapter(
        {
          openReview: vi.fn(async () => {
            throw new Error("unavailable");
          }),
        },
        { readLatestDecision: vi.fn(async () => latest) } as never,
        ids.opener,
      );
      await expect(adapter.evaluate(input)).resolves.toEqual({ status: "unavailable" });
    }
  });
});
