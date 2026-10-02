import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "./gateway.js";
import {
  generateCoverLetter,
  groundCoverLetterOutput,
  prepareCoverLetterPrompt,
} from "./generation.js";
import { ScriptedProvider } from "./testing.js";

const now = new Date("2026-10-02T12:00:00.000Z");
const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
const fact: GraphFact = {
  id: "synthetic-skill",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};
const context = { facts: [fact], now, job };
const draft = (text = "I have experience with TypeScript.", factIds = [fact.id]) => ({
  paragraphs: [{ text, factIds }],
});

describe("provider-independent cover-letter grounding", () => {
  it.each([
    draft(),
    draft("I built 500 systems."),
    draft("I have experience with TypeScript.", ["unknown"]),
    draft("I require visa sponsorship."),
    { paragraphs: [] },
    { unexpected: "synthetic" },
  ])("uses the same evaluator as the original model path for %j", async (value) => {
    const provider = new ScriptedProvider(JSON.stringify(value));
    const generated = await generateCoverLetter({
      ...context,
      gateway: new ModelGateway(provider, { enabled: () => true, clock: () => now }),
      disclosure: {
        purpose: "cover_letter",
        categories: ["profile_facts", "job_posting"],
        approvedAt: now,
      },
    });
    expect(groundCoverLetterOutput(context, { value, model: provider.identity })).toEqual(
      generated,
    );
    expect(provider.calls).toHaveLength(1);
    expect(prepareCoverLetterPrompt(context)).toEqual({
      system: provider.calls[0]?.system,
      user: provider.calls[0]?.user,
    });
  });

  it.each(
    [
      [],
      [{ ...fact, verification: "proposed" as const }],
      [{ ...fact, sensitivity: "restricted" as const }],
      [{ ...fact, kind: "contact" }],
      [{ ...fact, effectiveTo: "2026-10-01" }],
      [
        {
          ...fact,
          availability: {
            state: "invalidated" as const,
            reasonCode: "source_security_hold" as const,
          },
        },
      ],
    ].map((facts) => ({ facts })),
  )(
    "refuses without disclosing or returning draft values when evidence is unusable: %j",
    ({ facts }) => {
      const input = { ...context, facts };
      expect(prepareCoverLetterPrompt(input)).toBeNull();
      expect(
        groundCoverLetterOutput(input, {
          value: draft(),
          model: new ScriptedProvider("").identity,
        }),
      ).toMatchObject({
        status: "refused",
        reason: "no_confirmed_evidence",
        paragraphs: [],
        sourceFactIds: [],
        confidence: 0,
        reviewRequired: true,
      });
    },
  );

  it("withholds citations to usable facts outside the exact forty-fact disclosure", () => {
    const facts = Array.from({ length: 41 }, (_, index) => ({
      ...fact,
      id: `synthetic-${String(index).padStart(2, "0")}`,
    }));
    const result = groundCoverLetterOutput(
      { ...context, facts },
      { value: draft(undefined, ["synthetic-40"]), model: new ScriptedProvider("").identity },
    );
    expect(result).toMatchObject({
      status: "rejected",
      paragraphs: [],
      sourceFactIds: [],
      confidence: 0,
      findings: [{ code: "unknown_fact", paragraph: 0 }],
    });
  });

  it("does not require disclosure renewal or a gateway to ground an already obtained value", () => {
    const result = groundCoverLetterOutput(
      { ...context, now: new Date(now.getTime() + 60 * 60_000) },
      { value: draft(), model: new ScriptedProvider("").identity },
    );
    expect(result).toMatchObject({
      status: "needs_review",
      reviewRequired: true,
      sourceFactIds: [fact.id],
    });
  });
});
