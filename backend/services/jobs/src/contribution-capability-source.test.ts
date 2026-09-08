import { describe, expect, it } from "vitest";
import type { ContributionCapabilityInput } from "./contribution-capability-policy.js";
import {
  contributionCapabilitySourceFromEnvironment,
  DevelopmentContributionCapabilitySource,
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
  DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
} from "./contribution-capability-source.js";

const environment = () => ({
  D2_DEPLOYMENT_ENVIRONMENT: "development",
  D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
  D2_CONTRIBUTION_ROUTES_ENABLED: "true",
  D2_COMMUNITY_RUNTIME_ENABLED: "true",
});
const input = (): ContributionCapabilityInput => ({
  stage: "processing",
  clientVersion: "0.2.0",
  provider: "greenhouse",
  pageVariant: "greenhouse-board-v1",
  domain: "job-boards.greenhouse.io",
  now: new Date("2050-09-08T12:00:00.000Z"),
});

describe("explicit development contribution capability", () => {
  it("needs no key, signature or manually renewed deadline and issues a short operation lease", async () => {
    const source = contributionCapabilitySourceFromEnvironment(environment(), () => input().now);
    expect(source).toBeInstanceOf(DevelopmentContributionCapabilitySource);
    expect(source).not.toHaveProperty("readPublicEnvelope");
    if (!(source instanceof DevelopmentContributionCapabilitySource)) throw new Error("fixture");
    for (const stage of ["intake", "processing"] as const) {
      const decision = await source.authorize({ ...input(), stage });
      expect(decision).toMatchObject({
        allowed: true,
        policyRevision: "d2-development-greenhouse-v1",
        configurationDigestSha256: DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
        evaluatedAt: "2050-09-08T12:00:00.000Z",
        expiresAt: "2050-09-08T12:01:00.000Z",
      });
    }
    const first = await source.authorize(input());
    const next = await source.authorize({
      ...input(),
      now: new Date(input().now.getTime() + 86_400_000),
    });
    expect(next).toMatchObject({
      allowed: true,
      configurationDigestSha256: DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
    });
    if (first.allowed && next.allowed) {
      expect(Date.parse(next.expiresAt) - Date.parse(next.evaluatedAt)).toBe(
        DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
      );
      expect(next.expiresAt).not.toBe(first.expiresAt);
    }
  });

  it.each([undefined, "production", "staging", "Development", "development "])(
    "refuses environment %s",
    (deployment) => {
      expect(() =>
        contributionCapabilitySourceFromEnvironment(
          { ...environment(), D2_DEPLOYMENT_ENVIRONMENT: deployment },
          () => input().now,
        ),
      ).toThrow();
    },
  );

  it("is default-off and refuses invented boolean syntax", () => {
    expect(contributionCapabilitySourceFromEnvironment({}, () => input().now)).toBeNull();
    expect(
      contributionCapabilitySourceFromEnvironment(
        { D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "false" },
        () => input().now,
      ),
    ).toBeNull();
    for (const value of ["TRUE", "1", " true", ""]) {
      expect(() =>
        contributionCapabilitySourceFromEnvironment(
          { ...environment(), D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: value },
          () => input().now,
        ),
      ).toThrow();
    }
  });

  it.each([
    [{ clientVersion: "0.2.1" }, "client_disabled"],
    [
      { provider: "lever", pageVariant: "lever-posting-v1", domain: "jobs.lever.co" },
      "provider_disabled",
    ],
    [
      { provider: "ashby", pageVariant: "ashby-job-board-v1", domain: "jobs.ashbyhq.com" },
      "provider_disabled",
    ],
    [{ pageVariant: "lever-posting-v1" }, "variant_disabled"],
    [{ domain: "job-boards.greenhouse.io.example.test" }, "domain_disabled"],
    [{ domain: "localhost" }, "domain_disabled"],
    [{ domain: "JOB-BOARDS.GREENHOUSE.IO" }, "domain_disabled"],
  ] as const)("retains exact scope %o", async (change, reason) => {
    const source = new DevelopmentContributionCapabilitySource(environment());
    expect(await source.authorize({ ...input(), ...change })).toEqual({ allowed: false, reason });
  });

  it("rechecks global and independent stage disables on each use", async () => {
    const values = environment();
    const source = new DevelopmentContributionCapabilitySource(values);
    values.D2_COMMUNITY_RUNTIME_ENABLED = "false";
    expect(await source.authorize(input())).toEqual({ allowed: false, reason: "global_disabled" });
    expect(
      await source.authorize({ ...input(), stage: "intake", domain: "boards.greenhouse.io" }),
    ).toMatchObject({ allowed: true });
    values.D2_CONTRIBUTION_ROUTES_ENABLED = "false";
    expect(await source.authorize({ ...input(), stage: "intake" })).toEqual({
      allowed: false,
      reason: "global_disabled",
    });
    values.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED = "false";
    expect(await source.authorize(input())).toEqual({ allowed: false, reason: "global_disabled" });
    values.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED = "true";
    values.D2_DEPLOYMENT_ENVIRONMENT = "production";
    await expect(source.authorize(input())).rejects.toThrow();
  });
});
