import { describe, expect, it } from "vitest";
import {
  capabilityForPage,
  DEFAULT_DARK_POLICY,
  type ExtensionCapabilityPolicy,
} from "../lib/capability-policy";

describe("extension domain and version kill switches", () => {
  it("keeps every provider default-off", () => {
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.2.0")).toEqual({
      allowed: false,
      reason: "provider_disabled",
    });
    expect(Object.values(DEFAULT_DARK_POLICY.enabledProviders).every((value) => !value)).toBe(true);
  });

  it("requires exact version, supported host, and an unblocked domain", () => {
    const enabled: ExtensionCapabilityPolicy = {
      ...DEFAULT_DARK_POLICY,
      enabledProviders: { ...DEFAULT_DARK_POLICY.enabledProviders, lever: true },
    };
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.1.0", enabled)).toEqual({
      allowed: false,
      reason: "version_disabled",
    });
    expect(
      capabilityForPage("https://jobs.lever.co.attacker.example/job", "0.2.0", enabled),
    ).toEqual({ allowed: false, reason: "unsupported_page" });
    expect(
      capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", {
        ...enabled,
        disabledDomains: ["jobs.lever.co"],
      }),
    ).toEqual({ allowed: false, reason: "domain_disabled" });
    expect(capabilityForPage("https://jobs.lever.co/example/job", "0.2.0", enabled)).toEqual({
      allowed: true,
      provider: "lever",
    });
  });
});
