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

function selectPromptFacts(graph: FactGraph, facts: readonly GraphFact[]): PromptFact[] {
  const usable = facts
    .filter((fact) => GENERATION_FACT_KINDS.includes(fact.kind))
    .map((fact) => graph.get(fact.id))
    .filter(
      (fact): fact is GraphFact => fact !== undefined && graph.usability(fact.id)?.usable === true,
    )
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
  const parsed = parseParagraphs(output.value, DEFAULT_LIMITS);
  const findings = [
    ...parsed.findings,
    ...checkParagraphs(parsed.paragraphs, graph, {
      jobTerms: [dependencies.job.company, dependencies.job.title],
    }),
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
  if (result.status !== "needs_review") return null;
  return {
    fieldKey,
    value: result.paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
    origin: "generated",
    sourceFactIds: result.sourceFactIds,
    sourceConfirmed: true,
    confidence: result.confidence,
  };
}
