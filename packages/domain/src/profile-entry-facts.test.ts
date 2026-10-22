import { describe, expect, it } from "vitest";
import { FactGraph } from "./fact-graph.js";
import {
  personalRecordId,
  profileEntriesToGraphFacts,
  profileEntryReference,
} from "./profile-entry-facts.js";

const userId = "019d04cf-1f80-7000-8000-000000000001";
const workId = "019d04cf-1f80-7000-8000-000000000011";
const oldWorkId = "019d04cf-1f80-7000-8000-000000000012";
const schoolId = "019d04cf-1f80-7000-8000-000000000021";
const skillId = "019d04cf-1f80-7000-8000-000000000031";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const input = {
  userId,
  personal: {
    version: 3,
    fullName: "Jordan Q Example",
    email: "jordan@example.test",
    phone: "(555) 010-0100",
    address: {
      street: "1 Synthetic Way",
      city: "Synthetic City",
      region: "SC",
      postalCode: "00000",
    },
    links: [
      { kind: "linkedin", url: "https://linkedin.com/in/jordan" },
      { kind: "other", url: "https://example.test" },
    ],
  },
  education: [
    {
      id: schoolId,
      version: 2,
      school: "Example University",
      degree: "BS",
      fieldOfStudy: "Computer Science",
      startDate: "2013-09-01",
      endDate: "2017-05-01",
    },
  ],
  workExperience: [
    {
      id: workId,
      version: 4,
      company: "Example Systems",
      title: "Senior Engineer",
      startDate: "2020-01-01",
      bullets: ["Built a synthetic pipeline.", "Led five engineers."],
    },
    {
      id: oldWorkId,
      version: 1,
      company: "Sample Labs",
      title: "Engineer",
      startDate: "2017-06-01",
      endDate: "2019-12-01",
    },
  ],
  skills: [{ id: skillId, version: 1, name: "TypeScript" }],
};

describe("profile entries as grounding facts (ADR-052)", () => {
  const facts = profileEntriesToGraphFacts(input);
  const graph = FactGraph.build(facts, new Date("2026-10-22T00:00:00Z"));

  it("yields only confirmed, usable facts with valid identifiers, even for past end dates", () => {
    expect(facts.length).toBeGreaterThan(10);
    for (const item of facts) {
      expect(item.id).toMatch(UUID);
      expect(item.verification).toBe("confirmed");
      expect(item.effectiveFrom).toBeUndefined();
      expect(item.effectiveTo).toBeUndefined();
      expect(graph.usability(item.id)).toMatchObject({ usable: true, confidence: 1 });
    }
    expect(new Set(facts.map((item) => item.id)).size).toBe(facts.length);
  });

  it("is deterministic and tracks the record version in the facts", () => {
    expect(profileEntriesToGraphFacts(input)).toEqual(facts);
    const edited = profileEntriesToGraphFacts({
      ...input,
      workExperience: [
        { ...(input.workExperience[0] as object), version: 5, title: "Staff Engineer" } as never,
      ],
    });
    const before = facts.find((item) => item.id === workId);
    const after = edited.find((item) => item.id === workId);
    expect(after?.value).not.toEqual(before?.value);
    expect(after?.version).toBe(5);
  });

  it("offers exactly one fact for each packet field the Applications mapping reads", () => {
    const one = (kind: string, key: string) => graph.usable(kind, key).map((item) => item.value);
    expect(one("identity", "legal_name.first")).toEqual(["Jordan"]);
    expect(one("identity", "legal_name.middle")).toEqual(["Q"]);
    expect(one("identity", "legal_name.last")).toEqual(["Example"]);
    expect(one("identity", "email")).toEqual(["jordan@example.test"]);
    expect(one("identity", "address.line1")).toEqual(["1 Synthetic Way"]);
    expect(one("identity", "linkedin")).toEqual(["https://linkedin.com/in/jordan"]);
    expect(one("identity", "github")).toEqual([]);
    // The current job is the first saved entry without an end date.
    expect(one("employment", "current_company")).toEqual(["Example Systems"]);
    expect(one("employment", "current_title")).toEqual(["Senior Engineer"]);
    expect(one("employment", "start_date")).toEqual(["2020-01-01"]);
    // Packet education fields come from the first saved entry.
    expect(one("education", "school")).toEqual(["Example University"]);
    expect(one("education", "field")).toEqual(["Computer Science"]);
    expect(one("education", "graduation_date")).toEqual(["2017-05-01"]);
  });

  it("gives each record fact its own record id and a resolvable reference", () => {
    const role = facts.find((item) => item.id === workId);
    expect(role).toMatchObject({ kind: "employment", key: "role", sensitivity: "standard" });
    expect(role?.value).toEqual([
      "Senior Engineer at Example Systems",
      "2020-01-01 to present",
      "Built a synthetic pipeline.",
      "Led five engineers.",
    ]);
    expect(profileEntryReference(role as never)).toEqual({
      section: "workExperience",
      entryId: workId,
      version: 4,
    });
    const email = graph.usable("identity", "email")[0];
    expect(profileEntryReference(email as never)).toEqual({
      section: "personal",
      entryId: personalRecordId(userId),
      version: 3,
    });
    expect(
      profileEntryReference({ source: { type: "user", reference: "direct-entry" } }),
    ).toBeUndefined();
  });

  it("derives no value that the record does not contain", () => {
    const sparse = profileEntriesToGraphFacts({
      userId,
      personal: { version: 1, fullName: "Mononym" },
      education: [],
      workExperience: [],
      skills: [],
    });
    expect(sparse.map((item) => item.key)).toEqual(["legal_name.first"]);
    expect(
      profileEntriesToGraphFacts({
        userId,
        personal: null,
        education: [],
        workExperience: [],
        skills: [],
      }),
    ).toEqual([]);
  });
});
