import { createHash } from "node:crypto";
import { FactGraph, type GraphFact } from "@ai-job-apply/domain";
import {
  type DataDisclosureApproval,
  type GenerationPurpose,
  type ModelGateway,
  ModelGatewayError,
  type ModelIdentity,
} from "./gateway.js";
import {
  checkParagraphs,
  DEFAULT_LIMITS,
  type GeneratedParagraph,
  type GroundingFinding,
  parseParagraphs,
} from "./grounding.js";
import {
  type JobPromptFacts,
  PROMPT_VERSIONS,
  type PromptFact,
  renderCoverLetterPrompt,
  renderNarrativePrompt,
} from "./prompts.js";

const GENERATION_FACT_KINDS = ["employment", "education", "project", "skill", "certification"];
const MAX_FACTS = 40;

export type GenerationStatus = "needs_review" | "rejected" | "refused" | "unavailable";

export interface GenerationResult {
  status: GenerationStatus;
  purpose: GenerationPurpose;
  paragraphs: GeneratedParagraph[];
  findings: GroundingFinding[];
  /** Why generation was refused or unavailable, when it was. */
  reason?: string;
  model?: ModelIdentity;
  promptVersion: string;
  /**
   * Generated content is never auto-approved. `needs_review` means grounded and reviewable, not
   * verified: the candidate must read and approve it in the final review.
   */
  reviewRequired: true;
  /** Facts the text cites, for the packet's provenance, ordered and unique. */
  sourceFactIds: string[];
  /** Weakest cited fact confidence; the value is generated so it is never treated as certain. */
  confidence: number;
}

export interface GenerationDependencies {
  gateway: ModelGateway;
  facts: readonly GraphFact[];
  now: Date;
  job: JobPromptFacts;
  disclosure: DataDisclosureApproval | undefined;
}

/** Owner evidence required to prepare or ground a draft without provider access. */
export type CoverLetterGroundingContext = Pick<GenerationDependencies, "facts" | "now" | "job">;

/** Returns the exact disclosed prompt, or null when no confirmed career evidence is usable. */
export function prepareCoverLetterPrompt(input: CoverLetterGroundingContext): {
  system: string;
  user: string;
} | null {
  const graph = FactGraph.build(input.facts, input.now);
  const selected = selectPromptFacts(graph, input.facts);
  return selected.length > 0 ? renderCoverLetterPrompt(selected, input.job) : null;
}

function selectPromptFacts(graph: FactGraph, facts: readonly GraphFact[]): PromptFact[] {
  const usable = facts
    .map((fact) => graph.get(fact.id))
    .filter(
      (fact): fact is GraphFact => fact !== undefined && graph.usability(fact.id)?.usable === true,
    )
    .filter((fact) => GENERATION_FACT_KINDS.includes(fact.kind))
    // Restricted facts are never sent to a model provider.
    .filter((fact) => fact.sensitivity !== "restricted");
  const byId = new Map(usable.map((fact) => [fact.id, fact]));
  return [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, MAX_FACTS)
    .map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      key: fact.key,
      value: Array.isArray(fact.value) ? fact.value.join(", ") : String(fact.value),
    }));
}

/** Internal bindings share generation's exact evidence selection and contain no raw values. */
export function coverLetterContext(input: {
  facts: readonly GraphFact[];
  now: Date;
  job: JobPromptFacts;
}): { confirmedFactsHash: string; jobContextHash: string } {
  const graph = FactGraph.build(input.facts, input.now);
  const selected = selectPromptFacts(graph, input.facts);
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    confirmedFactsHash: digest({
      schemaVersion: "cover-letter-evidence.v1",
      promptVersion: PROMPT_VERSIONS.coverLetter,
      facts: selected.map((fact) => {
        const usability = graph.usability(fact.id);
        return { ...fact, confidence: usability?.usable ? usability.confidence : 0 };
      }),
    }),
    // Hash the entire posting, including text beyond the prompt's truncation limit.
    jobContextHash: digest({
      schemaVersion: "cover-letter-job.v1",
      title: input.job.title,
      company: input.job.company,
      description: input.job.description,
    }),
  };
}

async function run(
  purpose: GenerationPurpose,
  dependencies: GenerationDependencies,
  render: (facts: readonly PromptFact[]) => { system: string; user: string },
  promptId: string,
  promptVersion: string,
): Promise<GenerationResult> {
  const graph = FactGraph.build(dependencies.facts, dependencies.now);
  const promptFacts = selectPromptFacts(graph, dependencies.facts);
  const base = {
    purpose,
    paragraphs: [] as GeneratedParagraph[],
    findings: [] as GroundingFinding[],
    promptVersion,
    reviewRequired: true as const,
    sourceFactIds: [] as string[],
    confidence: 0,
  };
  if (promptFacts.length === 0) {
    return { ...base, status: "refused", reason: "no_confirmed_evidence" };
  }
  const prompt = render(promptFacts);
  let output: Awaited<ReturnType<ModelGateway["generate"]>>;
  try {
    output = await dependencies.gateway.generate(
      {
        promptId,
        promptVersion,
        purpose,
        categories: ["profile_facts", "job_posting"],
        system: prompt.system,
        user: prompt.user,
      },
      dependencies.disclosure,
    );
  } catch (error) {
    if (error instanceof ModelGatewayError) {
      return { ...base, status: "unavailable", reason: error.code.toLowerCase() };
    }
    throw error;
  }
  return groundOutput(base, dependencies, graph, promptFacts, output);
}

