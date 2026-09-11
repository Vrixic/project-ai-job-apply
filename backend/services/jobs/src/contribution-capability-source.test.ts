import { describe, expect, it } from "vitest";
import type { ContributionCapabilityInput } from "./contribution-capability-policy.js";
import {
  contributionCapabilitySourceFromEnvironment,
  DEVELOPMENT_CONTRIBUTION_CAPABILITIES,
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
  DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
  DevelopmentContributionCapabilitySource,
  developmentContributionDescriptorForLease,
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
  it("preserves the deployed Greenhouse descriptor and pins distinct new provider identities", () => {
    expect(DEVELOPMENT_CONTRIBUTION_CAPABILITIES.greenhouse.configurationDigestSha256).toBe(
      "8405c7ba82d4d5d127b9bfb0f2f753533d6709d0b89e148a02a1db89c03f1f3b",
    );
    expect(DEVELOPMENT_CONTRIBUTION_CAPABILITIES.lever.configurationDigestSha256).toBe(
      "73a8de43f172d1af75c19e355774ccbb63c10d08485b5cabeb8df524571c3d5c",
    );
    expect(DEVELOPMENT_CONTRIBUTION_CAPABILITIES.ashby.configurationDigestSha256).toBe(
      "5b03a431328af9850b9c08bd8f1508089e4de2d2c31f91b490ebb63a573ae8f5",
    );
    for (const descriptor of Object.values(DEVELOPMENT_CONTRIBUTION_CAPABILITIES)) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.domains)).toBe(true);
      expect(
        developmentContributionDescriptorForLease(
          descriptor.version,
          descriptor.configurationDigestSha256,
        ),
      ).toBe(descriptor);
      for (const other of Object.values(DEVELOPMENT_CONTRIBUTION_CAPABILITIES)) {
        if (other !== descriptor)
          expect(
            developmentContributionDescriptorForLease(
              descriptor.version,
              other.configurationDigestSha256,
            ),
          ).toBeUndefined();
      }
    }
    expect(
      developmentContributionDescriptorForLease("d2-development-unknown-v1", "a".repeat(64)),
    ).toBeUndefined();
  });

  it.each(["greenhouse", "lever", "ashby"] as const)(
    "authorizes only explicitly selected %s dimensions at both stages",
    async (provider) => {
      const source = new DevelopmentContributionCapabilitySource({
        ...environment(),
        D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: JSON.stringify([provider]),
      });
      const descriptor = DEVELOPMENT_CONTRIBUTION_CAPABILITIES[provider];
      for (const stage of ["intake", "processing"] as const) {
        for (const domain of descriptor.domains) {
          const request = {
            ...input(),
            stage,
            provider,
            pageVariant: descriptor.pageVariant,
            domain,
          };
          expect(await source.authorize(request)).toMatchObject({
            allowed: true,
            policyRevision: descriptor.version,
            configurationDigestSha256: descriptor.configurationDigestSha256,
          });
          expect(await source.authorize({ ...request, domain: `${domain}.example.test` })).toEqual({
            allowed: false,
            reason: "domain_disabled",
          });
          expect(await source.authorize({ ...request, clientVersion: "0.2.1" })).toEqual({
            allowed: false,
            reason: "client_disabled",
          });
          for (const other of Object.values(DEVELOPMENT_CONTRIBUTION_CAPABILITIES)) {
            if (other.provider === provider) continue;
            expect(await source.authorize({ ...request, pageVariant: other.pageVariant })).toEqual({
              allowed: false,
              reason: "variant_disabled",
            });
            expect(await source.authorize({ ...request, provider: other.provider })).toEqual({
              allowed: false,
              reason: "provider_disabled",
            });
          }
        }
      }
    },
  );

  it("rechecks independent provider disables without changing other provider lease identities", async () => {
    const values = {
      ...environment(),
      D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse","lever","ashby"]',
    };
    const source = new DevelopmentContributionCapabilitySource(values);
    expect(await source.authorize(input())).toMatchObject({
      allowed: true,
      configurationDigestSha256: DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
    });
    values.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = '["lever"]';
    expect(await source.authorize(input())).toEqual({
      allowed: false,
      reason: "provider_disabled",
    });
    const lever = {
      ...input(),
      provider: "lever" as const,
      pageVariant: "lever-posting-v1" as const,
      domain: "jobs.lever.co",
    };
    expect(await source.authorize(lever)).toMatchObject({ allowed: true });
    values.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = "[]";
    expect(await source.authorize(lever)).toEqual({ allowed: false, reason: "provider_disabled" });
    values.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = '["lever","lever"]';
    await expect(source.authorize(lever)).rejects.toThrow();
  });

  it.each(["intake", "processing"] as const)(
    "independently narrows both exact Lever hosts at %s without changing descriptor identity",
    async (stage) => {
      const values: NodeJS.ProcessEnv = {
        ...environment(),
        D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse","lever","ashby"]',
        D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON:
          '["boards.greenhouse.io","job-boards.greenhouse.io","jobs.lever.co","jobs.ashbyhq.com"]',
      };
      const source = new DevelopmentContributionCapabilitySource(values);
      const request = {
        ...input(),
        stage,
        provider: "lever" as const,
        pageVariant: "lever-posting-v1" as const,
        domain: "jobs.lever.co",
      };
      const allowed = await source.authorize(request);
      expect(allowed).toMatchObject({
        allowed: true,
        policyRevision: DEVELOPMENT_CONTRIBUTION_CAPABILITIES.lever.version,
        configurationDigestSha256:
          DEVELOPMENT_CONTRIBUTION_CAPABILITIES.lever.configurationDigestSha256,
      });
      expect(await source.authorize({ ...request, domain: "jobs.eu.lever.co" })).toEqual({
        allowed: false,
        reason: "domain_disabled",
      });
      expect(await source.authorize({ ...input(), stage })).toMatchObject({ allowed: true });
      expect(
        await source.authorize({
          ...input(),
          stage,
          provider: "ashby",
          pageVariant: "ashby-job-board-v1",
          domain: "jobs.ashbyhq.com",
        }),
      ).toMatchObject({ allowed: true });

      values.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON = '["jobs.eu.lever.co"]';
      expect(await source.authorize(request)).toEqual({
        allowed: false,
        reason: "domain_disabled",
      });
      expect(await source.authorize({ ...request, domain: "jobs.eu.lever.co" })).toMatchObject({
        allowed: true,
        policyRevision: DEVELOPMENT_CONTRIBUTION_CAPABILITIES.lever.version,
        configurationDigestSha256:
          DEVELOPMENT_CONTRIBUTION_CAPABILITIES.lever.configurationDigestSha256,
      });
      values.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON = undefined;
      expect(await source.authorize(request)).toEqual(allowed);
      expect(await source.authorize({ ...request, domain: "jobs.eu.lever.co" })).toEqual(allowed);
    },
  );

  it("rereads domain denial both within an issued lease and when a retry would renew it", async () => {
    const values = {
      ...environment(),
      D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["lever"]',
      D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: '["jobs.lever.co"]',
    };
    const source = new DevelopmentContributionCapabilitySource(values);
    const request = {
      ...input(),
      provider: "lever" as const,
      pageVariant: "lever-posting-v1" as const,
      domain: "jobs.lever.co",
    };
    const first = await source.authorize(request);
    expect(first).toMatchObject({ allowed: true });
    values.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON = "[]";
    for (const elapsed of [1, DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS + 1]) {
      for (const stage of ["intake", "processing"] as const) {
        expect(
          await source.authorize({
            ...request,
            stage,
            now: new Date(request.now.getTime() + elapsed),
          }),
        ).toEqual({ allowed: false, reason: "domain_disabled" });
      }
    }
    values.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON = '["jobs.lever.co","jobs.lever.co"]';
    await expect(source.authorize(request)).rejects.toThrow();
    expect(first).toMatchObject({ allowed: true });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("denies every descriptor domain for an explicit empty selection at both stages", async () => {
    const source = new DevelopmentContributionCapabilitySource({
      ...environment(),
      D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse","lever","ashby"]',
      D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: "[]",
    });
    for (const descriptor of Object.values(DEVELOPMENT_CONTRIBUTION_CAPABILITIES)) {
      for (const domain of descriptor.domains) {
        for (const stage of ["intake", "processing"] as const) {
          expect(
            await source.authorize({
              ...input(),
              stage,
              provider: descriptor.provider,
              pageVariant: descriptor.pageVariant,
              domain,
            }),
          ).toEqual({ allowed: false, reason: "domain_disabled" });
        }
      }
    }
  });

  it.each([
    "jobs.lever.co.example.test",
    "jobs.eu.lever.co.example.test",
    "jobs.lever.co.",
    "JOBS.LEVER.CO",
    "https://jobs.lever.co",
    "jobs.lever.co:443",
    "jobs.lever.co@other.example.test",
    "jobs.lever.co ",
    "eu.lever.co",
    "localhost",
  ])("never normalizes a false domain into the selected exact Lever host: %s", async (domain) => {
    const source = new DevelopmentContributionCapabilitySource({
      ...environment(),
      D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["lever"]',
      D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: '["jobs.lever.co"]',
    });
    for (const stage of ["intake", "processing"] as const) {
      expect(
        await source.authorize({
          ...input(),
          stage,
          provider: "lever",
          pageVariant: "lever-posting-v1",
          domain,
        }),
      ).toEqual({ allowed: false, reason: "domain_disabled" });
    }
  });

  it("keeps provider, variant, client and independent stage gates above the extra domain selection", async () => {
    const values = {
      ...environment(),
      D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: '["job-boards.greenhouse.io","jobs.lever.co"]',
    };
    const source = new DevelopmentContributionCapabilitySource(values);
    expect(
      await source.authorize({
        ...input(),
        provider: "lever",
        pageVariant: "lever-posting-v1",
        domain: "jobs.lever.co",
      }),
    ).toEqual({ allowed: false, reason: "provider_disabled" });
    expect(await source.authorize({ ...input(), domain: "jobs.lever.co" })).toEqual({
      allowed: false,
      reason: "domain_disabled",
    });
    expect(await source.authorize({ ...input(), pageVariant: "lever-posting-v1" })).toEqual({
      allowed: false,
      reason: "variant_disabled",
    });
    expect(await source.authorize({ ...input(), clientVersion: "0.2.1" })).toEqual({
      allowed: false,
      reason: "client_disabled",
    });
    values.D2_CONTRIBUTION_ROUTES_ENABLED = "false";
    expect(await source.authorize({ ...input(), stage: "intake" })).toEqual({
      allowed: false,
      reason: "global_disabled",
    });
    expect(await source.authorize(input())).toMatchObject({ allowed: true });
    values.D2_CONTRIBUTION_ROUTES_ENABLED = "true";
    values.D2_COMMUNITY_RUNTIME_ENABLED = "false";
    expect(await source.authorize(input())).toEqual({ allowed: false, reason: "global_disabled" });
    expect(await source.authorize({ ...input(), stage: "intake" })).toMatchObject({
      allowed: true,
    });
  });

  it.each(["null", "{}", '"jobs.lever.co"', '["jobs.lever.co","jobs.lever.co"]', ""])(
    "rejects malformed domain settings at source construction: %s",
    (selection) => {
      expect(() =>
        contributionCapabilitySourceFromEnvironment(
          { ...environment(), D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: selection },
          () => input().now,
        ),
      ).toThrow();
    },
  );

  it.each(["", "[]", '["jobs.lever.co"]'])(
    "rejects development domain settings in signed/default composition: %s",
    (selection) => {
      expect(() =>
        contributionCapabilitySourceFromEnvironment(
          { D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON: selection },
          () => input().now,
        ),
      ).toThrow();
    },
  );

  it.each([
    "null",
    "{}",
    '"lever"',
    '["unknown"]',
    '["Lever"]',
    '["lever",null]',
    '["lever","lever"]',
    "",
  ])("rejects malformed provider configuration %s", (selection) => {
    expect(() =>
      contributionCapabilitySourceFromEnvironment(
        { ...environment(), D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: selection },
        () => input().now,
      ),
    ).toThrow();
  });

  it("does not silently consume development provider settings in signed/default mode", () => {
    expect(() =>
      contributionCapabilitySourceFromEnvironment(
        { D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["lever"]' },
        () => input().now,
      ),
    ).toThrow();
  });

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
