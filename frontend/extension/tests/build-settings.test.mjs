import { describe, expect, it } from "vitest";
import {
  applicationHandoffOriginForBuild,
  assertStoreContributionMode,
  capabilityPolicyPublicKeysForBuild,
  developmentContributionProvidersForBuild,
  parseDevelopmentContributions,
} from "../build-settings.mjs";

describe("manual application handoff build boundary", () => {
  const enabled = {
    EXTENSION_APPLICATION_HANDOFF_ENABLED: "true",
    EXTENSION_APPLICATION_HANDOFF_WEB_ORIGIN: "https://candidate.example",
  };
  it("defaults off and requires an exact explicit HTTPS origin", () => {
    expect(applicationHandoffOriginForBuild({}, {})).toBe("");
    expect(applicationHandoffOriginForBuild(enabled, {})).toBe("https://candidate.example");
    expect(applicationHandoffOriginForBuild({}, enabled)).toBe("https://candidate.example");
    for (const origin of [
      "http://candidate.example",
      "https://user@candidate.example",
      "https://candidate.example/jobs",
      "https://candidate.example?x=1",
      "https://candidate.example#x",
      "",
    ]) {
      expect(() =>
        applicationHandoffOriginForBuild(
          { ...enabled, EXTENSION_APPLICATION_HANDOFF_WEB_ORIGIN: origin },
          {},
        ),
      ).toThrow();
    }
    for (const value of ["", "TRUE", "enabled", true]) {
      expect(() =>
        applicationHandoffOriginForBuild(
          { ...enabled, EXTENSION_APPLICATION_HANDOFF_ENABLED: value },
          {},
        ),
      ).toThrow();
    }
  });
  it("rejects store packaging even when the other source overrides enabled configuration", () => {
    const disabled = { EXTENSION_APPLICATION_HANDOFF_ENABLED: "false" };
    for (const [environment, file] of [
      [enabled, {}],
      [{}, enabled],
      [disabled, enabled],
      [enabled, disabled],
    ]) {
      expect(() => assertStoreContributionMode(environment, file)).toThrow("unpacked-only");
    }
  });
});

describe("development contribution build and store boundary", () => {
  it("retains Greenhouse by default only in explicit development mode", () => {
    expect(developmentContributionProvidersForBuild({}, {}, true)).toEqual(["greenhouse"]);
    expect(developmentContributionProvidersForBuild({}, {}, false)).toEqual([]);
    expect(Object.isFrozen(developmentContributionProvidersForBuild({}, {}, true))).toBe(true);
  });
  it.each([[], ["greenhouse"], ["lever"], ["ashby"], ["greenhouse", "lever", "ashby"]])(
    "parses and freezes exact opt-in selection %j from either source",
    (...providers) => {
      const configured = {
        EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: JSON.stringify(providers),
      };
      for (const [environment, file] of [
        [configured, {}],
        [{}, configured],
      ]) {
        const parsed = developmentContributionProvidersForBuild(environment, file, true);
        expect(parsed).toEqual([...providers].sort());
        expect(Object.isFrozen(parsed)).toBe(true);
      }
    },
  );
  it("allows an explicit empty process selection to deny all despite local configuration", () => {
    expect(
      developmentContributionProvidersForBuild(
        { EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: "[]" },
        { EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse"]' },
        true,
      ),
    ).toEqual([]);
  });
  it.each([
    "",
    " ",
    "null",
    "{}",
    '"greenhouse"',
    '["lever","lever"]',
    '["unknown"]',
    '["Greenhouse"]',
    '[" lever"]',
    '["lever",false]',
    '["lever",null]',
    "[1]",
    '["__proto__"]',
    '["greenhouse","lever","ashby","greenhouse"]',
    "[",
    "[]".padEnd(129),
  ])("rejects malformed explicit provider selection %s", (value) => {
    for (const [environment, file] of [
      [{ EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: value }, {}],
      [{}, { EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: value }],
    ]) {
      expect(() => developmentContributionProvidersForBuild(environment, file, true)).toThrow(
        "must be a JSON array",
      );
    }
  });
  it("rejects any configured provider selection outside development and during store packaging", () => {
    for (const value of ["[]", '["greenhouse"]', '["lever"]', '["ashby"]', "", "malformed"]) {
      const configured = { EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: value };
      for (const [environment, file] of [
        [configured, {}],
        [{}, configured],
      ]) {
        expect(() => developmentContributionProvidersForBuild(environment, file, false)).toThrow(
          "require explicit unpacked development mode",
        );
        expect(() => assertStoreContributionMode(environment, file)).toThrow(
          "require explicit unpacked development mode",
        );
      }
    }
  });
  it("does not access or parse retired signing keys in development, even when malformed", () => {
    const inaccessible = Object.defineProperty({}, "EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON", {
      get() {
        throw new Error("Retired keys must not be accessed");
      },
    });
    expect(capabilityPolicyPublicKeysForBuild(inaccessible, inaccessible, true)).toEqual({});
    for (const value of ["{malformed", "retired-placeholder", "[1]", "null", "", " "]) {
      expect(
        capabilityPolicyPublicKeysForBuild(
          { EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: value },
          {},
          true,
        ),
      ).toEqual({});
      expect(
        capabilityPolicyPublicKeysForBuild(
          {},
          { EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: value },
          true,
        ),
      ).toEqual({});
    }
  });
  it("preserves key parsing and fail-closed malformed-key behavior for default signed builds", () => {
    const keys = { "synthetic-key-v1": "A".repeat(48) };
    expect(
      capabilityPolicyPublicKeysForBuild(
        { EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: JSON.stringify(keys) },
        {},
        false,
      ),
    ).toEqual(keys);
    expect(
      capabilityPolicyPublicKeysForBuild(
        {},
        { EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: JSON.stringify(keys) },
        false,
      ),
    ).toEqual(keys);
    expect(
      capabilityPolicyPublicKeysForBuild(
        { EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: "{malformed" },
        {},
        false,
      ),
    ).toEqual({});
    expect(capabilityPolicyPublicKeysForBuild({}, {}, false)).toEqual({});
  });
  it("defaults to signed mode and accepts only exact string booleans", () => {
    expect(parseDevelopmentContributions(undefined)).toBe(false);
    expect(parseDevelopmentContributions("false")).toBe(false);
    expect(parseDevelopmentContributions("true")).toBe(true);
    for (const invalid of ["", "TRUE", "False", "1", "yes", " true ", true, false, null]) {
      expect(() => parseDevelopmentContributions(invalid)).toThrow("must be exactly true or false");
    }
  });
  it("refuses store packaging with active development config from either source, even if overridden", () => {
    const enabled = { EXTENSION_DEVELOPMENT_CONTRIBUTIONS: "true" };
    const disabled = { EXTENSION_DEVELOPMENT_CONTRIBUTIONS: "false" };
    for (const [environment, file] of [
      [enabled, {}],
      [{}, enabled],
      [disabled, enabled],
      [enabled, disabled],
    ]) {
      expect(() => assertStoreContributionMode(environment, file)).toThrow("unpacked-only");
    }
    expect(() => assertStoreContributionMode({}, {})).not.toThrow();
    expect(() => assertStoreContributionMode(disabled, disabled)).not.toThrow();
    expect(() =>
      assertStoreContributionMode({ EXTENSION_DEVELOPMENT_CONTRIBUTIONS: "yes" }, {}),
    ).toThrow();
  });
});
