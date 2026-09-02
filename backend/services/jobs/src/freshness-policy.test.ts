import { describe, expect, it } from "vitest";
import {
  planFreshnessClock,
  planFreshnessSignal,
  SourceFreshnessPolicyRegistry,
  type SourceFreshnessPolicy,
} from "./freshness-policy.js";

const policy = {
  provider: "lever",
  pageVariant: "lever-posting-v1",
  policyVersion: "d2-synthetic-freshness-v1",
  suspectAfterHours: 24,
  expiresAfterHours: 72,
} as const satisfies SourceFreshnessPolicy;

const state = {
  status: "active" as const,
  lastVerifiedAt: new Date("2026-09-01T12:00:00.000Z"),
  expiresAt: new Date("2026-09-04T12:00:00.000Z"),
};

describe("source freshness policy", () => {
  it("is default-dark and requires an exact configured provider variant", () => {
    const disabled = new SourceFreshnessPolicyRegistry([]);
    expect(disabled.resolve(policy)).toBeNull();
    expect(() => disabled.require(policy)).toThrow(/disabled/u);

    const enabled = new SourceFreshnessPolicyRegistry([policy]);
    expect(enabled.require(policy)).toEqual(policy);
    expect(
      enabled.resolve({ provider: "greenhouse", pageVariant: "greenhouse-board-v1" }),
    ).toBeNull();
  });

  it("rejects mismatched variants, invalid timings, and duplicate policy keys", () => {
    expect(
      () => new SourceFreshnessPolicyRegistry([{ ...policy, pageVariant: "ashby-job-board-v1" }]),
    ).toThrow(/do not match/u);
    expect(
      () =>
        new SourceFreshnessPolicyRegistry([
          { ...policy, suspectAfterHours: 72, expiresAfterHours: 72 },
        ]),
    ).toThrow(/timing/u);
    expect(() => new SourceFreshnessPolicyRegistry([policy, policy])).toThrow(/duplicated/u);
  });

  it("never lets community observations or reports refresh or close a job", () => {
    const community = planFreshnessSignal(
      state,
      { kind: "community_observation", observedAt: new Date("2026-09-02T12:00:00.000Z") },
      policy,
    );
    expect(community).toMatchObject({
      status: "active",
      revalidationPriority: "normal",
      verificationClockAdvanced: false,
    });
    expect(community.lastVerifiedAt).toEqual(state.lastVerifiedAt);
    expect(community.expiresAt).toEqual(state.expiresAt);

    const report = planFreshnessSignal(
      state,
      { kind: "candidate_closed_report", observedAt: new Date("2026-09-02T12:00:00.000Z") },
      policy,
    );
    expect(report).toMatchObject({
      status: "active",
      revalidationPriority: "high",
      verificationClockAdvanced: false,
    });
  });

  it("advances freshness only from non-stale independent verification", () => {
    const verifiedAt = new Date("2026-09-02T12:00:00.000Z");
    const result = planFreshnessSignal(
      { ...state, status: "suspect_stale" },
      { kind: "independent_positive_verification", verifiedAt },
      policy,
    );
    expect(result).toMatchObject({
      status: "active",
      transitionReason: "independent_positive_verification",
      verificationClockAdvanced: true,
    });
    expect(result.lastVerifiedAt).toEqual(verifiedAt);
    expect(result.expiresAt).toEqual(new Date("2026-09-05T12:00:00.000Z"));
    expect(() =>
      planFreshnessSignal(
        state,
        {
          kind: "independent_positive_verification",
          verifiedAt: new Date("2026-08-31T12:00:00.000Z"),
        },
        policy,
      ),
    ).toThrow(/stale/u);
  });

  it("honors a later source valid-through and exact independent closure", () => {
    const verifiedAt = new Date("2026-09-02T12:00:00.000Z");
    const positive = planFreshnessSignal(
      state,
      {
        kind: "independent_positive_verification",
        verifiedAt,
        validThrough: new Date("2026-09-10T12:00:00.000Z"),
      },
      policy,
    );
    expect(positive.expiresAt).toEqual(new Date("2026-09-10T12:00:00.000Z"));

    const closed = planFreshnessSignal(
      state,
      { kind: "independent_closed_verification", verifiedAt },
      policy,
    );
    expect(closed).toMatchObject({
      status: "withdrawn",
      transitionReason: "independent_closed_verification",
      verificationClockAdvanced: true,
    });
  });

  it("moves active jobs to suspect then expired without changing verification time", () => {
    const suspect = planFreshnessClock(state, new Date("2026-09-02T12:00:00.000Z"), policy);
    expect(suspect).toMatchObject({
      status: "suspect_stale",
      transitionReason: "policy_suspect_window_elapsed",
      revalidationPriority: "high",
      verificationClockAdvanced: false,
    });
    expect(suspect.lastVerifiedAt).toEqual(state.lastVerifiedAt);

    const expired = planFreshnessClock(state, new Date("2026-09-04T12:00:00.000Z"), policy);
    expect(expired).toMatchObject({
      status: "expired",
      transitionReason: "policy_expiry_window_elapsed",
      revalidationPriority: "none",
      verificationClockAdvanced: false,
    });
  });

  it("does not let positive source evidence reverse an administrative block", () => {
    expect(() =>
      planFreshnessSignal(
        { ...state, status: "blocked" },
        {
          kind: "independent_positive_verification",
          verifiedAt: new Date("2026-09-02T12:00:00.000Z"),
        },
        policy,
      ),
    ).toThrow(/administrative block/u);
  });
});
