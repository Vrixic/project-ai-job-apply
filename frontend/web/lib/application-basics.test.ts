import type { ProfileEducationEntry, ProfilePersonal } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { missingBasics } from "./application-basics";

const NOW = "2026-11-05T12:00:00.000Z";
const personal = (extra: Partial<ProfilePersonal> = {}): ProfilePersonal => ({
  version: 1,
  origin: "entered",
  createdAt: NOW,
  updatedAt: NOW,
  fullName: "Pat Candidate",
  email: "pat@example.invalid",
  phone: "+1 415 555 0100",
  ...extra,
});
const education = (extra: Partial<ProfileEducationEntry> = {}): ProfileEducationEntry => ({
  id: "00000000-0000-7000-8000-000000000001",
  school: "Synthetic University",
  degree: "Bachelor of Science",
  fieldOfStudy: "Computer Science",
  version: 1,
  origin: "entered",
  createdAt: NOW,
  updatedAt: NOW,
  displayOrder: 0,
  ...extra,
});
const without = (entry: ProfileEducationEntry, key: "degree" | "fieldOfStudy") => {
  const { [key]: _omitted, ...rest } = entry;
  return rest;
};

describe("missingBasics", () => {
  it("is empty when the profile holds every basic", () => {
    expect(missingBasics({ personal: personal(), education: [education()] })).toEqual([]);
  });
  it("names everything missing from an empty profile", () => {
    expect(missingBasics({ personal: undefined, education: [] }).map((m) => m.key)).toEqual([
      "name",
      "email",
      "phone",
      "education",
    ]);
  });
  it("needs a first and a last name, not a single word", () => {
    expect(
      missingBasics({ personal: personal({ fullName: "Pat" }), education: [education()] }).map(
        (m) => m.key,
      ),
    ).toEqual(["name"]);
  });
  it("needs a degree and a field of study, not only a school", () => {
    for (const omitted of ["degree", "fieldOfStudy"] as const)
      expect(
        missingBasics({
          personal: personal(),
          education: [without(education(), omitted)],
        }).map((m) => m.key),
      ).toEqual(["education"]);
  });
  it("judges the first education entry, which is the one an application uses", () => {
    const complete = education({ displayOrder: 1 });
    const incomplete = without(education({ displayOrder: 0 }), "degree");
    expect(missingBasics({ personal: personal(), education: [complete, incomplete] })).toHaveLength(
      1,
    );
    expect(
      missingBasics({
        personal: personal(),
        education: [incomplete, complete].reverse(),
      }),
    ).toHaveLength(1);
    expect(
      missingBasics({
        personal: personal(),
        education: [complete, education({ displayOrder: 0 })],
      }),
    ).toEqual([]);
  });
});
