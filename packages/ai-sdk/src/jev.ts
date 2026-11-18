import type { PromptFact } from "./prompts.js";

/**
 * Choice answers decided by Jev, TypeSafe's System One model (ADR-061). Jev returns typed decisions,
 * not prose: for each question one option with a probability for every option and a confidence, plus a
 * yes/no probability that the candidate's information actually answers the question. Code, not the
 * model, decides whether to act: an answer is used only above the thresholds, and anything else is
 * left to the candidate. The same hard rules as every other provider path apply: an explicit kill
 * switch (default off), a fixed host, bounded input and output, a hard timeout, strict response
 * validation, and no persistence or logging of the context or the answers.
 */

export const jevEndpoint = "https://api.typesafe.ai/v1/systemone";
/** Pinned: a model change is a reviewed change, never `jev-latest`. */
export const jevModel = "jev-1.14.0";
export const choiceAnswerPurpose = "choice_answer";

export const choiceDisclosureCategories = [
  "profile_facts",
  "job_posting",
  "saved_answers",
  "restricted_statement",
] as const;
export type ChoiceDisclosureCategory = (typeof choiceDisclosureCategories)[number];

/**
 * The candidate accepted AI use with the Terms of Service (ADR-061); the Gateway states the exact
 * purpose and categories at call time and the client refuses a context that holds more.
 */
export interface ChoiceDisclosure {
  purpose: typeof choiceAnswerPurpose;
  categories: readonly ChoiceDisclosureCategory[];
  approvedAt: Date;
}

export interface ChoiceQuestionInput {
  ref: string;
  question: string;
  options: readonly string[];
}

export interface ChoiceThresholds {
  /** Least probability the chosen option must have. */
  probability: number;
  /** Least confidence Jev must report for the chosen option. */
  confidence: number;
  /** Least probability that the candidate's information answers the question at all. */
  evidence: number;
}

export type ChoiceOutcome =
  | {
      ref: string;
      status: "decided";
      option: string;
      probability: number;
      confidence: number;
    }
  | {
      ref: string;
      status: "left_to_candidate";
      reason: "no_evidence" | "no_option_fits" | "low_confidence";
    };

export class JevUnavailableError extends Error {
  constructor() {
    super("Jev is unavailable");
    this.name = "JevUnavailableError";
  }
}

const unavailable = () => new JevUnavailableError();

export interface ChoiceContextInput {
  facts: readonly PromptFact[];
  workModes?: readonly string[] | undefined;
  locations?: readonly string[] | undefined;
  savedAnswers?: ReadonlyArray<{ question: string; answer: string }> | undefined;
  job: { title: string; company: string; description: string };
  /** The candidate's own saved statement on the one restricted topic the question is about. */
  restrictedStatement?: { topic: string; value: string } | undefined;
}

export interface ChoiceContext {
  text: string;
  categories: readonly ChoiceDisclosureCategory[];
}

export const maxContextChars = 24_000;
const DESCRIPTION_LIMIT = 5_000;
const MAX_SAVED_ANSWERS = 30;
const clip = (value: string, limit: number) => value.slice(0, limit);

/**
 * The state Jev reads. Only what a choice can depend on: confirmed work history, education, skills,
 * work-mode preferences and locations, saved answers and the job. Name, email, phone and address are
 * never included. A restricted question gets its own statement and the job title only, so no other
 * candidate data is sent for it.
 */
export function buildChoiceContext(input: ChoiceContextInput): ChoiceContext {
  const categories = new Set<ChoiceDisclosureCategory>(["job_posting"]);
  const job = {
    title: clip(input.job.title, 200),
    company: clip(input.job.company, 200),
  };
  if (input.restrictedStatement) {
    categories.add("restricted_statement");
    const text = JSON.stringify({
      job,
      candidate_statement: {
        topic: clip(input.restrictedStatement.topic, 100),
        value: clip(input.restrictedStatement.value, 500),
      },
    });
    return { text, categories: [...categories].sort() };
  }
  const context: Record<string, unknown> = {
    job: { ...job, description: clip(input.job.description, DESCRIPTION_LIMIT) },
  };
  if (input.facts.length) {
    categories.add("profile_facts");
    context.candidate_profile = input.facts.map((fact) => ({
      kind: fact.kind,
      key: fact.key,
      value: clip(fact.value, 500),
    }));
  }
  const preferences: Record<string, unknown> = {};
  if (input.workModes?.length) preferences.work_modes = [...input.workModes];
  if (input.locations?.length) preferences.locations = input.locations.map((l) => clip(l, 120));
  if (Object.keys(preferences).length) {
    categories.add("profile_facts");
    context.candidate_preferences = preferences;
  }
  const answers = (input.savedAnswers ?? []).slice(0, MAX_SAVED_ANSWERS);
  if (answers.length) {
    categories.add("saved_answers");
    context.candidate_saved_answers = answers.map((entry) => ({
      question: clip(entry.question, 300),
      answer: clip(entry.answer, 500),
    }));
  }
  let text = JSON.stringify(context);
  // Over the bound: shorten the job description, then drop saved answers, never the profile.
  if (text.length > maxContextChars) {
    (context.job as { description: string }).description = clip(input.job.description, 1_000);
    text = JSON.stringify(context);
  }
  if (text.length > maxContextChars && context.candidate_saved_answers) {
    delete context.candidate_saved_answers;
    categories.delete("saved_answers");
    text = JSON.stringify(context);
  }
  if (text.length > maxContextChars) throw unavailable();
  return { text, categories: [...categories].sort() };
}

