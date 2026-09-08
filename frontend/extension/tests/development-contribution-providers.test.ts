import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDetectorActivationPolicy } from "../lib/capability-policy";
import { extensionPublicConfiguration } from "../lib/config";
import {
  DEVELOPMENT_CONTRIBUTION_PROVIDERS,
  parseDevelopmentContributionProviders,
} from "../lib/development-contribution-providers";
import { DevelopmentContributionRuntime } from "../lib/development-contributions";
import type { AtsProvider, JobPageVariant, SanitizedJobCapture } from "../lib/job-capture";

const detector = {
  schemaVersion: 1,
  revision: "synthetic-all-providers-v1",
  extensionVersion: "0.2.0",
  enabledProviders: { greenhouse: true, lever: true, ashby: true },
  enabledVariants: {
    "greenhouse-board-v1": true,
    "lever-posting-v1": true,
    "ashby-job-board-v1": true,
  },
  enabledDomains: {
    "boards.greenhouse.io": true,
    "job-boards.greenhouse.io": true,
    "jobs.lever.co": true,
    "jobs.eu.lever.co": true,
    "jobs.ashbyhq.com": true,
  },
};
const cases = [
  ["greenhouse", "greenhouse-board-v1", "boards.greenhouse.io"],
  ["greenhouse", "greenhouse-board-v1", "job-boards.greenhouse.io"],
  ["lever", "lever-posting-v1", "jobs.lever.co"],
  ["lever", "lever-posting-v1", "jobs.eu.lever.co"],
  ["ashby", "ashby-job-board-v1", "jobs.ashbyhq.com"],
] as const;

