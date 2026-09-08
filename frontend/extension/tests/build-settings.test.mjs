import { describe, expect, it } from "vitest";
import {
  assertStoreContributionMode,
  capabilityPolicyPublicKeysForBuild,
  parseDevelopmentContributions,
} from "../build-settings.mjs";

describe("development contribution build and store boundary", () => {
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