export interface JevOptions {
  /** Must return true for any call to happen. Default-off keeps the provider dark. */
  enabled: () => boolean;
  apiKey: () => string | undefined;
  timeoutMs?: number;
  model?: string;
  fetchImplementation?: typeof fetch;
}

const RESPONSE_LIMIT_BYTES = 200_000;
const KEY_PATTERN = /^[\x21-\x7e]{16,512}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const unit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Pure decision rule over one validated answer. Exported so thresholds are tested, not trusted. */
export function decideChoice(
  question: ChoiceQuestionInput,
  answer: {
    choice: string;
    probabilities: Readonly<Record<string, number>>;
    confidence: number;
    evidence: number;
  },
  thresholds: ChoiceThresholds,
): ChoiceOutcome {
  const probability = answer.probabilities[answer.choice] ?? 0;
  if (answer.evidence < thresholds.evidence)
    return { ref: question.ref, status: "left_to_candidate", reason: "no_evidence" };
  if (probability < thresholds.probability || answer.confidence < thresholds.confidence) {
    const best = Math.max(...Object.values(answer.probabilities));
    return {
      ref: question.ref,
      status: "left_to_candidate",
      reason: best < 0.5 ? "no_option_fits" : "low_confidence",
    };
  }
  return {
    ref: question.ref,
    status: "decided",
    option: answer.choice,
    probability,
    confidence: answer.confidence,
  };
}

export class JevChoiceDecider {
  constructor(private readonly options: JevOptions) {}

  async decide(input: {
    context: ChoiceContext;
    disclosure: ChoiceDisclosure;
    questions: readonly ChoiceQuestionInput[];
    thresholds: ChoiceThresholds;
  }): Promise<ChoiceOutcome[]> {
    const { context, disclosure, questions, thresholds } = input;
    if (!this.options.enabled()) throw unavailable();
    // The disclosure must name this purpose and cover every category the context holds.
    if (
      disclosure.purpose !== choiceAnswerPurpose ||
      !context.categories.every((category) => disclosure.categories.includes(category))
    )
      throw unavailable();
    if (questions.length < 1 || questions.length > 10) throw unavailable();
    for (const question of questions) {
      if (
        question.options.length < 2 ||
        question.options.length > 12 ||
        new Set(question.options).size !== question.options.length
      )
        throw unavailable();
    }
    const key = this.options.apiKey();
    if (!key || !KEY_PATTERN.test(key)) throw unavailable();

    const body: {
      model: string;
      state: string;
      questions: Record<string, unknown>;
    } = { model: this.options.model ?? jevModel, state: context.text, questions: {} };
    questions.forEach((question, index) => {
      body.questions[`c${index}`] = {
        type: "choice",
        instructions: `The employer asks the candidate: ${JSON.stringify(question.question)} Which option does the candidate's information say they would choose?`,
        criteria: Object.fromEntries(question.options.map((option) => [option, option])),
      };
      body.questions[`e${index}`] = {
        type: "noul",
        instructions: `Does the information about the candidate state, or clearly imply, their answer to this question from the employer: ${JSON.stringify(question.question)}`,
      };
    });
    const encoded = JSON.stringify(body);
    if (encoded.length > 80_000) throw unavailable();

    let response: Response;
    try {
      response = await (this.options.fetchImplementation ?? fetch)(jevEndpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: encoded,
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      });
    } catch {
      throw unavailable();
    }
    if (!this.options.enabled()) throw unavailable();
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    let payload: unknown;
    try {
      const text = await response.text();
      if (text.length > RESPONSE_LIMIT_BYTES) throw unavailable();
      payload = JSON.parse(text);
    } catch {
      throw unavailable();
    }
    const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : undefined;
    if (!answers) throw unavailable();
    return questions.map((question, index) => {
      const choice = answers[`c${index}`];
      const evidence = answers[`e${index}`];
      if (
        !isRecord(choice) ||
        choice.type !== "choice" ||
        typeof choice.choice !== "string" ||
        !question.options.includes(choice.choice) ||
        !unit(choice.confidence) ||
        !isRecord(choice.probabilities) ||
        !isRecord(evidence) ||
        evidence.type !== "noul" ||
        !unit(evidence.noul)
      )
        throw unavailable();
      const probabilities: Record<string, number> = {};
      for (const option of question.options) {
        const value = (choice.probabilities as Record<string, unknown>)[option];
        if (!unit(value)) throw unavailable();
        probabilities[option] = value;
      }
      return decideChoice(
        question,
        {
          choice: choice.choice,
          probabilities,
          confidence: choice.confidence,
          evidence: evidence.noul,
        },
        thresholds,
      );
    });
  }
}
