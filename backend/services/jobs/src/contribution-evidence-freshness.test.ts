import { describe, expect, it } from "vitest";
import { isContributionEvidenceFresh } from "./contribution-evidence-freshness.js";

describe("independent contribution evidence freshness", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  it.each([
    ["2026-09-09T12:00:00.000Z", true],
    ["2026-09-08T12:00:00.000Z", true],
    ["2026-09-08T11:59:59.999Z", false],
    ["2026-09-09T12:00:00.001Z", false],
    ["2026-09-09T12:00:00Z", false],
    ["invalid", false],
  ] as const)("bounds exact timestamp %s", (value, expected) => {
    expect(isContributionEvidenceFresh(value, now)).toBe(expected);
  });
});
