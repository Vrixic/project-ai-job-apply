import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  type ApprovedTrustPolicyPort,
  type ContributionEligibilityEvidencePort,
  type ContributorAccountAuthorityPort,
  type ReviewerAuthorityPort,
  TrustApplicationError,
  TrustApplicationService,
  type TrustApplicationStore,
  trustCaseIdForContribution,
  type VerifiedRequesterTakedownAuthorityPort,
} from "./application.js";
import {
  decideContributionReview,
  decideTrustAppeal,
  fileTrustAppeal,
  openTrustCase,
  type TrustCase,
  takeDownContribution,
  withdrawContribution,
} from "./policy.js";
import { type OwnerTrustCaseView, TrustVersionConflictError } from "./store.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const later = new Date("2026-09-01T13:00:00.000Z");
const evidenceDigestSha256 = "a".repeat(64);
const secondEvidenceDigestSha256 = "b".repeat(64);
const policy = {
  version: "synthetic-approved-policy-v1",
  appealWindowMilliseconds: 24 * 60 * 60 * 1_000,
} as const;

function ownerView(trustCase: TrustCase): OwnerTrustCaseView {
  return {
    id: trustCase.id,
    contributionId: trustCase.contributionId,
    state: trustCase.state,
    policyVersion: trustCase.policyVersion,
    version: trustCase.version,
    appealed: trustCase.appealCount === 1,
    appealDeadlineAt: trustCase.adverseDecision?.appealDeadlineAt.toISOString() ?? null,
    createdAt: trustCase.createdAt.toISOString(),
    updatedAt: trustCase.updatedAt.toISOString(),
  };
}

class MemoryTrustStore implements TrustApplicationStore {
  readonly cases = new Map<string, TrustCase>();
  mutationCount = 0;

  async open(input: Parameters<TrustApplicationStore["open"]>[0]): Promise<TrustCase> {
    const existing = [...this.cases.values()].find(
      (value) => value.contributionId === input.contributionId,
    );
    if (existing) return existing;
    const trustCase = openTrustCase(input).trustCase;
    this.cases.set(trustCase.id, trustCase);
    this.mutationCount += 1;
    return trustCase;
  }

  async review(
    caseId: string,
    expectedVersion: number,
    input: Parameters<TrustApplicationStore["review"]>[2],
  ): Promise<TrustCase> {
    return this.transition(
      caseId,
      expectedVersion,
      (current) => decideContributionReview(current, input).trustCase,
    );
  }

  async withdraw(
    caseId: string,
    expectedVersion: number,
    input: Parameters<TrustApplicationStore["withdraw"]>[2],
  ): Promise<TrustCase> {
    return this.transition(
      caseId,
      expectedVersion,
      (current) => withdrawContribution(current, input).trustCase,
    );
  }

  async takeDown(
    caseId: string,
    expectedVersion: number,
    input: Parameters<TrustApplicationStore["takeDown"]>[2],
  ): Promise<TrustCase> {
    return this.transition(
      caseId,
      expectedVersion,
      (current) => takeDownContribution(current, input).trustCase,
    );
  }

  async appeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<TrustApplicationStore["appeal"]>[2],
  ): Promise<TrustCase> {
    return this.transition(
      caseId,
      expectedVersion,
      (current) => fileTrustAppeal(current, input).trustCase,
    );
  }

  async resolveAppeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<TrustApplicationStore["resolveAppeal"]>[2],
  ): Promise<TrustCase> {
    return this.transition(
      caseId,
      expectedVersion,
      (current) => decideTrustAppeal(current, input).trustCase,
    );
  }

  async readOwnerCase(ownerUserId: string, caseId: string): Promise<OwnerTrustCaseView | null> {
    const trustCase = this.cases.get(caseId);
    return trustCase?.contributorUserId === ownerUserId ? ownerView(trustCase) : null;
  }

  async readOwnerCaseByContribution(
    ownerUserId: string,
    contributionId: string,
  ): Promise<OwnerTrustCaseView | null> {
    const trustCase = [...this.cases.values()].find(
      (value) => value.contributionId === contributionId && value.contributorUserId === ownerUserId,
    );
    return trustCase ? ownerView(trustCase) : null;
  }

  async readReviewerCase(caseId: string): Promise<TrustCase | null> {
    return this.cases.get(caseId) ?? null;
  }

  private transition(
    caseId: string,
    expectedVersion: number,
    decide: (current: TrustCase) => TrustCase,
  ): TrustCase {
    const current = this.cases.get(caseId);
    if (!current || current.version !== expectedVersion) throw new TrustVersionConflictError();
    const updated = decide(current);
    this.cases.set(caseId, updated);
    this.mutationCount += 1;
    return updated;
  }
}

