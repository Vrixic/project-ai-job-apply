import { createHash } from "node:crypto";
import {
  type DataDisclosureApproval,
  generateNarrativeAnswer,
  ModelGateway,
  OpenAiLunaProvider,
} from "@ai-job-apply/ai-sdk";
import type { NarrativeAnswer } from "@ai-job-apply/api-contracts";
import {
  ApplicationJobUnavailableError,
  type ApplicationNarrativeAnswers,
  NarrativeAnswerLimitError,
  NarrativeAnswersUnavailableError,
} from "@ai-job-apply/applications-service";
import type { GraphFact } from "@ai-job-apply/domain";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";

/**
 * Narrative answers (ADR-057). The model call happens here, in the Gateway composition, behind the
 * AI SDK gateway: kill switch, bounded input and output, grounding checks and fixed error codes.
 * Nothing the model returns is stored, logged or cached by this code.
 */

type Declined = Extract<NarrativeAnswer, { status: "declined" }>["reason"];

const SENSITIVE =
  /\b(?:visas?|sponsor\w*|work\s+(?:authori[sz]\w*|permits?|eligib\w*)|authori[sz]ed\s+to\s+work|citizen\w*|immigra\w*|veterans?|disabilit\w*|disabled|ethnic\w*|racial|gender|sexual\s+orientation|pronouns?|religio\w*|criminal|convict\w*|felon\w*|arrest\w*|pregnan\w*|date\s+of\s+birth|birth\s?date|social\s+security|ssn|passport|certify|attest\w*|signature|sign\s+below|i\s+(?:agree|consent|acknowledge)|background\s+check|drug\s+test)\b/iu;
const FROM_PROFILE =
  /\b(?:salary|compensation|pay\s+(?:expectation|range)|expected\s+pay|desired\s+pay|notice\s+period|start\s+date|available\s+to\s+start|relocat\w*|linkedin|phone\s+number|e-?mail\s+address|(?:home|mailing|street)\s+address|first\s+name|last\s+name|full\s+name|preferred\s+name|current\s+(?:company|employer|title))\b/iu;

/**
 * Only an ordinary, open free-text question is drafted. Anything that is a sensitive or restricted
 * answer, or that the candidate's Profile already answers, is declined before any model call. The
 * extension filters too; this is the Gateway's own check and does not trust the client.
 */
export function classifyNarrativeQuestion(question: string): "ok" | Declined {
  const text = question.normalize("NFKC");
  if (SENSITIVE.test(text)) return "sensitive_question";
  if (FROM_PROFILE.test(text)) return "answered_from_profile";
  return "ok";
}

export interface NarrativeAnswerLimiter {
  /** Zero when the request may go ahead; otherwise the seconds to wait. */
  take(ownerUserId: string): number;
}

/**
 * Best-effort burst and daily limits per candidate, held in this instance's memory. It protects the
 * provider bill against a loop or a runaway client; the Lambda's reserved concurrency and the
 * provider project's own spending cap are the hard ceilings. A durable, plan-driven quota (ADR-032)
 * is a launch prerequisite, not part of this limiter.
 */
export function memoryNarrativeLimiter(options: {
  perMinute: number;
  perDay: number;
  clock?: () => number;
  maximumCandidates?: number;
}): NarrativeAnswerLimiter {
  const clock = options.clock ?? Date.now;
  const maximum = options.maximumCandidates ?? 5_000;
  const requests = new Map<string, number[]>();
  const minute = 60_000;
  const day = 24 * 60 * minute;
  return {
    take(ownerUserId) {
      const now = clock();
      const recent = (requests.get(ownerUserId) ?? []).filter((at) => now - at < day);
      const lastMinute = recent.filter((at) => now - at < minute);
      if (lastMinute.length >= options.perMinute) {
        const oldest = lastMinute[0] ?? now;
        return Math.max(1, Math.ceil((oldest + minute - now) / 1000));
      }
      if (recent.length >= options.perDay) {
        const oldest = recent[0] ?? now;
        return Math.max(1, Math.ceil((oldest + day - now) / 1000));
      }
      recent.push(now);
      requests.delete(ownerUserId);
      requests.set(ownerUserId, recent);
      // The map is insertion ordered: drop the least recently used candidates past the bound.
      while (requests.size > maximum) {
        const first = requests.keys().next();
        if (first.done) break;
        requests.delete(first.value);
      }
      return 0;
    },
  };
}