function captureFor([provider, pageVariant, domain]: readonly [
  AtsProvider,
  JobPageVariant,
  string,
]): SanitizedJobCapture {
  return {
    provider,
    pageVariant,
    sourceUrl: `https://${domain}/synthetic${provider === "greenhouse" ? "/jobs" : ""}/123`,
    adapterVersion: "d2-job-page-v1",
    capturedAt: "2026-09-08T12:00:00.000Z",
    title: "Synthetic role",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("fixed opt-in development provider descriptors", () => {
  it("deep-freezes the descriptors and never expands exact host or variant scope", () => {
    expect(Object.isFrozen(DEVELOPMENT_CONTRIBUTION_PROVIDERS)).toBe(true);
    for (const [provider, variant, domain] of cases) {
      const descriptor = DEVELOPMENT_CONTRIBUTION_PROVIDERS[provider];
      expect(descriptor.variant).toBe(variant);
      expect(descriptor.domains).toContain(domain);
      expect(descriptor.revision).toBe(`d2-development-${provider}-persistent-v1`);
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.domains)).toBe(true);
    }
    expect(
      Object.values(DEVELOPMENT_CONTRIBUTION_PROVIDERS)
        .flatMap((value) => value.domains)
        .sort(),
    ).toEqual(cases.map(([, , domain]) => domain).sort());
  });

  it.each(cases)(
    "permits only explicitly selected %s %s on %s without policy I/O",
    async (...row) => {
      const fetcher = vi.fn(() => {
        throw new Error("Policy fetch forbidden");
      });
      vi.stubGlobal("fetch", fetcher);
      const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(detector), [
        row[0],
      ]);
      await runtime.start();
      await runtime.refresh();
      await runtime.refreshForReadiness();
      expect(runtime.decision(captureFor(row), "0.2.0", new Date("2099-01-01"))).toEqual({
        allowed: true,
        policyRevision: `d2-development-${row[0]}-persistent-v1`,
      });
      for (const other of cases.filter(([provider]) => provider !== row[0])) {
        expect(runtime.decision(captureFor(other), "0.2.0")).toEqual({
          allowed: false,
          reason: "provider_disabled",
        });
      }
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("preserves default Greenhouse behavior and denies all on an explicit empty selection", () => {
    const defaultRuntime = new DevelopmentContributionRuntime(
      parseDetectorActivationPolicy(detector),
    );
    const emptyRuntime = new DevelopmentContributionRuntime(
      parseDetectorActivationPolicy(detector),
      [],
    );
    for (const row of cases) {
      expect(defaultRuntime.decision(captureFor(row), "0.2.0").allowed).toBe(
        row[0] === "greenhouse",
      );
      expect(emptyRuntime.decision(captureFor(row), "0.2.0").allowed).toBe(false);
    }
  });

  it.each(cases)("still requires every independent detector dimension for %s %s %s", (...row) => {
    for (const policy of [
      undefined,
      { ...detector, extensionVersion: "0.2.1" },
      { ...detector, enabledProviders: { ...detector.enabledProviders, [row[0]]: false } },
      { ...detector, enabledVariants: { ...detector.enabledVariants, [row[1]]: false } },
      { ...detector, enabledDomains: { ...detector.enabledDomains, [row[2]]: false } },
    ]) {
      const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(policy), [
        row[0],
      ]);
      expect(runtime.decision(captureFor(row), "0.2.0").allowed).toBe(false);
    }
  });

  it.each(cases)("rejects client, variant and domain spoofing for %s %s %s", (...row) => {
    const runtime = new DevelopmentContributionRuntime(parseDetectorActivationPolicy(detector), [
      "greenhouse",
      "lever",
      "ashby",
    ]);
    const capture = captureFor(row);
    for (const version of ["0.1.0", "0.2.1", "0.2.0-dev", ""]) {
      expect(runtime.decision(capture, version).allowed).toBe(false);
    }
    for (const other of cases.filter(([provider]) => provider !== row[0])) {
      expect(runtime.decision({ ...capture, pageVariant: other[1] }, "0.2.0").allowed).toBe(false);
      expect(
        runtime.decision({ ...capture, sourceUrl: captureFor(other).sourceUrl }, "0.2.0").allowed,
      ).toBe(false);
    }
    for (const sourceUrl of [
      `http://${row[2]}/synthetic/123`,
      `https://user@${row[2]}/synthetic/123`,
      `https://${row[2]}:444/synthetic/123`,
      `https://${row[2]}.evil.test/synthetic/123`,
      "https://localhost/synthetic/123",
      "https://127.0.0.1/synthetic/123",
      "not-a-url",
    ]) {
      expect(runtime.decision({ ...capture, sourceUrl }, "0.2.0").allowed).toBe(false);
    }
  });

  it("defensively rejects malformed injected lists instead of silently enabling a subset", () => {
    for (const invalid of [
      null,
      "lever",
      {},
      ["unknown"],
      ["__proto__"],
      [false],
      [null],
      ["lever", "lever"],
      ["greenhouse", "lever", "ashby", "greenhouse"],
      new Array(1),
    ]) {
      expect(parseDevelopmentContributionProviders(invalid)).toEqual([]);
      const runtime = new DevelopmentContributionRuntime(
        parseDetectorActivationPolicy(detector),
        invalid as AtsProvider[],
      );
      for (const row of cases)
        expect(runtime.decision(captureFor(row), "0.2.0").allowed).toBe(false);
    }
  });

  it("copies and freezes selections and removes them entirely outside development mode", () => {
    const selected: AtsProvider[] = ["lever"];
    const configuration = extensionPublicConfiguration({
      audience: "ai-job-apply-api",
      clientId: "synthetic",
      domain: "tenant.example.test",
      developmentContributions: true,
      developmentContributionProviders: selected,
    });
    const runtime = new DevelopmentContributionRuntime(
      parseDetectorActivationPolicy(detector),
      selected,
    );
    selected.push("ashby");
    expect(configuration.developmentContributionProviders).toEqual(["lever"]);
    expect(Object.isFrozen(configuration.developmentContributionProviders)).toBe(true);
    expect(runtime.decision(captureFor(cases[4]), "0.2.0").allowed).toBe(false);
    expect(
      extensionPublicConfiguration({
        audience: "ai-job-apply-api",
        clientId: "synthetic",
        domain: "tenant.example.test",
        developmentContributions: false,
        developmentContributionProviders: selected,
      }).developmentContributionProviders,
    ).toEqual([]);
  });
});
