import { describe, expect, it } from "vitest";
import { compileComponentValidator } from "./index.js";

describe("PutJobPreferencesRequest", () => {
  const validate = compileComponentValidator("PutJobPreferencesRequest");

  it("accepts a minimal valid preference set", () => {
    expect(
      validate({
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      }),
    ).toBe(true);
  });

  it("rejects unknown fields and incomplete salary values", () => {
    expect(
      validate({
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        salaryMinimum: 100_000,
        interviewStatus: "scheduled",
      }),
    ).toBe(false);
  });
});
