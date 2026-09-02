import { describe, expect, it } from "vitest";
import {
  capabilityForPage,
  type ExtensionDetectorActivationPolicy,
  parseDetectorActivationPolicy,
} from "../lib/capability-policy";

const enabled: ExtensionDetectorActivationPolicy = {
  schemaVersion: 1,
  revision: "d2-synthetic-detectors-v1",
  extensionVersion: "0.2.0",
  enabledProviders: { ashby: false, greenhouse: false, lever: true },
  enabledVariants: {
    "ashby-job-board-v1": false,
    "greenhouse-board-v1": false,
    "lever-posting-v1": true,
  },
  enabledDomains: {
    "boards.greenhouse.io": false,
    "job-boards.greenhouse.io": false,
    "jobs.ashbyhq.com": false,
    "jobs.eu.lever.co": false,
    "jobs.lever.co": true,
  },
};

describe("reviewed extension detector activation", () => {
  it("keeps inspection default-dark without an exact build-time policy", () => {
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", undefined)).toEqual({
      allowed: false,
      reason: "configuration_missing",
    });
    expect(parseDetectorActivationPolicy({})).toBeUndefined();
    expect(
      parseDetectorActivationPolicy({
        ...enabled,
        remoteCode: "https://attacker.example/detector.js",
      }),
    ).toBeUndefined();
  });

  it("enables only an explicitly reviewed exact version/provider/variant/domain tuple", () => {
    expect(parseDetectorActivationPolicy(enabled)).toEqual(enabled);
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", enabled)).toEqual({
      allowed: true,
      provider: "lever",
      variant: "lever-posting-v1",
    });
  });

  it("denies unsupported versions, providers, variants, domains, and hosts independently", () => {
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.2.1", enabled)).toEqual({
      allowed: false,
      reason: "version_disabled",
    });
    expect(capabilityForPage("https://jobs.ashbyhq.com/example/job", "0.2.0", enabled)).toEqual({
      allowed: false,
      reason: "provider_disabled",
    });
    expect(
      capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", {
        ...enabled,
        enabledVariants: { ...enabled.enabledVariants, "lever-posting-v1": false },
      }),
    ).toEqual({ allowed: false, reason: "variant_disabled" });
    expect(
      capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", {
        ...enabled,
        enabledDomains: { ...enabled.enabledDomains, "jobs.lever.co": false },
      }),
    ).toEqual({ allowed: false, reason: "domain_disabled" });
    expect(
      capabilityForPage("https://jobs.lever.co.attacker.example/job", "0.2.0", enabled),
    ).toEqual({ allowed: false, reason: "unsupported_page" });
  });

  it("rejects structurally incomplete or overbroad detector policies", () => {
    expect(
      parseDetectorActivationPolicy({
        ...enabled,
        enabledProviders: { lever: true },
      }),
    ).toBeUndefined();
    expect(
      parseDetectorActivationPolicy({
        ...enabled,
        enabledDomains: { ...enabled.enabledDomains, "attacker.example": true },
      }),
    ).toBeUndefined();
    expect(
      parseDetectorActivationPolicy({
        ...enabled,
        extensionVersion: "latest",
      }),
    ).toBeUndefined();
  });
});
