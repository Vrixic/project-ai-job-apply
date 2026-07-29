import { describe, expect, it } from "vitest";
import { calculateProfileReadiness } from "./index.js";

describe("calculateProfileReadiness", () => {
  it("reports missing optional discovery constraints deterministically", () => {
    const result = calculateProfileReadiness(
      {
        targetRoles: ["Data Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      },
      new Date("2026-07-28T12:00:00.000Z"),
    );

    expect(result).toEqual({
      completionPercent: 67,
      missingFields: ["locations", "salary"],
      calculatedAt: "2026-07-28T12:00:00.000Z",
    });
  });
});
