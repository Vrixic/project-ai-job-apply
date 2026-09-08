import { describe, expect, it } from "vitest";
import { parseDetectorActivationPolicy } from "../lib/capability-policy";
import { extensionPublicConfiguration } from "../lib/config";
import { DevelopmentContributionRuntime } from "../lib/development-contributions";
import type { SanitizedJobCapture } from "../lib/job-capture";

const detector = {
  schemaVersion: 1,
  revision: "synthetic-detector-v1",
  extensionVersion: "0.2.0",
  enabledProviders: { greenhouse: true, lever: false, ashby: false },
  enabledVariants: {
    "greenhouse-board-v1": true,
    "lever-posting-v1": false,
    "ashby-job-board-v1": false,
  },
  enabledDomains: {
    "boards.greenhouse.io": true,
    "job-boards.greenhouse.io": true,
    "jobs.lever.co": false,
    "jobs.eu.lever.co": false,
    "jobs.ashbyhq.com": false,
  },
};
const capture: SanitizedJobCapture = {
  adapterVersion: "d2-job-page-v1",
  capturedAt: "2026-09-08T12:00:00.000Z",
  pageVariant: "greenhouse-board-v1",
  provider: "greenhouse",
  sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
  title: "Synthetic role",
};

describe("explicit unpacked development contributions", () => {
  it("stays disabled unless its build-time boolean is exactly true", () => {
    const base = {
      audience: "ai-job-apply-api",
      clientId: "synthetic-client",
      domain: "tenant.example.test",
    };
    expect(extensionPublicConfiguration(base).developmentContributions).toBe(false);
    expect(
      extensionPublicConfiguration({ ...base, developmentContributions: false })
        .developmentContributions,
    ).toBe(false);
    expect(
      extensionPublicConfiguration({ ...base, developmentContributions: true })
        .developmentContributions,
    ).toBe(true);
    expect(
      extensionPublicConfiguration({
        ...base,
        developmentContributions: "true" as unknown as boolean,
      }).developmentContributions,
    ).toBe(false);
  });
  it("requires no clock, keys, cache or remote renewal even far in the future", async () => {
    expect(
      extensionPublicConfiguration({
        audience: "ai-job-apply-api",
        clientId: "synthetic-client",
        domain: "tenant.example.test",
        developmentContributions: true,
        capabilityPolicyPublicKeys: { "synthetic-key": "A".repeat(48) },
      }).capabilityPolicyPublicKeys,
    ).toEqual({});
    const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(detector));
    expect(await runtime.start()).toBe(true);
    expect(await runtime.refresh()).toBe(true);
    expect(await runtime.refreshForReadiness()).toBe(true);
    expect(runtime.decision(capture, "0.2.0", new Date("2099-01-01T00:00:00.000Z"))).toEqual({
      allowed: true,
      policyRevision: "d2-development-greenhouse-persistent-v1",
    });
    expect(
      runtime.decision(
        { ...capture, sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/123" },
        "0.2.0",
      ).allowed,
    ).toBe(true);
  });
  it.each(["0.1.0", "0.2.1", "0.2.0-dev", "1.0.0"])("refuses unaccepted client %s", (version) => {
    const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(detector));
    expect(runtime.decision(capture, version)).toEqual({
      allowed: false,
      reason: "client_disabled",
    });
  });
  it.each([
    {
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: "https://jobs.lever.co/synthetic/123",
    },
    {
      provider: "ashby",
      pageVariant: "ashby-job-board-v1",
      sourceUrl: "https://jobs.ashbyhq.com/synthetic/123",
    },
    { pageVariant: "lever-posting-v1" },
    { sourceUrl: "https://job-boards.greenhouse.io.evil.example/synthetic/jobs/123" },
    { sourceUrl: "http://job-boards.greenhouse.io/synthetic/jobs/123" },
    { sourceUrl: "https://secret@job-boards.greenhouse.io/synthetic/jobs/123" },
    { sourceUrl: "https://job-boards.greenhouse.io:444/synthetic/jobs/123" },
  ])(
    "refuses providers, variants and domains outside the accepted development set: %j",
    (changes) => {
      const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(detector));
      expect(
        runtime.decision({ ...capture, ...changes } as SanitizedJobCapture, "0.2.0").allowed,
      ).toBe(false);
    },
  );
  it("continues enforcing the independent detector activation dimensions", () => {
    for (const value of [
      undefined,
      {},
      { ...detector, extensionVersion: "0.2.1" },
      { ...detector, enabledProviders: { ...detector.enabledProviders, greenhouse: false } },
      {
        ...detector,
        enabledVariants: { ...detector.enabledVariants, "greenhouse-board-v1": false },
      },
      {
        ...detector,
        enabledDomains: { ...detector.enabledDomains, "job-boards.greenhouse.io": false },
      },
    ]) {
      const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(value));
      expect(runtime.decision(capture, "0.2.0").allowed).toBe(false);
    }
  });
});