function allowContributors(): ContributorAccountAuthorityPort {
  return { authorize: async () => true };
}

function allowReviewers(): ReviewerAuthorityPort {
  return { authorize: async () => true };
}

function allowVerifiedRequesters(): VerifiedRequesterTakedownAuthorityPort {
  return { authorize: async () => true };
}

function approvedPolicy(): ApprovedTrustPolicyPort {
  return { readApprovedPolicy: async () => policy };
}

function contributionEvidence(input: {
  contributionId: string;
  contributorUserId: string;
  verify?: boolean;
}): ContributionEligibilityEvidencePort {
  return {
    readReviewEvidence: async () => ({
      contributionId: input.contributionId,
      evidenceDigestSha256,
      verifiedAt: now.toISOString(),
      provider: "greenhouse",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      title: "Synthetic engineer",
      companyName: "Synthetic",
      description: "Synthetic public description",
      locations: [],
    }),
    readEligibility: async (contributionId) =>
      contributionId === input.contributionId
        ? {
            contributionId,
            contributorUserId: input.contributorUserId,
            eligibleForTrustReview: true,
          }
        : null,
    verifyEvidence: async () => input.verify ?? true,
  };
}

function expectCode(error: unknown, code: TrustApplicationError["code"]): boolean {
  return error instanceof TrustApplicationError && error.code === code;
}

function openFixture(store: MemoryTrustStore, input?: { reviewerId?: string; at?: Date }) {
  const caseId = uuidv7();
  const contributionId = uuidv7();
  const contributorUserId = uuidv7();
  const reviewerId = input?.reviewerId ?? uuidv7();
  const trustCase = openTrustCase({
    caseId,
    contributionId,
    contributorUserId,
    systemActorId: uuidv7(),
    policy,
    occurredAt: input?.at ?? now,
  }).trustCase;
  store.cases.set(caseId, trustCase);
  return { caseId, contributionId, contributorUserId, reviewerId, trustCase };
}

function appealFixture(store: MemoryTrustStore) {
  const fixture = openFixture(store);
  const rejected = decideContributionReview(fixture.trustCase, {
    reviewerId: fixture.reviewerId,
    outcome: "rejected",
    reasonCode: "content_mismatch",
    evidenceDigestSha256,
    occurredAt: now,
  }).trustCase;
  const appealed = fileTrustAppeal(rejected, {
    contributorUserId: fixture.contributorUserId,
    evidenceDigestSha256: "c".repeat(64),
    occurredAt: now,
  }).trustCase;
  store.cases.set(fixture.caseId, appealed);
  return fixture;
}

