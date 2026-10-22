import { FactGraph, profileEntriesToGraphFacts } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import { coverLetterContext, selectPromptFacts } from "./context.js";
import { checkParagraphs } from "./grounding.js";

const userId = "019d04cf-1f80-7000-8000-000000000001";
const workId = "019d04cf-1f80-7000-8000-000000000011";
const skillId = "019d04cf-1f80-7000-8000-000000000031";
const now = new Date("2026-10-22T12:00:00Z");

const entries = {
  userId,
  personal: { version: 1, fullName: "Jordan Example", email: "jordan@example.test" },
  education: [],
  workExperience: [
    {
      id: workId,
      version: 1,
      company: "Example Systems",
      title: "Senior Engineer",
      startDate: "2020-01-01",
      bullets: ["Built a synthetic ingestion pipeline serving 40 teams."],
    },
  ],
  skills: [{ id: skillId, version: 1, name: "TypeScript" }],
};

describe("ADR-030 grounding over saved Profile entries (ADR-052)", () => {
  const facts = profileEntriesToGraphFacts(entries);
  const graph = FactGraph.build(facts, now);
  const context = { jobTerms: ["Acme Robotics", "Platform Engineer"] };

  it("accepts a paragraph whose claims come from the cited entries", () => {
    const findings = checkParagraphs(
      [
        {
          text: "I built a synthetic ingestion pipeline serving 40 teams at Example Systems using TypeScript.",
          factIds: [workId, skillId],
        },
      ],
      graph,
      context,
    );
    expect(findings).toEqual([]);
  });

  it("flags numbers, employers and citations that no saved entry supports", () => {
    const codes = (text: string, factIds: string[]) =>
      checkParagraphs([{ text, factIds }], graph, context).map((finding) => finding.code);
    expect(codes("I built a pipeline serving 400 teams at Example Systems.", [workId])).toContain(
      "ungrounded_number",
    );
    expect(codes("I led work at Globex Industries with TypeScript.", [workId, skillId])).toContain(
      "ungrounded_entity",
    );
    expect(codes("I know TypeScript well.", [])).toContain("no_evidence");
    expect(codes("I know TypeScript well.", ["019d04cf-1f80-7000-8000-0000000000ff"])).toContain(
      "unknown_fact",
    );
  });

  it("changes the evidence hash when a saved entry changes, and ignores unsaved content", () => {
    const job = { title: "Engineer", company: "Acme Robotics", description: "Build things." };
    const before = coverLetterContext({ facts, now, job });
    const edited = profileEntriesToGraphFacts({
      ...entries,
      workExperience: [
        { ...(entries.workExperience[0] as object), version: 2, title: "Staff Engineer" } as never,
      ],
    });
    expect(coverLetterContext({ facts: edited, now, job }).confirmedFactsHash).not.toBe(
      before.confirmedFactsHash,
    );
    expect(coverLetterContext({ facts, now, job })).toEqual(before);
    // Only generation kinds reach a provider: contact details never do.
    const selected = selectPromptFacts(graph, facts);
    expect(selected.some((fact) => fact.kind === "identity")).toBe(false);
    expect(selected.map((fact) => fact.id)).toContain(workId);
  });
});
