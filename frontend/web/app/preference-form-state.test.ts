import type { JobPreferenceSet } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import {
  buildJobPreferenceRequest,
  emptyJobPreferenceFields,
  hydrateJobPreferenceFields,
  type JobPreferenceFields,
  normalizePreferenceValues,
  toggleOrderedChoice,
  type WorkMode,
} from "./preference-form-state";

describe("job preference form state", () => {
  it("starts with intentionally empty fields", () => {
    expect(emptyJobPreferenceFields()).toEqual({
      targetRoles: [""],
      locations: [],
      workModes: [],
      employmentTypes: [],
      salaryMinimum: "",
      salaryCurrency: "",
      legacySponsorshipPresent: false,
    });
  });

  it("hydrates every persisted preference without sharing its arrays", () => {
    const preferences: JobPreferenceSet = {
      id: "019c0000-0000-7000-8000-000000000001",
      version: 2,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Software\nEngineer", "Platform Engineer"],
      locations: ["New York,\nNY", "Boston, MA"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time", "contract"],
      salaryMinimum: 125_000,
      salaryCurrency: "USD",
    };

    const fields = hydrateJobPreferenceFields(preferences);

    expect(fields).toEqual({
      targetRoles: ["Software\nEngineer", "Platform Engineer"],
      locations: ["New York,\nNY", "Boston, MA"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time", "contract"],
      salaryMinimum: "125000",
      salaryCurrency: "USD",
      legacySponsorshipPresent: false,
    });
    expect(fields.targetRoles).not.toBe(preferences.targetRoles);
    expect(fields.locations).not.toBe(preferences.locations);
    expect(fields.workModes).not.toBe(preferences.workModes);
    expect(fields.employmentTypes).not.toBe(preferences.employmentTypes);
    expect(buildJobPreferenceRequest(fields)).toMatchObject({
      ok: true,
      request: {
        targetRoles: ["Software\nEngineer", "Platform Engineer"],
        locations: ["New York,\nNY", "Boston, MA"],
      },
    });
  });

  it("hydrates omitted optional values as blank and unspecified", () => {
    expect(
      hydrateJobPreferenceFields({
        id: "019c0000-0000-7000-8000-000000000001",
        version: 1,
        updatedAt: "2026-08-15T12:00:00.000Z",
        targetRoles: ["Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      }),
    ).toMatchObject({
      salaryMinimum: "",
      salaryCurrency: "",
      legacySponsorshipPresent: false,
    });
  });

  it("trims and removes duplicate array values while preserving commas and newlines", () => {
    expect(
      normalizePreferenceValues([
        " Engineer, Platform ",
        "",
        "Designer\nSystems",
        "Engineer, Platform",
        " QA, Automation ",
      ]),
    ).toEqual(["Engineer, Platform", "Designer\nSystems", "QA, Automation"]);
  });

  it("toggles choices into option order and removes unchecked values", () => {
    const options: WorkMode[] = ["remote", "hybrid", "on_site"];

    expect(toggleOrderedChoice(options, ["on_site"], "remote", true)).toEqual([
      "remote",
      "on_site",
    ]);
    expect(toggleOrderedChoice(options, ["remote", "hybrid"], "remote", false)).toEqual(["hybrid"]);
  });

  it("serializes the exact complete request with stable text values", () => {
    expect(
      buildJobPreferenceRequest({
        targetRoles: [" Platform Engineer", "Software Engineer", "Platform Engineer "],
        locations: [" New York, NY", "Boston, MA", "New York, NY "],
        workModes: ["remote", "hybrid"],
        employmentTypes: ["full_time", "contract"],
        salaryMinimum: " 125000 ",
        salaryCurrency: " usd ",
        legacySponsorshipPresent: false,
      }),
    ).toEqual({
      ok: true,
      request: {
        targetRoles: ["Platform Engineer", "Software Engineer"],
        locations: ["New York, NY", "Boston, MA"],
        workModes: ["remote", "hybrid"],
        employmentTypes: ["full_time", "contract"],
        salaryMinimum: 125_000,
        salaryCurrency: "USD",
      },
    });
  });

  it("allows flexible locations and omits unspecified optional values", () => {
    expect(
      buildJobPreferenceRequest({
        targetRoles: ["Engineer"],
        locations: [" "],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        salaryMinimum: "",
        salaryCurrency: "",
        legacySponsorshipPresent: false,
      }),
    ).toEqual({
      ok: true,
      request: {
        targetRoles: ["Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      },
    });
  });

  const requiredCases: [Partial<JobPreferenceFields>, string][] = [
    [{ targetRoles: [""] }, "Add at least one target role."],
    [{ workModes: [] }, "Select at least one work mode."],
    [{ employmentTypes: [] }, "Select at least one employment type."],
  ];

  it.each(requiredCases)("rejects a missing required choice group", (override, message) => {
    expect(
      buildJobPreferenceRequest({
        targetRoles: ["Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        salaryMinimum: "",
        salaryCurrency: "",
        legacySponsorshipPresent: false,
        ...override,
      }),
    ).toEqual({ ok: false, message });
  });

  it.each([
    ["100000", "", "Enter both a salary minimum and currency, or leave both blank."],
    ["", "USD", "Enter both a salary minimum and currency, or leave both blank."],
    ["12.50", "USD", "Salary minimum must be a non-negative whole number."],
    ["-1", "USD", "Salary minimum must be a non-negative whole number."],
    ["100000", "US", "Salary currency must be a three-letter code."],
  ])("rejects an invalid salary pair", (salaryMinimum, salaryCurrency, message) => {
    expect(
      buildJobPreferenceRequest({
        targetRoles: ["Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        salaryMinimum,
        salaryCurrency,
        legacySponsorshipPresent: false,
      }),
    ).toEqual({ ok: false, message });
  });

  it.each([true, false])("refuses to overwrite a legacy sponsorship value of %s", (value) => {
    const fields = hydrateJobPreferenceFields({
      id: "019c0000-0000-7000-8000-000000000002",
      version: 1,
      updatedAt: "2026-08-15T12:00:00.000Z",
      targetRoles: ["Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
      requiresSponsorship: value,
    });

    expect(fields).not.toHaveProperty("sponsorship");
    expect(buildJobPreferenceRequest(fields)).toEqual({
      ok: false,
      message:
        "These saved preferences contain a legacy sponsorship answer. Saving is unavailable until that answer moves to the restricted-data boundary.",
    });
  });
});
