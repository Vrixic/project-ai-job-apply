import { type ChoiceOutcome, JevUnavailableError } from "@ai-job-apply/ai-sdk";
import {
  ApplicationJobUnavailableError,
  ChoiceAnswerLimitError,
  ChoiceAnswersUnavailableError,
} from "@ai-job-apply/applications-service";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import {
  classifyChoiceQuestion,
  createChoiceAnswers,
  defaultChoiceThresholds,
} from "./choice-answers.js";
import { memoryNarrativeLimiter } from "./narrative-answers.js";

const SPONSORSHIP_PROFILE_QUESTION =
  "Will you now or in the future require visa sponsorship to work in the United States?";
const NOW = new Date("2026-11-18T12:00:00.000Z");
const OWNER = "00000000-0000-7000-8000-000000000001";
const APPLICATION = "00000000-0000-7000-8000-000000000002";
const JOB = "00000000-0000-7000-8000-000000000003";

const fact = (id: string, overrides: Partial<GraphFact> = {}): GraphFact => ({
  id,
  kind: "employment",
  key: "current_title",
  value: "Brand Designer",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "direct-entry" },
  version: 1,
  ...overrides,
});

const job = {
  status: "active",
  title: "Designer",
  company: { name: "Acme" },
  description: "Design things.",
  expiresAt: new Date(NOW.getTime() + 86_400_000),
};

const inOffice = {
  ref: "office",
  question:
    "This is an in-person role. Are you willing to work in our San Francisco or NYC office?",
  options: ["Yes", "No"],
};
const sponsorship = {
  ref: "visa",
  question: "Will you now or in the future require visa sponsorship?",
  options: ["No", "Yes, H1B Transfer", "Yes, Other"],
};

function setup(
  options: {
    enabled?: boolean;
    statement?: string;
    job?: unknown;
    decide?: (input: {
      questions: readonly { ref: string }[];
      context: { text: string };
    }) => ChoiceOutcome[];
  } = {},
) {
  const decide = vi.fn(async (input: Parameters<NonNullable<typeof options.decide>>[0]) => {
    if (options.decide) return options.decide(input);
    return input.questions.map(
      (question): ChoiceOutcome => ({
        ref: question.ref,
        status: "decided",
        option: "No",
        probability: 0.95,
        confidence: 0.9,
      }),
    );
  });
  // The statement is the candidate's chosen answer to the Profile's sponsorship question.
  const savedAnswers = [
    { question: "Notice period?", answer: "2 weeks" },
    ...(options.statement === undefined
      ? []
      : [{ question: SPONSORSHIP_PROFILE_QUESTION, answer: options.statement }]),
  ];
  const answers = createChoiceAnswers({
    // biome-ignore lint/suspicious/noExplicitAny: a minimal catalog double
    catalog: { getActiveJob: vi.fn(async () => options.job ?? job) } as any,
    profile: {
      listGroundingFacts: async () => [
        fact("f1"),
        fact("f2", { kind: "identity", key: "email", value: "mason@example.test" }),
      ],
      getPreferences: async () => ({ workModes: ["remote"], locations: ["New York"] }),
      listApplicationAnswers: async () => savedAnswers,
    },
    // biome-ignore lint/suspicious/noExplicitAny: the decider is the seam under test
    decider: { decide } as any,
    enabled: () => options.enabled ?? true,
    limiter: memoryNarrativeLimiter({ perMinute: 1, perDay: 5, clock: () => NOW.getTime() }),
    thresholds: defaultChoiceThresholds,
    clock: () => NOW,
  });
  return { answers, decide };
}
const ask = (answers: ReturnType<typeof setup>["answers"], ...questions: (typeof inOffice)[]) =>
  answers.decide({
    ownerUserId: OWNER,
    applicationId: APPLICATION,
    canonicalJobId: JOB,
    request: { questions },
  });

