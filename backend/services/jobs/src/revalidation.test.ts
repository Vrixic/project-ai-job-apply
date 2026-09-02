import { describe, expect, it, vi } from "vitest";
import { SourceFreshnessPolicyRegistry } from "./freshness-policy.js";
import {
  DenyAdministrativeFreshnessAuthority,
  type RevalidationQueueItem,
  SourceRevalidationService,
  type SourceRevalidationStore,
} from "./revalidation.js";

const identity = {
  jobId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e20",
  sourceId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e21",
  provider: "lever",
  pageVariant: "lever-posting-v1",
} as const;
const policy = {
  provider: "lever",
  pageVariant: "lever-posting-v1",
  policyVersion: "synthetic-lever-v1",
  suspectAfterHours: 24,
  expiresAfterHours: 72,
} as const;
const now = new Date("2026-09-01T12:00:00.000Z");

function fakeStore(): SourceRevalidationStore {
  const queue: RevalidationQueueItem = {
    ...identity,
    id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e22",
    signalKind: "community_observation",
    priority: "normal",
    state: "pending",
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
  };
  return {
    enqueue: vi.fn(async (input) => ({
      ...queue,
      signalKind: input.signalKind,
      priority: input.priority,
    })),
    claim: vi.fn(async () => []),
    failClaim: vi.fn(async ({ item }) => ({ ...item, state: "pending" as const })),
    recordIndependentEvidence: vi.fn(async (input) => ({
      jobId: input.jobId,
      fromStatus: "active" as const,
      toStatus:
        input.evidenceKind === "independent_closed_verification"
          ? ("withdrawn" as const)
          : ("active" as const),
      replayed: false,
    })),
    applyFreshnessClock: vi.fn(async (source) => ({
      jobId: source.jobId,
      fromStatus: "active" as const,
      toStatus: "active" as const,
      replayed: true,
    })),
    recordAdministrativeBlock: vi.fn(async (input) => ({
      jobId: input.jobId,
      fromStatus: "active" as const,
      toStatus: "blocked" as const,
      replayed: false,
    })),
  };
}

function service(store = fakeStore(), authority = new DenyAdministrativeFreshnessAuthority()) {
  return {
    store,
    value: new SourceRevalidationService(
      store,
      new SourceFreshnessPolicyRegistry([policy]),
      {
        maxAttempts: 3,
        claimLeaseMilliseconds: 30_000,
        retryDelayMilliseconds: [1_000, 5_000],
      },
      authority,
    ),
  };
}

describe("SourceRevalidationService", () => {
  it("turns community observations and candidate closed reports into digest-only priorities", async () => {
    const { store, value } = service();
    await value.enqueueCommunitySignal({
      identity,
      kind: "community_observation",
      signalReference: "contribution:synthetic-0001",
      observedAt: now,
    });
    await value.enqueueCommunitySignal({
      identity,
      kind: "candidate_closed_report",
      signalReference: "report:synthetic-0002",
      observedAt: now,
    });

    expect(store.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        signalKind: "community_observation",
        priority: "normal",
        signalDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(store.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        signalKind: "candidate_closed_report",
        priority: "high",
        signalDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(store.recordIndependentEvidence).not.toHaveBeenCalled();
    expect(store.recordAdministrativeBlock).not.toHaveBeenCalled();
  });

  it("requires an injected provider-variant policy and bounded queue configuration", async () => {
    const { value } = service();
    await expect(
      value.enqueueCommunitySignal({
        identity: { ...identity, provider: "greenhouse", pageVariant: "greenhouse-board-v1" },
        kind: "community_observation",
        signalReference: "contribution:synthetic-0001",
        observedAt: now,
      }),
    ).rejects.toThrow("disabled for this provider variant");
    expect(
      () =>
        new SourceRevalidationService(fakeStore(), new SourceFreshnessPolicyRegistry([policy]), {
          maxAttempts: 3,
          claimLeaseMilliseconds: 30_000,
          retryDelayMilliseconds: [],
        }),
    ).toThrow("explicit bounded revalidation queue policy");
  });

  it("bounds claims and computes retry timing from injected values", async () => {
    const { store, value } = service();
    await value.claim("worker:synthetic", now, 25);
    expect(store.claim).toHaveBeenCalledWith({
      workerId: "worker:synthetic",
      now,
      claimExpiresAt: new Date("2026-09-01T12:00:30.000Z"),
      limit: 25,
    });
    const claimed: RevalidationQueueItem = {
      ...identity,
      id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e22",
      signalKind: "candidate_closed_report",
      priority: "high",
      state: "claimed",
      attempt: 2,
      maxAttempts: 3,
      availableAt: now,
      claimedBy: "worker:synthetic",
      claimExpiresAt: new Date("2026-09-01T12:00:30.000Z"),
    };
    await value.failClaim(claimed, "worker:synthetic", now, "SyntheticFailure");
    expect(store.failClaim).toHaveBeenCalledWith(
      expect.objectContaining({ retryAt: new Date("2026-09-01T12:00:05.000Z") }),
    );
    await expect(value.claim("worker:synthetic", now, 26)).rejects.toThrow(
      "between one and twenty-five",
    );
  });

  it("fails closed for administrative mutation and accepts it only through injected authority", async () => {
    const input = {
      jobId: identity.jobId,
      decisionId: "decision:synthetic-001",
      evidenceDigestSha256: "a".repeat(64),
      policyVersion: "admin-policy-v1",
      reasonCode: "verified_malicious_listing",
      decidedAt: now,
      recordedAt: now,
    };
    await expect(service().value.recordAdministrativeBlock(input)).rejects.toThrow(
      "authority denied",
    );
    const authority = { authorize: vi.fn(async () => true) };
    const allowed = service(fakeStore(), authority);
    await expect(allowed.value.recordAdministrativeBlock(input)).resolves.toMatchObject({
      toStatus: "blocked",
    });
    expect(authority.authorize).toHaveBeenCalledOnce();
    expect(allowed.store.recordAdministrativeBlock).toHaveBeenCalledOnce();
  });

  it("rejects unhashed independent evidence and impossible chronology", async () => {
    const { value } = service();
    await expect(
      value.recordIndependentEvidence({
        ...identity,
        evidenceKind: "independent_positive_verification",
        evidenceDigestSha256: "raw-provider-response",
        verifiedAt: now,
        recordedAt: now,
      }),
    ).rejects.toThrow("digest is invalid");
    await expect(
      value.recordIndependentEvidence({
        ...identity,
        evidenceKind: "independent_positive_verification",
        evidenceDigestSha256: "b".repeat(64),
        verifiedAt: new Date(now.getTime() + 1),
        recordedAt: now,
      }),
    ).rejects.toThrow("before verification");
  });
});
