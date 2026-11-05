import type {
  ProfileEducationEntry,
  ProfilePersonal,
  RestrictedAnswer,
} from "@ai-job-apply/api-contracts";
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
const answer = (fieldKey: string, state: "active" | "deleted" = "active"): RestrictedAnswer =>
  ({
    id: "00000000-0000-7000-8000-000000000002",
    fieldKey,
    valueType: "boolean",
    sensitivity: "restricted",
    state,
    version: 1,
    confirmedAt: NOW,
  }) as RestrictedAnswer;
const both = [answer("authorization.us_authorized"), answer("authorization.sponsorship_required")];

describe("missingBasics", () => {
  it("is empty when the profile holds every basic", () => {
    expect(
      missingBasics({ personal: personal(), education: [education()], restricted: both }),
    ).toEqual([]);
  });
  it("names everything missing from an empty profile", () => {
    expect(
      missingBasics({ personal: undefined, education: [], restricted: [] }).map((m) => m.key),
    ).toEqual([
      "name",
      "email",
      "phone",
      "education",
      "authorization.us_authorized",
      "authorization.sponsorship_required",
    ]);
  });
  it("needs a first and a last name, not a single word", () => {
    expect(
      missingBasics({
        personal: personal({ fullName: "Pat" }),
        education: [education()],
        restricted: both,
      }).map((m) => m.key),
    ).toEqual(["name"]);
  });
  it("needs a degree and a field of study, not only a school", () => {
    for (const omitted of ["degree", "fieldOfStudy"] as const) {
      const { [omitted]: _omitted, ...entry } = education();
      expect(
        missingBasics({ personal: personal(), education: [entry], restricted: both }).map(
          (m) => m.key,
        ),
      ).toEqual(["education"]);
    }
  });
  it("accepts any one complete education entry among several", () => {
    expect(
      missingBasics({
        personal: personal(),
        education: [(({ degree: _degree, ...rest }) => rest)(education()), education()],
        restricted: both,
      }),
    ).toEqual([]);
  });
  it("ignores a deleted saved answer and does not require answers the vault does not offer", () => {
    expect(
      missingBasics({
        personal: personal(),
        education: [education()],
        restricted: [answer("authorization.us_authorized", "deleted"), both[1] as RestrictedAnswer],
      }).map((m) => m.key),
    ).toEqual(["authorization.us_authorized"]);
    expect(
      missingBasics({ personal: personal(), education: [education()], restricted: undefined }),
    ).toEqual([]);
  });
});