describe("TrustApplicationService", () => {
  it("keeps independently approved appeal evidence distinct from the fresh accepted provider basis", async () => {
    const store = new MemoryTrustStore();
    const fixture = appealFixture(store);
    const verified: Array<Parameters<ContributionEligibilityEvidencePort["verifyEvidence"]>[0]> =
      [];
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: {
        ...contributionEvidence(fixture),
        verifyEvidence: async (input) => {
          verified.push(input);
          return true;
        },
      },
      now: () => later,
    });
    const originalResolve = store.resolveAppeal.bind(store);
    let command: Parameters<TrustApplicationStore["resolveAppeal"]>[2] | undefined;
    store.resolveAppeal = async (caseId, version, input) => {
      command = input;
      return originalResolve(caseId, version, input);
    };
    const result = await service.resolveAppeal({
      reviewerId: uuidv7(),
      caseId: fixture.caseId,
      expectedVersion: 3,
      outcome: "reversed",
      evidenceDigestSha256: secondEvidenceDigestSha256,
    });
    expect(result).toMatchObject({
      state: "accepted",
      independentEvidenceDigestSha256: evidenceDigestSha256,
    });
    expect(command).toMatchObject({
      evidenceDigestSha256: secondEvidenceDigestSha256,
      independentEvidenceDigestSha256: evidenceDigestSha256,
      occurredAt: later,
    });
    expect(verified).toEqual([
      {
        contributionId: fixture.contributionId,
        evidenceDigestSha256: secondEvidenceDigestSha256,
        purpose: "appeal_resolution",
      },
      {
        contributionId: fixture.contributionId,
        evidenceDigestSha256,
        purpose: "independent_verification",
        freshAt: later.toISOString(),
      },
    ]);
  });

  it.each([
    "missing",
    "stale",
    "future",
    "malformed",
    "noncanonical",
    "other-contribution",
    "bad-digest",
    "unverified",
  ] as const)("does not reverse an approved appeal with %s provider proof", async (failure) => {
    const store = new MemoryTrustStore();
    const fixture = appealFixture(store);
    const port = contributionEvidence(fixture);
    const original = await port.readReviewEvidence?.({
      contributionId: fixture.contributionId,
      contributorUserId: fixture.contributorUserId,
    });
    if (!original) throw new Error("Synthetic proof missing");
    const proof = {
      ...original,
      ...(failure === "stale" ? { verifiedAt: "2026-08-31T12:59:59.999Z" } : {}),
      ...(failure === "future" ? { verifiedAt: "2026-09-01T13:00:00.001Z" } : {}),
      ...(failure === "malformed" ? { verifiedAt: "invalid" } : {}),
      ...(failure === "noncanonical" ? { verifiedAt: "2026-09-01T12:00:00Z" } : {}),
      ...(failure === "other-contribution" ? { contributionId: uuidv7() } : {}),
      ...(failure === "bad-digest" ? { evidenceDigestSha256: "A".repeat(64) } : {}),
    };
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: {
        ...port,
        readReviewEvidence: async () => (failure === "missing" ? null : proof),
        verifyEvidence: async (input) =>
          input.purpose === "appeal_resolution" || failure !== "unverified",
      },
      now: () => later,
    });
    await expect(
      service.resolveAppeal({
        reviewerId: uuidv7(),
        caseId: fixture.caseId,
        expectedVersion: 3,
        outcome: "reversed",
        evidenceDigestSha256: secondEvidenceDigestSha256,
      }),
    ).rejects.toMatchObject({ code: "evidence_not_verified" });
    expect(store.mutationCount).toBe(0);
    expect(store.cases.get(fixture.caseId)).toMatchObject({
      state: "appeal_pending",
      version: 3,
      independentEvidenceDigestSha256: null,
    });
  });

  it("does not require new provider proof when upholding an adverse decision", async () => {
    const store = new MemoryTrustStore();
    const fixture = appealFixture(store);
    const port = contributionEvidence(fixture);
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: {
        ...port,
        readReviewEvidence: async () => {
          throw new Error("must not read");
        },
      },
      now: () => later,
    });
    await expect(
      service.resolveAppeal({
        reviewerId: uuidv7(),
        caseId: fixture.caseId,
        expectedVersion: 3,
        outcome: "upheld",
        evidenceDigestSha256: secondEvidenceDigestSha256,
      }),
    ).resolves.toMatchObject({ state: "rejected", independentEvidenceDigestSha256: null });
  });

  it.each(["initial", "appeal"] as const)(
    "rejects an invalid acceptance clock for %s",
    async (kind) => {
      const store = new MemoryTrustStore();
      const fixture = kind === "initial" ? openFixture(store) : appealFixture(store);
      const service = new TrustApplicationService({
        store,
        reviewerAuthority: allowReviewers(),
        contributionEvidence: contributionEvidence(fixture),
        now: () => new Date(Number.NaN),
      });
      const promise =
        kind === "initial"
          ? service.decideInitialReview({
              reviewerId: uuidv7(),
              caseId: fixture.caseId,
              expectedVersion: 1,
              outcome: "accepted",
              reasonCode: "independently_verified",
              evidenceDigestSha256,
            })
          : service.resolveAppeal({
              reviewerId: uuidv7(),
              caseId: fixture.caseId,
              expectedVersion: 3,
              outcome: "reversed",
              evidenceDigestSha256: secondEvidenceDigestSha256,
            });
      await expect(promise).rejects.toMatchObject({ code: "dependency_unavailable" });
      expect(store.mutationCount).toBe(0);
    },
  );

  it.each([
    ["2026-08-31T13:00:00.000Z", true],
    ["2026-08-31T12:59:59.999Z", false],
    ["2026-09-01T13:00:00.001Z", false],
    ["invalid", false],
  ] as const)(
    "enforces the exact initial acceptance freshness boundary for %s",
    async (verifiedAt, allowed) => {
      const store = new MemoryTrustStore();
      const fixture = openFixture(store);
      const port = contributionEvidence(fixture);
      const original = await port.readReviewEvidence?.({
        contributionId: fixture.contributionId,
        contributorUserId: fixture.contributorUserId,
      });
      const observed: Array<string | undefined> = [];
      if (!original) throw new Error("Synthetic proof missing");
      const service = new TrustApplicationService({
        store,
        reviewerAuthority: allowReviewers(),
        contributionEvidence: {
          ...port,
          readReviewEvidence: async () => ({ ...original, verifiedAt }),
          verifyEvidence: async (input) => {
            observed.push(input.freshAt);
            return true;
          },
        },
        now: () => later,
      });
      const request = service.decideInitialReview({
        reviewerId: fixture.reviewerId,
        caseId: fixture.caseId,
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256,
      });
      if (allowed) {
        await expect(request).resolves.toMatchObject({ state: "accepted" });
        expect(observed).toEqual([later.toISOString()]);
      } else {
        await expect(request).rejects.toMatchObject({ code: "evidence_not_verified" });
        expect(store.mutationCount).toBe(0);
        expect(observed).toEqual([]);
      }
    },
  );

  it("rejects an earlier reviewed digest after the same case receives a new Jobs proof", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    const port = contributionEvidence(fixture);
    const original = await port.readReviewEvidence?.({
      contributionId: fixture.contributionId,
      contributorUserId: fixture.contributorUserId,
    });
    if (!original) throw new Error("Synthetic proof missing");
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: {
        ...port,
        readReviewEvidence: async () => ({
          ...original,
          evidenceDigestSha256: secondEvidenceDigestSha256,
        }),
      },
      now: () => later,
    });
    await expect(
      service.decideInitialReview({
        reviewerId: fixture.reviewerId,
        caseId: fixture.caseId,
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256,
      }),
    ).rejects.toMatchObject({ code: "evidence_not_verified" });
    expect(store.mutationCount).toBe(0);
    expect(store.cases.get(fixture.caseId)?.version).toBe(1);
  });

  it("requires explicit reviewer read authority and returns no Jobs mutation", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    await expect(
      new TrustApplicationService({ store }).readReviewerCase({
        reviewerId: fixture.reviewerId,
        caseId: fixture.caseId,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "access_denied"));

    const value = await new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
    }).readReviewerCase({ reviewerId: fixture.reviewerId, caseId: fixture.caseId });
    expect(value).toMatchObject({ id: fixture.caseId, contributionId: fixture.contributionId });
    expect(value).not.toHaveProperty("jobMutation");
  });
  it("defaults every account and reviewer operation to deny before persistence", async () => {
    const service = new TrustApplicationService();
    await expect(
      service.readOwnerCase({ contributorUserId: uuidv7(), contributionId: uuidv7() }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "access_denied"));
    await expect(
      service.openReview({ reviewerId: uuidv7(), contributionId: uuidv7() }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "access_denied"));
  });

  it("returns a safe unavailable error when an authority dependency fails", async () => {
    const service = new TrustApplicationService({
      contributorAccountAuthority: {
        authorize: async () => {
          throw new Error("directory details must not escape");
        },
      },
    });
    await expect(
      service.readOwnerCase({ contributorUserId: uuidv7(), contributionId: uuidv7() }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "dependency_unavailable",
        message: "A required Trust dependency is unavailable",
      }),
    );
  });

  it("makes a cross-owner case indistinguishable from a missing case and never mutates it", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    const service = new TrustApplicationService({
      store,
      contributorAccountAuthority: allowContributors(),
      now: () => later,
    });
    await expect(
      service.withdrawOwnerContribution({
        contributorUserId: uuidv7(),
        contributionId: fixture.contributionId,
        expectedVersion: 1,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "not_found"));
    expect(store.mutationCount).toBe(0);
    expect(store.cases.get(fixture.caseId)?.state).toBe("needs_review");
  });

  it("opens only an eligible contribution under the injected approved policy", async () => {
    const store = new MemoryTrustStore();
    const contributionId = uuidv7();
    const contributorUserId = uuidv7();
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: contributionEvidence({ contributionId, contributorUserId }),
      approvedPolicy: approvedPolicy(),
      systemActorId: uuidv7(),
      now: () => now,
    });
    const opened = await service.openReview({
      reviewerId: uuidv7(),
      contributionId,
    });
    expect(opened).toMatchObject({
      contributionId,
      contributorUserId,
      policyVersion: policy.version,
      appealWindowMilliseconds: policy.appealWindowMilliseconds,
      state: "needs_review",
    });
    expect(opened).not.toHaveProperty("catalogMutation");
    expect(opened).not.toHaveProperty("content");
  });

  it("returns the same deterministic case after an ambiguous open retry without a second mutation", async () => {
    const store = new MemoryTrustStore();
    const contributionId = uuidv7();
    const contributorUserId = uuidv7();
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: contributionEvidence({ contributionId, contributorUserId }),
      approvedPolicy: approvedPolicy(),
      systemActorId: uuidv7(),
      now: () => now,
    });

    const first = await service.openReview({ reviewerId: uuidv7(), contributionId });
    const retried = await service.openReview({ reviewerId: uuidv7(), contributionId });

    expect(first.id).toBe(trustCaseIdForContribution(contributionId));
    expect(first.id.split("-")[2]?.startsWith("8")).toBe(true);
    expect(retried).toEqual(first);
    expect(store.cases.size).toBe(1);
    expect(store.mutationCount).toBe(1);
  });

  it("fails closed when contribution evidence, policy, or storage is unavailable", async () => {
    const contributionId = uuidv7();
    const contributorUserId = uuidv7();
    const base = {
      reviewerAuthority: allowReviewers(),
      systemActorId: uuidv7(),
      now: () => now,
    };
    await expect(
      new TrustApplicationService(base).openReview({
        reviewerId: uuidv7(),
        contributionId,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "dependency_unavailable"));

    await expect(
      new TrustApplicationService({
        ...base,
        contributionEvidence: contributionEvidence({ contributionId, contributorUserId }),
        approvedPolicy: { readApprovedPolicy: async () => null },
      }).openReview({ reviewerId: uuidv7(), contributionId }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "policy_unavailable"));

    await expect(
      new TrustApplicationService({
        ...base,
        contributionEvidence: contributionEvidence({ contributionId, contributorUserId }),
        approvedPolicy: approvedPolicy(),
      }).openReview({ reviewerId: uuidv7(), contributionId }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "dependency_unavailable"));
  });

  it("requires verified evidence and exact fixed codes for an initial decision", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    const observedPurposes: string[] = [];
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: {
        ...contributionEvidence(fixture),
        readEligibility: async () => ({
          contributionId: fixture.contributionId,
          contributorUserId: fixture.contributorUserId,
          eligibleForTrustReview: true,
        }),
        verifyEvidence: async (input) => {
          observedPurposes.push(input.purpose);
          return input.evidenceDigestSha256 === evidenceDigestSha256;
        },
      },
      now: () => later,
    });
    await expect(
      service.decideInitialReview({
        reviewerId: fixture.reviewerId,
        caseId: fixture.caseId,
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256: secondEvidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "evidence_not_verified"));
    expect(store.mutationCount).toBe(0);

    const accepted = await service.decideInitialReview({
      reviewerId: fixture.reviewerId,
      caseId: fixture.caseId,
      expectedVersion: 1,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256,
    });
    expect(accepted.state).toBe("accepted");
    expect(observedPurposes).toEqual(["independent_verification"]);

    await expect(
      service.decideInitialReview({
        reviewerId: fixture.reviewerId,
        caseId: uuidv7(),
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "content_mismatch" as "independently_verified",
        evidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "invalid_request"));
  });

  it("enforces optimistic versions before owner and reviewer mutations", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    const service = new TrustApplicationService({
      store,
      contributorAccountAuthority: allowContributors(),
      reviewerAuthority: allowReviewers(),
      contributionEvidence: contributionEvidence({
        contributionId: fixture.contributionId,
        contributorUserId: fixture.contributorUserId,
      }),
      now: () => later,
    });
    await expect(
      service.withdrawOwnerContribution({
        contributorUserId: fixture.contributorUserId,
        contributionId: fixture.contributionId,
        expectedVersion: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "version_conflict"));
    await expect(
      service.decideInitialReview({
        reviewerId: fixture.reviewerId,
        caseId: fixture.caseId,
        expectedVersion: 2,
        outcome: "rejected",
        reasonCode: "insufficient_evidence",
        evidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "version_conflict"));
    expect(store.mutationCount).toBe(0);
  });

  it.each(["verified_requester_takedown", "development_test_removal"] as const)(
    "requires separate authority for the exact %s reason",
    async (reasonCode) => {
      const store = new MemoryTrustStore();
      const fixture = openFixture(store);
      store.cases.set(
        fixture.caseId,
        decideContributionReview(fixture.trustCase, {
          reviewerId: fixture.reviewerId,
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256,
          independentEvidenceDigestSha256: evidenceDigestSha256,
          occurredAt: later,
        }).trustCase,
      );
      const base = {
        store,
        reviewerAuthority: allowReviewers(),
        contributionEvidence: contributionEvidence({
          contributionId: fixture.contributionId,
          contributorUserId: fixture.contributorUserId,
        }),
        now: () => new Date("2026-09-01T14:00:00.000Z"),
      };
      await expect(
        new TrustApplicationService(base).takeDownAcceptedContribution({
          reviewerId: uuidv7(),
          caseId: fixture.caseId,
          expectedVersion: 2,
          reasonCode,
          evidenceDigestSha256,
        }),
      ).rejects.toSatisfy((error: unknown) => expectCode(error, "access_denied"));
      expect(store.mutationCount).toBe(0);

      const takenDown = await new TrustApplicationService({
        ...base,
        verifiedRequesterTakedownAuthority: allowVerifiedRequesters(),
        developmentTestTakedownAuthority: allowVerifiedRequesters(),
      }).takeDownAcceptedContribution({
        reviewerId: uuidv7(),
        caseId: fixture.caseId,
        expectedVersion: 2,
        reasonCode,
        evidenceDigestSha256,
      });
      expect(takenDown.state).toBe("taken_down");
      expect(takenDown).not.toHaveProperty("jobMutation");
    },
  );

  it("rejects the adverse-decision reviewer from resolving the appeal", async () => {
    const store = new MemoryTrustStore();
    const adverseReviewerId = uuidv7();
    const fixture = openFixture(store, { reviewerId: adverseReviewerId });
    const rejected = decideContributionReview(fixture.trustCase, {
      reviewerId: adverseReviewerId,
      outcome: "rejected",
      reasonCode: "content_mismatch",
      evidenceDigestSha256,
      occurredAt: later,
    }).trustCase;
    const appealed = fileTrustAppeal(rejected, {
      contributorUserId: fixture.contributorUserId,
      evidenceDigestSha256: secondEvidenceDigestSha256,
      occurredAt: new Date("2026-09-01T14:00:00.000Z"),
    }).trustCase;
    store.cases.set(fixture.caseId, appealed);
    const service = new TrustApplicationService({
      store,
      reviewerAuthority: allowReviewers(),
      contributionEvidence: contributionEvidence({
        contributionId: fixture.contributionId,
        contributorUserId: fixture.contributorUserId,
      }),
      now: () => new Date("2026-09-01T15:00:00.000Z"),
    });
    await expect(
      service.resolveAppeal({
        reviewerId: adverseReviewerId,
        caseId: fixture.caseId,
        expectedVersion: 3,
        outcome: "upheld",
        evidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "access_denied"));
    expect(store.mutationCount).toBe(0);

    const resolved = await service.resolveAppeal({
      reviewerId: uuidv7(),
      caseId: fixture.caseId,
      expectedVersion: 3,
      outcome: "reversed",
      evidenceDigestSha256,
    });
    expect(resolved).toMatchObject({ state: "accepted", appealCount: 1, version: 4 });
  });

  it("maps invalid and expired state-machine transitions to one safe invalid-state error", async () => {
    const store = new MemoryTrustStore();
    const fixture = openFixture(store);
    const rejected = decideContributionReview(fixture.trustCase, {
      reviewerId: fixture.reviewerId,
      outcome: "rejected",
      reasonCode: "insufficient_evidence",
      evidenceDigestSha256,
      occurredAt: later,
    }).trustCase;
    store.cases.set(fixture.caseId, rejected);
    const service = new TrustApplicationService({
      store,
      contributorAccountAuthority: allowContributors(),
      reviewerAuthority: allowReviewers(),
      contributionEvidence: contributionEvidence({
        contributionId: fixture.contributionId,
        contributorUserId: fixture.contributorUserId,
      }),
      now: () => new Date((rejected.adverseDecision?.appealDeadlineAt.getTime() ?? 0) + 1),
    });
    await expect(
      service.decideInitialReview({
        reviewerId: uuidv7(),
        caseId: fixture.caseId,
        expectedVersion: 2,
        outcome: "rejected",
        reasonCode: "content_mismatch",
        evidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "invalid_state"));
    await expect(
      service.appealOwnerDecision({
        contributorUserId: fixture.contributorUserId,
        contributionId: fixture.contributionId,
        expectedVersion: 2,
        evidenceDigestSha256: secondEvidenceDigestSha256,
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "invalid_state"));
  });
});