describe("classifyChoiceQuestion", () => {
  it("treats work authorization, sponsorship, demographics and attestations as restricted", () => {
    expect(classifyChoiceQuestion(sponsorship)).toMatchObject({
      restricted: true,
      fieldKey: "authorization.sponsorship_required",
    });
    expect(
      classifyChoiceQuestion({
        ref: "g",
        question: "What is your gender?",
        options: ["Male", "Female", "Decline"],
      }),
    ).toMatchObject({ restricted: true, fieldKey: "demographic.gender" });
    // A sensitive wording the mapping does not know is restricted with no topic to ground it.
    expect(
      classifyChoiceQuestion({
        ref: "r",
        question: "Do you have any religious obligations?",
        options: ["Yes", "No"],
      }),
    ).toEqual({ restricted: true });
  });

  it("treats an ordinary choice as standard", () => {
    expect(classifyChoiceQuestion(inOffice)).toEqual({ restricted: false });
  });
});

describe("createChoiceAnswers", () => {
  it("decides standard questions in one call over work history and preferences, never contact details", async () => {
    const { answers, decide } = setup();
    const result = await ask(answers, inOffice);
    expect(result.answers).toEqual([
      {
        ref: "office",
        status: "decided",
        option: "No",
        probability: 0.95,
        confidence: 0.9,
        category: "standard",
      },
    ]);
    expect(decide).toHaveBeenCalledTimes(1);
    const context = decide.mock.calls[0]?.[0].context.text ?? "";
    expect(context).toContain("Brand Designer");
    expect(context).toContain("remote");
    expect(context).toContain("2 weeks");
    expect(context).not.toContain("mason@example.test");
  });

  it("decides a restricted question only from the candidate's own saved statement, in its own call", async () => {
    const { answers, decide } = setup({ statement: "No" });
    const result = await ask(answers, inOffice, sponsorship);
    expect(
      result.answers.map((answer) => [answer.ref, answer.status === "decided" && answer.category]),
    ).toEqual([
      ["office", "standard"],
      ["visa", "restricted"],
    ]);
    expect(decide).toHaveBeenCalledTimes(2);
    const restrictedContext = decide.mock.calls[1]?.[0].context.text ?? "";
    expect(restrictedContext).toContain('"No"');
    expect(restrictedContext).not.toContain("Brand Designer");
    // The restricted answer is used only for its own topic.
    expect(decide.mock.calls[0]?.[0].context.text ?? "").not.toContain("visa sponsorship");
    expect(restrictedContext).not.toContain("remote");
  });

  it("leaves a restricted question to the candidate, and sends nothing, when there is no saved statement", async () => {
    const { answers, decide } = setup();
    const result = await ask(answers, sponsorship);
    expect(result.answers).toEqual([
      { ref: "visa", status: "left_to_candidate", reason: "no_evidence" },
    ]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("treats an answer that is not one of the question's choices as no statement", async () => {
    const { answers, decide } = setup({ statement: "It depends" });
    const result = await ask(answers, sponsorship);
    expect(result.answers[0]).toMatchObject({ status: "left_to_candidate" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("passes through what the provider left to the candidate", async () => {
    const { answers } = setup({
      decide: (input) =>
        input.questions.map((question) => ({
          ref: question.ref,
          status: "left_to_candidate",
          reason: "low_confidence",
        })),
    });
    expect((await ask(answers, inOffice)).answers).toEqual([
      { ref: "office", status: "left_to_candidate", reason: "low_confidence" },
    ]);
  });

  it("is unavailable when dark or when the provider fails, and limits a runaway client", async () => {
    await expect(ask(setup({ enabled: false }).answers, inOffice)).rejects.toBeInstanceOf(
      ChoiceAnswersUnavailableError,
    );
    const failing = setup({
      decide: () => {
        throw new JevUnavailableError();
      },
    });
    await expect(ask(failing.answers, inOffice)).rejects.toBeInstanceOf(
      ChoiceAnswersUnavailableError,
    );
    // The failed call used the one request this window allows.
    await expect(ask(failing.answers, inOffice)).rejects.toBeInstanceOf(ChoiceAnswerLimitError);
  });

  it("refuses an application whose job is no longer open", async () => {
    const { answers, decide } = setup({ job: { ...job, status: "expired" } });
    await expect(ask(answers, inOffice)).rejects.toBeInstanceOf(ApplicationJobUnavailableError);
    expect(decide).not.toHaveBeenCalled();
  });
});
