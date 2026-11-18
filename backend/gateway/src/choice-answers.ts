import {
  buildChoiceContext,
  type ChoiceDisclosure,
  type ChoiceOutcome,
  type ChoiceQuestionInput,
  type ChoiceThresholds,
  JevChoiceDecider,
  JevUnavailableError,
} from "@ai-job-apply/ai-sdk";
import { selectPromptFacts } from "@ai-job-apply/ai-sdk/context";
import type { ChoiceAnswer, ChoiceAnswers } from "@ai-job-apply/api-contracts";
import {
  type ApplicationChoiceAnswers,
  ApplicationJobUnavailableError,
  ChoiceAnswerLimitError,
  ChoiceAnswersUnavailableError,
  defaultFieldDefinitions,
} from "@ai-job-apply/applications-service";
import { mapFormFields } from "@ai-job-apply/ats-sdk/mapping";
import { FactGraph, type GraphFact } from "@ai-job-apply/domain";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import {
  classifyNarrativeQuestion,
  createProviderKeySource,
  memoryNarrativeLimiter,
  type NarrativeAnswerLimiter,
} from "./narrative-answers.js";

/**
 * Choice answers decided by Jev (ADR-061). The provider call happens here, in the Gateway
 * composition: kill switch, bounded input and output, fixed host, strict response validation. The
 * Gateway classifies each question itself and does not trust the client. Nothing the provider
 * returns, and none of the context sent to it, is stored, logged or cached by this code.
 *
 * Standard questions share one request over the candidate's confirmed Profile facts, preferences,
 * saved answers and the job. A restricted question (authorization, sponsorship, demographics,
 * disability, veteran status, attestations) gets its own request holding only the candidate's own
 * saved statement on that one topic: with none, it is left to the candidate and nothing is sent.
 */

type Question = { ref: string; question: string; options: string[] };

export interface RestrictedStatementReader {
  /** The candidate's active saved statement for one restricted field; plaintext never leaves the Gateway. */
  readActiveValue(input: {
    userId: string;
    fieldKey: string;
  }): Promise<{ value: string } | undefined>;
}

export interface ChoiceAnswerDependencies {
  catalog: Pick<JobCatalogReader, "getActiveJob">;
  profile: {
    listGroundingFacts(userId: string): Promise<readonly GraphFact[]>;
    getPreferences?(
      userId: string,
    ): Promise<{ workModes: readonly string[]; locations: readonly string[] } | null>;
    listApplicationAnswers?(
      userId: string,
    ): Promise<ReadonlyArray<{ question: string; answer: string }>>;
  };
  restrictedStatements?: RestrictedStatementReader | undefined;
  clock?: () => Date;
}

export interface ChoiceAnswerOptions extends ChoiceAnswerDependencies {
  decider: Pick<JevChoiceDecider, "decide">;
  enabled: () => boolean;
  /** Loads the provider credentials just before a call. A failure is "unavailable". */
  prepare?: () => Promise<void>;
  limiter: NarrativeAnswerLimiter;
  thresholds: { standard: ChoiceThresholds; restricted: ChoiceThresholds };
}

export const defaultChoiceThresholds = {
  standard: { probability: 0.8, confidence: 0.7, evidence: 0.7 },
  restricted: { probability: 0.9, confidence: 0.8, evidence: 0.85 },
} as const;

const definitions = defaultFieldDefinitions();

/**
 * Which restricted topic, if any, a question is about. The planner's own mapping decides the field;
 * a sensitive wording the mapping does not know is restricted with no topic, so it can only be left
 * to the candidate.
 */
export function classifyChoiceQuestion(question: Question): {
  restricted: boolean;
  fieldKey?: string;
} {
  const [mapping] = mapFormFields({
    fields: [
      {
        ref: "q",
        label: question.question,
        name: "",
        type: "radio",
        required: false,
        options: question.options,
      },
    ],
    challengePresent: false,
  });
  const fieldKey = mapping?.fieldKey ?? undefined;
  if (fieldKey && definitions.get(fieldKey)?.sensitivity === "restricted")
    return { restricted: true, fieldKey };
  if (classifyNarrativeQuestion(question.question) === "sensitive_question")
    return { restricted: true };
  return { restricted: false };
}

const asAnswer = (outcome: ChoiceOutcome, category: "standard" | "restricted"): ChoiceAnswer =>
  outcome.status === "decided"
    ? {
        ref: outcome.ref,
        status: "decided",
        option: outcome.option,
        probability: outcome.probability,
        confidence: outcome.confidence,
        category,
      }
    : { ref: outcome.ref, status: "left_to_candidate", reason: outcome.reason };