function groundOutput(
  base: Pick<GenerationResult, "purpose" | "promptVersion" | "reviewRequired">,
  context: CoverLetterGroundingContext,
  graph: FactGraph,
  promptFacts: readonly PromptFact[],
  output: { value: unknown; model: ModelIdentity },
): GenerationResult {
  if (promptFacts.length === 0) {
    return {
      ...base,
      status: "refused",
      reason: "no_confirmed_evidence",
      paragraphs: [],
      findings: [],
      sourceFactIds: [],
      confidence: 0,
    };
  }
  const parsed = parseParagraphs(output.value, DEFAULT_LIMITS);
  const selectedIds = new Set(promptFacts.map((fact) => fact.id));
  const excludedCitations: GroundingFinding[] = parsed.paragraphs.flatMap((paragraph, index) =>
    paragraph.factIds.some((id) => !selectedIds.has(id) && graph.usability(id)?.usable === true)
      ? [{ code: "unknown_fact", paragraph: index }]
      : [],
  );
  const findings = [
    ...parsed.findings,
    ...checkParagraphs(parsed.paragraphs, graph, {
      jobTerms: [context.job.company, context.job.title],
    }),
    // A known usable fact still cannot be cited unless this exact request disclosed it.
    // Keep the existing unknown/unusable diagnostics for truly unknown or unusable evidence.
    ...excludedCitations,
  ];
  const cited = [...new Set(parsed.paragraphs.flatMap((paragraph) => paragraph.factIds))].sort();
  const confidence = cited.reduce((minimum, id) => {
    const usability = graph.usability(id);
    return usability?.usable ? Math.min(minimum, usability.confidence) : 0;
  }, 1);
  return {
    ...base,
    status: findings.length === 0 && parsed.paragraphs.length > 0 ? "needs_review" : "rejected",
    // Rejected drafts are withheld entirely so unsupported text never reaches a packet or UI.
    paragraphs: findings.length === 0 ? parsed.paragraphs : [],
    findings,
    model: output.model,
    sourceFactIds: findings.length === 0 ? cited : [],
    confidence: findings.length === 0 ? confidence : 0,
  };
}

/**
 * Grounds an already obtained result without a gateway, disclosure renewal, or provider call.
 * The caller must independently verify saved request identity, original dispatch authorization,
 * model identity, and encrypted result integrity before passing output to this pure evaluator.
 */
export function groundCoverLetterOutput(
  context: CoverLetterGroundingContext,
  output: { value: unknown; model: ModelIdentity },
): GenerationResult {
  const graph = FactGraph.build(context.facts, context.now);
  return groundOutput(
    {
      purpose: "cover_letter",
      promptVersion: PROMPT_VERSIONS.coverLetter,
      reviewRequired: true,
    },
    context,
    graph,
    selectPromptFacts(graph, context.facts),
    output,
  );
}

export function generateCoverLetter(
  dependencies: GenerationDependencies,
): Promise<GenerationResult> {
  return run(
    "cover_letter",
    dependencies,
    (facts) => renderCoverLetterPrompt(facts, dependencies.job),
    "cover_letter",
    PROMPT_VERSIONS.coverLetter,
  );
}

export interface NarrativeQuestion {
  fieldKey: string;
  text: string;
  sensitivity: "standard" | "confidential" | "restricted";
  answerPolicy: "deterministic" | "confirmed_fact" | "explicit_each_time" | "never_infer";
}

const DIRECT_ACTION_PREFIXES = ["attestation.", "signature.", "challenge.", "captcha.", "mfa."];

/**
 * Narrative answers are generated only for ordinary free-text questions. Restricted, never-infer,
 * attestation, signature, and challenge fields are refused before any model call, so a sensitive
 * answer can never be silently drafted.
 */
export function generateNarrativeAnswer(
  dependencies: GenerationDependencies,
  question: NarrativeQuestion,
): Promise<GenerationResult> {
  if (
    question.sensitivity === "restricted" ||
    question.answerPolicy === "never_infer" ||
    DIRECT_ACTION_PREFIXES.some((prefix) => question.fieldKey.startsWith(prefix))
  ) {
    return Promise.resolve({
      status: "refused",
      purpose: "narrative_answer",
      paragraphs: [],
      findings: [],
      reason: "sensitive_or_direct_action_field",
      promptVersion: PROMPT_VERSIONS.narrativeAnswer,
      reviewRequired: true,
      sourceFactIds: [],
      confidence: 0,
    });
  }
  return run(
    "narrative_answer",
    dependencies,
    (facts) => renderNarrativePrompt(facts, dependencies.job, question.text),
    "narrative_answer",
    PROMPT_VERSIONS.narrativeAnswer,
  );
}

/**
 * Shapes a reviewable draft as a packet proposal. Generated text always carries provenance to
 * confirmed facts; a rejected or refused draft yields no proposal at all.
 */
export function toGeneratedProposal(
  fieldKey: string,
  result: GenerationResult,
): {
  fieldKey: string;
  value: string;
  origin: "generated";
  sourceFactIds: string[];
  sourceConfirmed: true;
  confidence: number;
} | null {
  // ADR-038: cover letters are temporary material, even if relabeled as an ordinary field.
  if (
    result.status !== "needs_review" ||
    result.purpose !== "narrative_answer" ||
    fieldKey === "documents.cover_letter" ||
    fieldKey === "documents.resume"
  )
    return null;
  return {
    fieldKey,
    value: result.paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
    origin: "generated",
    sourceFactIds: result.sourceFactIds,
    sourceConfirmed: true,
    confidence: result.confidence,
  };
}
