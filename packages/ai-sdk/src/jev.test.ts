import { describe, expect, it, vi } from "vitest";
import {
  buildChoiceContext,
  type ChoiceDisclosure,
  decideChoice,
  JevChoiceDecider,
  JevUnavailableError,
  jevEndpoint,
  jevModel,
} from "./jev.js";

const KEY = "tsk_0123456789abcdef0123";
const thresholds = { probability: 0.8, confidence: 0.7, evidence: 0.7 };
const question = {
  ref: "q1",
  question: "Are you willing to work in our office?",
  options: ["Yes", "No"],
};
const job = { title: "Designer", company: "Acme", description: "Design things." };
const disclosure = (categories: ChoiceDisclosure["categories"]): ChoiceDisclosure => ({
  purpose: "choice_answer",
  categories,
  approvedAt: new Date("2026-11-18T00:00:00Z"),
});

const reply = (choice: string, yes: number, confidence: number, evidence: number) => ({
  model: jevModel,
  answers: {
    c0: {
      type: "choice",
      choice,
      confidence,
      probabilities: { Yes: yes, No: Number((1 - yes).toFixed(4)) },
    },
    e0: { type: "noul", noul: evidence },
  },
  usage: { input_tokens: 100, output_tokens: 5 },
});

function decider(body: unknown, init: { status?: number } = {}) {
  const fetchImplementation = vi.fn(
    async () => new Response(JSON.stringify(body), { status: init.status ?? 200 }),
  ) as unknown as typeof fetch;
  return {
    fetchImplementation,
    client: new JevChoiceDecider({
      enabled: () => true,
      apiKey: () => KEY,
      fetchImplementation,
    }),
  };
}
const run = (client: JevChoiceDecider, categories = ["job_posting"] as const) => {
  const context = buildChoiceContext({ facts: [], job });
  return client.decide({
    context,
    disclosure: disclosure([...categories, ...context.categories]),
    questions: [question],
    thresholds,
  });
};

describe("buildChoiceContext", () => {
  it("sends work history and preferences but never contact details, and names its categories", () => {
    const context = buildChoiceContext({
      facts: [{ id: "f1", kind: "employment", key: "current_title", value: "Brand Designer" }],
      workModes: ["remote"],
      locations: ["New York"],
      savedAnswers: [{ question: "Notice period?", answer: "2 weeks" }],
      job,
    });
    expect(context.categories).toEqual(["job_posting", "profile_facts", "saved_answers"]);
    expect(context.text).toContain("Brand Designer");
    expect(context.text).toContain("remote");
    expect(context.text).not.toMatch(/email|phone|address|@/iu);
  });

  it("gives a restricted question its own statement and the job title only", () => {
    const context = buildChoiceContext({
      facts: [{ id: "f1", kind: "employment", key: "current_title", value: "Brand Designer" }],
      workModes: ["remote"],
      job,
      restrictedStatement: { topic: "Sponsorship required", value: "No" },
    });
    expect(context.categories).toEqual(["job_posting", "restricted_statement"]);
    expect(context.text).toContain("Sponsorship required");
    expect(context.text).not.toContain("Brand Designer");
    expect(context.text).not.toContain("remote");
    expect(context.text).not.toContain("Design things.");
  });

  it("stays within its bound by shortening the job, never the candidate's profile", () => {
    const facts = Array.from({ length: 40 }, (_, index) => ({
      id: `f${index}`,
      kind: "employment",
      key: "role",
      value: "x".repeat(480),
    }));
    const context = buildChoiceContext({
      facts,
      job: { ...job, description: "d".repeat(20_000) },
    });
    expect(context.text.length).toBeLessThanOrEqual(24_000);
    expect(context.text).toContain("candidate_profile");
  });
});

describe("decideChoice thresholds", () => {
  const answer = (probability: number, confidence: number, evidence: number) =>
    decideChoice(
      question,
      {
        choice: "Yes",
        probabilities: { Yes: probability, No: 1 - probability },
        confidence,
        evidence,
      },
      thresholds,
    );

  it("acts only when probability, confidence and evidence all clear their thresholds", () => {
    expect(answer(0.95, 0.9, 0.9)).toMatchObject({ status: "decided", option: "Yes" });
    expect(answer(0.7, 0.9, 0.9)).toMatchObject({
      status: "left_to_candidate",
      reason: "low_confidence",
    });
    expect(answer(0.95, 0.5, 0.9)).toMatchObject({
      status: "left_to_candidate",
      reason: "low_confidence",
    });
    expect(answer(0.95, 0.9, 0.5)).toMatchObject({
      status: "left_to_candidate",
      reason: "no_evidence",
    });
  });

  it("says no option fits when no option is even likely", () => {
    const three = { ref: "q2", question: "Which applies to you?", options: ["A", "B", "C"] };
    expect(
      decideChoice(
        three,
        { choice: "A", probabilities: { A: 0.4, B: 0.3, C: 0.3 }, confidence: 0.9, evidence: 0.9 },
        thresholds,
      ),
    ).toMatchObject({ status: "left_to_candidate", reason: "no_option_fits" });
  });
});

describe("JevChoiceDecider", () => {
  it("calls only the fixed host with a pinned model and the key in the header, never the body", async () => {
    const { client, fetchImplementation } = decider(reply("Yes", 0.97, 0.9, 0.95));
    const [outcome] = await run(client);
    expect(outcome).toMatchObject({ ref: "q1", status: "decided", option: "Yes" });
    const [url, init] = (fetchImplementation as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(jevEndpoint);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);
    expect(JSON.parse(String(init.body)).model).toBe("jev-1.14.0");
  });

  it("leaves a question to the candidate when the information does not answer it", async () => {
    const { client } = decider(reply("Yes", 0.97, 0.9, 0.2));
    expect(await run(client)).toEqual([
      { ref: "q1", status: "left_to_candidate", reason: "no_evidence" },
    ]);
  });

  it("is unavailable when dark, keyless, refused by the provider or answered with anything unexpected", async () => {
    const dark = new JevChoiceDecider({ enabled: () => false, apiKey: () => KEY });
    await expect(run(dark)).rejects.toBeInstanceOf(JevUnavailableError);
    const keyless = new JevChoiceDecider({ enabled: () => true, apiKey: () => undefined });
    await expect(run(keyless)).rejects.toBeInstanceOf(JevUnavailableError);
    await expect(run(decider({}, { status: 429 }).client)).rejects.toBeInstanceOf(
      JevUnavailableError,
    );
    // An option that is not on the page, a probability outside 0..1, and a missing companion answer.
    for (const bad of [
      reply("Maybe", 0.9, 0.9, 0.9),
      reply("Yes", 1.4, 0.9, 0.9),
      { answers: { c0: reply("Yes", 0.9, 0.9, 0.9).answers.c0 } },
    ])
      await expect(run(decider(bad).client)).rejects.toBeInstanceOf(JevUnavailableError);
  });

  it("refuses a context holding data its disclosure does not cover", async () => {
    const { client, fetchImplementation } = decider(reply("Yes", 0.97, 0.9, 0.95));
    const context = buildChoiceContext({
      facts: [{ id: "f1", kind: "skill", key: "name", value: "Illustration" }],
      job,
    });
    await expect(
      client.decide({
        context,
        disclosure: disclosure(["job_posting"]),
        questions: [question],
        thresholds,
      }),
    ).rejects.toBeInstanceOf(JevUnavailableError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