/** Decides choices. Refusals are answers (`left_to_candidate`); a dark or failed provider is not. */
export function createChoiceAnswers(options: ChoiceAnswerOptions): ApplicationChoiceAnswers {
  const clock = options.clock ?? (() => new Date());
  return {
    async decide({ ownerUserId, canonicalJobId, request }) {
      if (!options.enabled()) throw new ChoiceAnswersUnavailableError();
      const wait = options.limiter.take(ownerUserId);
      if (wait > 0) throw new ChoiceAnswerLimitError(wait);

      const at = new Date(clock().getTime());
      const job = await options.catalog.getActiveJob(canonicalJobId, at);
      if (
        job?.status !== "active" ||
        !Number.isFinite(job.expiresAt.getTime()) ||
        job.expiresAt.getTime() <= at.getTime()
      )
        throw new ApplicationJobUnavailableError();
      const jobContext = {
        title: job.title,
        company: job.company.name,
        description: job.description,
      };

      const results = new Map<string, ChoiceAnswer>();
      const standard: Question[] = [];
      const restricted: Array<{ question: Question; fieldKey: string }> = [];
      for (const question of request.questions) {
        const kind = classifyChoiceQuestion(question);
        if (!kind.restricted) standard.push(question);
        else if (kind.fieldKey) restricted.push({ question, fieldKey: kind.fieldKey });
        // A sensitive question the mapping cannot place has no statement to ground it.
        else results.set(question.ref, leftToCandidate(question.ref, "no_evidence"));
      }

      try {
        await options.prepare?.();
      } catch {
        throw new ChoiceAnswersUnavailableError();
      }
      const approvedAt = clock();
      const disclosure = (context: { categories: ChoiceDisclosure["categories"] }) =>
        ({ purpose: "choice_answer", categories: context.categories, approvedAt }) as const;

      try {
        if (standard.length) {
          const facts = await options.profile.listGroundingFacts(ownerUserId);
          const graph = FactGraph.build(facts, at);
          const preferences = await options.profile.getPreferences?.(ownerUserId);
          const savedAnswers = await options.profile.listApplicationAnswers?.(ownerUserId);
          const context = buildChoiceContext({
            facts: selectPromptFacts(graph, facts),
            workModes: preferences?.workModes,
            locations: preferences?.locations,
            savedAnswers,
            job: jobContext,
          });
          const decided = await options.decider.decide({
            context,
            disclosure: disclosure(context),
            questions: standard as ChoiceQuestionInput[],
            thresholds: options.thresholds.standard,
          });
          for (const outcome of decided) results.set(outcome.ref, asAnswer(outcome, "standard"));
        }
        await Promise.all(
          restricted.map(async ({ question, fieldKey }) => {
            const statement = await readStatement(
              options.restrictedStatements,
              ownerUserId,
              fieldKey,
            );
            if (!statement) {
              results.set(question.ref, leftToCandidate(question.ref, "no_evidence"));
              return;
            }
            const context = buildChoiceContext({
              facts: [],
              job: jobContext,
              restrictedStatement: {
                topic: definitions.get(fieldKey)?.label ?? fieldKey,
                value: statement,
              },
            });
            const [outcome] = await options.decider.decide({
              context,
              disclosure: disclosure(context),
              questions: [question],
              thresholds: options.thresholds.restricted,
            });
            if (!outcome) throw new JevUnavailableError();
            results.set(question.ref, asAnswer(outcome, "restricted"));
          }),
        );
      } catch (error) {
        if (error instanceof JevUnavailableError) throw new ChoiceAnswersUnavailableError();
        throw error;
      }
      const answers = request.questions.map((question) => results.get(question.ref));
      if (answers.some((answer) => answer === undefined)) throw new ChoiceAnswersUnavailableError();
      return { answers: answers as ChoiceAnswer[] } satisfies ChoiceAnswers;
    },
  };
}

const leftToCandidate = (ref: string, reason: "no_evidence"): ChoiceAnswer => ({
  ref,
  status: "left_to_candidate",
  reason,
});

async function readStatement(
  reader: RestrictedStatementReader | undefined,
  userId: string,
  fieldKey: string,
): Promise<string | undefined> {
  if (!reader) return undefined;
  try {
    const saved = await reader.readActiveValue({ userId, fieldKey });
    return saved?.value.trim() ? saved.value : undefined;
  } catch {
    // An unreadable vault only means there is no statement to ground an answer in.
    return undefined;
  }
}

const LIMITS = { perMinute: 6, perDay: 60 } as const;
const unit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function thresholdsFromEnvironment(raw: string | undefined) {
  if (!raw) return defaultChoiceThresholds;
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const pick = (name: "standard" | "restricted"): ChoiceThresholds => {
      const entry = parsed[name];
      if (!entry || !unit(entry.probability) || !unit(entry.confidence) || !unit(entry.evidence))
        throw new Error("thresholds invalid");
      return {
        probability: entry.probability,
        confidence: entry.confidence,
        evidence: entry.evidence,
      };
    };
    return { standard: pick("standard"), restricted: pick("restricted") };
  } catch {
    // A bad value never lowers the bar: the conservative defaults apply.
    return defaultChoiceThresholds;
  }
}

/**
 * Composes the live provider from the environment. Off unless `CHOICE_ANSWERS_ENABLED=true` (the kill
 * switch) and a provider key is configured; the route then reports "unavailable".
 */
export function choiceAnswersFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: ChoiceAnswerDependencies,
): ApplicationChoiceAnswers | undefined {
  if (env.CHOICE_ANSWERS_ENABLED !== "true") return undefined;
  const keys = createProviderKeySource({
    inlineKey: env.TYPESAFE_API_KEY,
    secretId: env.TYPESAFE_API_KEY_SECRET_ID,
    sessionToken: env.AWS_SESSION_TOKEN,
  });
  if (!keys.configured) return undefined;
  const enabled = () => env.CHOICE_ANSWERS_ENABLED === "true";
  return createChoiceAnswers({
    ...dependencies,
    decider: new JevChoiceDecider({ enabled, apiKey: () => keys.current(), timeoutMs: 8_000 }),
    enabled,
    prepare: () => keys.ensure(),
    limiter: memoryNarrativeLimiter(LIMITS),
    thresholds: thresholdsFromEnvironment(env.CHOICE_ANSWER_THRESHOLDS),
  });
}
