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
const answered = {
  "authorization.us_authorized": true,
  "authorization.sponsorship_required": false,
} as const;
const complete = {
  personal: personal(),
  education: [education()],
  screening: answered,
  requireScreening: true,
  salary: 120_000,
};

describe("missingBasics", () => {
  it("is empty when the profile holds every basic and screening answer", () => {
    expect(missingBasics(complete)).toEqual([]);
  });
  it("names everything missing from an empty profile, in the order it is asked", () => {
    expect(
      missingBasics({
        personal: undefined,
        education: [],
        screening: {},
        requireScreening: true,
        salary: undefined,
      }).map((m) => [m.key, m.section]),
    ).toEqual([
      ["name", "personal"],
      ["email", "personal"],
      ["phone", "personal"],
      ["education", "education"],
      ["salary", "salary"],
      ["authorization.us_authorized", "screening"],
      ["authorization.sponsorship_required", "screening"],
    ]);
  });
  it("needs a first and a last name, not a single word", () => {
    expect(
      missingBasics({ ...complete, personal: personal({ fullName: "Pat" }) }).map((m) => m.key),
    ).toEqual(["name"]);
  });
  it("needs a degree and a field of study, not only a school", () => {
    for (const omitted of ["degree", "fieldOfStudy"] as const)
      expect(
        missingBasics({ ...complete, education: [without(education(), omitted)] }).map(
          (m) => m.key,
        ),
      ).toEqual(["education"]);
  });
  it("judges the first education entry, which is the one an application uses", () => {
    const later = education({ displayOrder: 1 });
    const incomplete = without(education({ displayOrder: 0 }), "degree");
    expect(missingBasics({ ...complete, education: [later, incomplete] })).toHaveLength(1);
    expect(missingBasics({ ...complete, education: [incomplete, later] })).toHaveLength(1);
    expect(
      missingBasics({ ...complete, education: [later, education({ displayOrder: 0 })] }),
    ).toEqual([]);
  });
  it("does not ask for the screening answers until they are required", () => {
    expect(
      missingBasics({
        personal: personal(),
        education: [education()],
        screening: {},
        salary: 120_000,
      }),
    ).toEqual([]);
  });
  it("needs the desired salary, which every salary question is answered from", () => {
    expect(missingBasics({ ...complete, salary: undefined })).toEqual([
      { key: "salary", label: "Your desired annual salary", section: "salary" },
    ]);
    // Asked even while the screening answers are not yet required.
    expect(
      missingBasics({ ...complete, requireScreening: false, salary: undefined }).map((m) => m.key),
    ).toEqual(["salary"]);
  });
  it("counts a No as an answer, and an unanswered question as missing", () => {
    expect(
      missingBasics({
        ...complete,
        screening: { "authorization.us_authorized": false },
      }).map((m) => m.key),
    ).toEqual(["authorization.sponsorship_required"]);
  });
});