const KEY_PATTERN = /^[\x21-\x7e]{16,512}$/u;
const KEY_MAX_AGE_MS = 10 * 60_000;
const KEY_STALE_LIMIT_MS = 60 * 60_000;

export interface ProviderKeySource {
  configured: boolean;
  current(): string | undefined;
  /** Loads or refreshes the key. A refresh that fails keeps a recent key; otherwise it throws. */
  ensure(): Promise<void>;
}

/**
 * The provider key comes from Secrets Manager through the Lambda extension, or from a local
 * environment variable when running on a developer machine. It is never logged or returned.
 */
export function createProviderKeySource(options: {
  inlineKey?: string | undefined;
  secretId?: string | undefined;
  sessionToken?: string | undefined;
  fetchImplementation?: typeof fetch;
  clock?: () => number;
}): ProviderKeySource {
  const clock = options.clock ?? Date.now;
  let key: string | undefined = KEY_PATTERN.test(options.inlineKey ?? "")
    ? options.inlineKey
    : undefined;
  let loadedAt = key ? Number.POSITIVE_INFINITY : 0;
  const fromSecret = Boolean(
    options.secretId &&
      options.sessionToken &&
      /^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(
        options.secretId,
      ),
  );
  let loading: Promise<void> | undefined;

  async function load(): Promise<void> {
    const endpoint = new URL("http://localhost:2773/secretsmanager/get");
    endpoint.searchParams.set("secretId", options.secretId ?? "");
    const response = await (options.fetchImplementation ?? fetch)(endpoint, {
      headers: { "X-Aws-Parameters-Secrets-Token": options.sessionToken ?? "" },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("provider key unavailable");
    }
    const payload: unknown = await response.json();
    const value =
      payload && typeof payload === "object" && "SecretString" in payload
        ? (payload as { SecretString: unknown }).SecretString
        : undefined;
    if (typeof value !== "string" || !KEY_PATTERN.test(value))
      throw new Error("provider key unavailable");
    key = value;
    loadedAt = clock();
  }

  return {
    configured: key !== undefined || fromSecret,
    current: () => key,
    async ensure() {
      if (!fromSecret) {
        if (!key) throw new Error("provider key unavailable");
        return;
      }
      const age = clock() - loadedAt;
      if (key && age < KEY_MAX_AGE_MS) return;
      loading ??= load().finally(() => {
        loading = undefined;
      });
      try {
        await loading;
      } catch (error) {
        // Keep serving on a key that is still recent, so a brief secrets outage is not an outage.
        if (!(key && age < KEY_STALE_LIMIT_MS)) throw error;
      }
    },
  };
}

export interface NarrativeAnswerOptions {
  catalog: Pick<JobCatalogReader, "getActiveJob">;
  profile: { listGroundingFacts(userId: string): Promise<readonly GraphFact[]> };
  gateway: ModelGateway;
  enabled: () => boolean;
  /** Loads the provider credentials just before a model call. A failure is "unavailable". */
  prepare?: () => Promise<void>;
  limiter: NarrativeAnswerLimiter;
  clock?: () => Date;
}

const ATTEMPTS = 2;

/** Drafts one answer. Refusals and rejections are answers (`declined`); a dark or failed provider is not. */
export function createNarrativeAnswers(
  options: NarrativeAnswerOptions,
): ApplicationNarrativeAnswers {
  const clock = options.clock ?? (() => new Date());
  return {
    async generate({ ownerUserId, applicationId, canonicalJobId, request }) {
      if (!options.enabled()) throw new NarrativeAnswersUnavailableError();
      const kind = classifyNarrativeQuestion(request.question);
      if (kind !== "ok") return { status: "declined", reason: kind };
      const wait = options.limiter.take(ownerUserId);
      if (wait > 0) throw new NarrativeAnswerLimitError(wait);

      const at = new Date(clock().getTime());
      const job = await options.catalog.getActiveJob(canonicalJobId, at);
      if (
        job?.status !== "active" ||
        !Number.isFinite(job.expiresAt.getTime()) ||
        job.expiresAt.getTime() <= at.getTime()
      )
        throw new ApplicationJobUnavailableError();
      // Restricted facts never reach a prompt (the SDK also filters them).
      const facts = (await options.profile.listGroundingFacts(ownerUserId)).filter(
        (fact) => fact.sensitivity !== "restricted",
      );
      try {
        await options.prepare?.();
      } catch {
        throw new NarrativeAnswersUnavailableError();
      }
      // One opaque key per application: its questions share facts and job, so the provider can reuse
      // the cached prefix. It is a one-way hash and carries no candidate content.
      const cacheKey = createHash("sha256")
        .update(`narrative-answers:${ownerUserId}:${applicationId}`)
        .digest("hex")
        .slice(0, 32);

      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        // The candidate accepted AI drafting with the Terms of Service (ADR-057), so the Gateway
        // records the disclosure for this exact purpose and these categories at call time.
        const disclosure: DataDisclosureApproval = {
          purpose: "narrative_answer",
          categories: ["profile_facts", "job_posting"],
          approvedAt: clock(),
        };
        const result = await generateNarrativeAnswer(
          {
            gateway: options.gateway,
            facts,
            now: at,
            job: { title: job.title, company: job.company.name, description: job.description },
            disclosure,
          },
          {
            fieldKey: "questions.narrative",
            text: request.question,
            ...(request.guidance ? { guidance: request.guidance } : {}),
            sensitivity: "standard",
            answerPolicy: "explicit_each_time",
            cacheKey,
          },
        );
        if (result.status === "unavailable") throw new NarrativeAnswersUnavailableError();
        if (result.status === "refused")
          return {
            status: "declined",
            reason:
              result.reason === "no_confirmed_evidence"
                ? "no_profile_evidence"
                : "sensitive_question",
          };
        if (result.status === "needs_review") {
          const text = result.paragraphs
            .map((paragraph) => paragraph.text.trim())
            .filter(Boolean)
            .join("\n\n");
          if (text && text.length <= 4_000)
            return { status: "ready", text, promptVersion: result.promptVersion };
        }
        // Rejected by the grounding checks (or empty): one more try, then say so.
      }
      return { status: "declined", reason: "not_grounded" };
    },
  };
}

