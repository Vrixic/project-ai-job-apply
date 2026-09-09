import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  decideContributionReview,
  decideTrustAppeal,
  fileTrustAppeal,
  openTrustCase,
  TrustPolicyError,
  takeDownContribution,
  validateTrustSignal,
  validateTrustSignalForCase,
  withdrawContribution,
} from "./policy.js";

const openedAt = new Date("2026-09-01T12:00:00.000Z");
const evidence = "a".repeat(64);
const syntheticAppealPolicy = {
  version: "synthetic-appeal-policy-v1",
  appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
} as const;

function opened() {
  return openTrustCase({
    caseId: uuidv7(),
    contributionId: uuidv7(),
    contributorUserId: uuidv7(),
    systemActorId: uuidv7(),
    policy: syntheticAppealPolicy,
    occurredAt: openedAt,
  });
}

describe("UGC trust policy", () => {
  it.each([undefined, "", "A".repeat(64), "b".repeat(64)])(
    "rejects missing, malformed or mismatched initial provider basis %s",
    (basis) => {
      expect(() =>
        decideContributionReview(opened().trustCase, {
          reviewerId: uuidv7(),
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256: evidence,
          ...(basis !== undefined ? { independentEvidenceDigestSha256: basis } : {}),
          occurredAt: new Date("2026-09-01T12:01:00.000Z"),
        }),
      ).toThrow(TrustPolicyError);
    },
  );

  it("requires an explicit new provider basis for reversal while preserving distinct appeal evidence", () => {
    const accepted = decideContributionReview(opened().trustCase, {
      reviewerId: uuidv7(),
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: evidence,
      independentEvidenceDigestSha256: evidence,
      occurredAt: new Date("2026-09-01T12:01:00.000Z"),
    }).trustCase;
    const takenDown = takeDownContribution(accepted, {
      reviewerId: uuidv7(),
      reasonCode: "credible_safety_risk",
      evidenceDigestSha256: "b".repeat(64),
      occurredAt: new Date("2026-09-01T12:02:00.000Z"),
    }).trustCase;
    const appealed = fileTrustAppeal(takenDown, {
      contributorUserId: takenDown.contributorUserId,
      evidenceDigestSha256: "c".repeat(64),
      occurredAt: new Date("2026-09-01T12:03:00.000Z"),
    }).trustCase;
    expect(appealed.independentEvidenceDigestSha256).toBe(evidence);
    const resolution = {
      reviewerId: uuidv7(),
      outcome: "reversed" as const,
      evidenceDigestSha256: "d".repeat(64),
      occurredAt: new Date("2026-09-01T12:04:00.000Z"),
    };
    expect(() => decideTrustAppeal(appealed, resolution)).toThrow(
      "independentEvidenceDigestSha256",
    );
    const reversed = decideTrustAppeal(appealed, {
      ...resolution,
      independentEvidenceDigestSha256: "e".repeat(64),
    });
    expect(reversed.evidenceDigestSha256).toBe("d".repeat(64));
    expect(reversed.trustCase.independentEvidenceDigestSha256).toBe("e".repeat(64));
    expect(appealed.independentEvidenceDigestSha256).toBe(evidence);
    expect(
      withdrawContribution(reversed.trustCase, {
        contributorUserId: accepted.contributorUserId,
        occurredAt: new Date("2026-09-01T12:05:00.000Z"),
      }).trustCase.independentEvidenceDigestSha256,
    ).toBeNull();
  });

  it("rejects a provider basis supplied with a nonaccepting review", () => {
    expect(() =>
      decideContributionReview(opened().trustCase, {
        reviewerId: uuidv7(),
        outcome: "rejected",
        reasonCode: "content_mismatch",
        evidenceDigestSha256: evidence,
        independentEvidenceDigestSha256: evidence,
        occurredAt: new Date("2026-09-01T12:01:00.000Z"),
      }),
    ).toThrow("rejected review cannot establish");
  });

  it("starts every contribution default-dark and makes acceptance an internal decision only", () => {
    const initial = opened();
    expect(initial.trustCase).toMatchObject({ state: "needs_review", version: 1, appealCount: 0 });
    expect(initial).not.toHaveProperty("catalogMutation");

    const accepted = decideContributionReview(initial.trustCase, {
      reviewerId: uuidv7(),
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: evidence,
      independentEvidenceDigestSha256: evidence,
      occurredAt: new Date("2026-09-01T12:01:00.000Z"),
    });
    expect(accepted.trustCase.state).toBe("accepted");
    expect(accepted).not.toHaveProperty("publish");
  });

  it("rejects contradictory review outcomes and reason codes", () => {
    expect(() =>
      decideContributionReview(opened().trustCase, {
        reviewerId: uuidv7(),
        outcome: "accepted",
        reasonCode: "content_mismatch",
        evidenceDigestSha256: evidence,
        occurredAt: new Date("2026-09-01T12:01:00.000Z"),
      }),
    ).toThrow("outcome and fixed reason code do not match");
  });

  it("allows one timely evidence-bound appeal and requires an independent reviewer", () => {
    const ownerCase = opened().trustCase;
    const firstReviewer = uuidv7();
    const rejected = decideContributionReview(ownerCase, {
      reviewerId: firstReviewer,
      outcome: "rejected",
      reasonCode: "content_mismatch",
      evidenceDigestSha256: evidence,
      occurredAt: new Date("2026-09-01T13:00:00.000Z"),
    }).trustCase;
    const appealed = fileTrustAppeal(rejected, {
      contributorUserId: rejected.contributorUserId,
      evidenceDigestSha256: "b".repeat(64),
      occurredAt: new Date("2026-09-02T13:00:00.000Z"),
    }).trustCase;
    expect(appealed).toMatchObject({ state: "appeal_pending", appealCount: 1 });

    expect(() =>
      decideTrustAppeal(appealed, {
        reviewerId: firstReviewer,
        outcome: "reversed",
        evidenceDigestSha256: "c".repeat(64),
        occurredAt: new Date("2026-09-03T13:00:00.000Z"),
      }),
    ).toThrow("different reviewer");

    const reversed = decideTrustAppeal(appealed, {
      reviewerId: uuidv7(),
      outcome: "reversed",
      evidenceDigestSha256: "c".repeat(64),
      independentEvidenceDigestSha256: "e".repeat(64),
      occurredAt: new Date("2026-09-03T13:00:00.000Z"),
    }).trustCase;
    expect(reversed).toMatchObject({ state: "accepted", appealCount: 1 });
    expect(() =>
      fileTrustAppeal(reversed, {
        contributorUserId: reversed.contributorUserId,
        evidenceDigestSha256: "d".repeat(64),
        occurredAt: new Date("2026-09-04T13:00:00.000Z"),
      }),
    ).toThrow("Only one appeal");
  });

  it("closes the appeal window after exactly fourteen days", () => {
    const initial = opened().trustCase;
    const decidedAt = new Date("2026-09-01T13:00:00.000Z");
    const rejected = decideContributionReview(initial, {
      reviewerId: uuidv7(),
      outcome: "rejected",
      reasonCode: "insufficient_evidence",
      evidenceDigestSha256: evidence,
      occurredAt: decidedAt,
    }).trustCase;
    expect(() =>
      fileTrustAppeal(rejected, {
        contributorUserId: rejected.contributorUserId,
        evidenceDigestSha256: "b".repeat(64),
        occurredAt: new Date(
          decidedAt.getTime() + syntheticAppealPolicy.appealWindowMilliseconds + 1,
        ),
      }),
    ).toThrow("configured appeal window");
  });

  it("applies the injected versioned policy instead of selecting a product timing default", () => {
    expect(() =>
      openTrustCase({
        caseId: uuidv7(),
        contributionId: uuidv7(),
        contributorUserId: uuidv7(),
        systemActorId: uuidv7(),
        policy: { version: "pending", appealWindowMilliseconds: 0 },
        occurredAt: openedAt,
      }),
    ).toThrow("technical bound");
    expect(opened().trustCase).toMatchObject({
      policyVersion: "synthetic-appeal-policy-v1",
      appealWindowMilliseconds: syntheticAppealPolicy.appealWindowMilliseconds,
    });
  });

  it("makes a takedown adverse and independently appealable without restoring catalog truth", () => {
    const initial = opened().trustCase;
    const accepted = decideContributionReview(initial, {
      reviewerId: uuidv7(),
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: evidence,
      independentEvidenceDigestSha256: evidence,
      occurredAt: new Date("2026-09-01T12:01:00.000Z"),
    }).trustCase;
    const takedownReviewer = uuidv7();
    const takenDown = takeDownContribution(accepted, {
      reviewerId: takedownReviewer,
      reasonCode: "credible_safety_risk",
      evidenceDigestSha256: "b".repeat(64),
      occurredAt: new Date("2026-09-01T12:02:00.000Z"),
    }).trustCase;
    const appealed = fileTrustAppeal(takenDown, {
      contributorUserId: takenDown.contributorUserId,
      evidenceDigestSha256: "c".repeat(64),
      occurredAt: new Date("2026-09-01T12:03:00.000Z"),
    }).trustCase;
    const upheld = decideTrustAppeal(appealed, {
      reviewerId: uuidv7(),
      outcome: "upheld",
      evidenceDigestSha256: "d".repeat(64),
      occurredAt: new Date("2026-09-01T12:04:00.000Z"),
    });
    expect(upheld.trustCase.state).toBe("taken_down");
    expect(upheld.trustCase.independentEvidenceDigestSha256).toBe(evidence);
    expect(upheld.evidenceDigestSha256).toBe("d".repeat(64));
    expect(upheld).not.toHaveProperty("catalogMutation");
  });

  it("allows only the owner to withdraw and only accepted contributions to be taken down", () => {
    const initial = opened().trustCase;
    expect(() =>
      withdrawContribution(initial, {
        contributorUserId: uuidv7(),
        occurredAt: new Date("2026-09-01T12:01:00.000Z"),
      }),
    ).toThrow("Only the contribution owner");
    expect(() =>
      takeDownContribution(initial, {
        reviewerId: uuidv7(),
        reasonCode: "credible_safety_risk",
        evidenceDigestSha256: evidence,
        occurredAt: new Date("2026-09-01T12:01:00.000Z"),
      }),
    ).toThrow("Only an accepted contribution");
    expect(
      withdrawContribution(initial, {
        contributorUserId: initial.contributorUserId,
        occurredAt: new Date("2026-09-01T12:01:00.000Z"),
      }).trustCase.state,
    ).toBe("withdrawn");
  });

  it("keeps contributor and source signal taxonomies separated", () => {
    expect(() =>
      validateTrustSignal({
        subjectKind: "contributor",
        signalCode: "source_safety_risk",
        referenceDigestSha256: evidence,
      }),
    ).toThrow(TrustPolicyError);
    expect(() =>
      validateTrustSignal({
        subjectKind: "source",
        signalCode: "contributor_abuse_detected",
        referenceDigestSha256: evidence,
      }),
    ).toThrow(TrustPolicyError);
    expect(() =>
      validateTrustSignal({
        subjectKind: "source",
        signalCode: "source_content_conflict",
        referenceDigestSha256: evidence,
      }),
    ).not.toThrow();
    expect(() =>
      validateTrustSignalForCase(opened().trustCase, {
        subjectKind: "contributor",
        signalCode: "contributor_abuse_detected",
        referenceDigestSha256: evidence,
      }),
    ).toThrow("eligible for appeal");
  });
});