const LIMITS = { perMinute: 6, perDay: 60 } as const;

/**
 * Composes the live provider from the environment. Off unless `NARRATIVE_ANSWERS_ENABLED=true`
 * (the kill switch) and a provider key is configured; the route then reports "unavailable".
 */
export function narrativeAnswersFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: Pick<NarrativeAnswerOptions, "catalog" | "profile" | "clock">,
): ApplicationNarrativeAnswers | undefined {
  if (env.NARRATIVE_ANSWERS_ENABLED !== "true") return undefined;
  const keys = createProviderKeySource({
    inlineKey: env.OPENAI_API_KEY,
    secretId: env.OPENAI_API_KEY_SECRET_ID,
    sessionToken: env.AWS_SESSION_TOKEN,
  });
  if (!keys.configured) return undefined;
  const enabled = () => env.NARRATIVE_ANSWERS_ENABLED === "true";
  const provider = new OpenAiLunaProvider({ enabled, apiKey: () => keys.current() });
  return createNarrativeAnswers({
    ...dependencies,
    gateway: new ModelGateway(provider, {
      enabled,
      // The Gateway's own request budget is 15 seconds; a short answer needs a few.
      timeoutMs: 10_000,
      maxInputChars: 40_000,
      maxOutputChars: 2_500,
    }),
    enabled,
    prepare: () => keys.ensure(),
    limiter: memoryNarrativeLimiter(LIMITS),
  });
}
