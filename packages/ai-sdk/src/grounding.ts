import type { FactGraph, GraphFact } from "@ai-job-apply/domain";

export interface GeneratedParagraph {
  text: string;
  factIds: string[];
}

export type FindingCode =
  | "schema_invalid"
  | "empty_output"
  | "too_many_paragraphs"
  | "paragraph_too_long"
  | "no_evidence"
  | "unknown_fact"
  | "unusable_fact"
  | "ungrounded_number"
  | "ungrounded_entity"
  | "sensitive_content";

export interface GroundingFinding {
  code: FindingCode;
  paragraph?: number;
}

export interface GroundingLimits {
  maxParagraphs: number;
  maxParagraphChars: number;
}

export const DEFAULT_LIMITS: GroundingLimits = { maxParagraphs: 6, maxParagraphChars: 1_200 };

const SENSITIVE =
  /\b(?:visas?|sponsor(?:ship|ed|ing)?|citizen(?:ship)?|immigration|work\s+authori[sz]ation|veterans?|disabilit(?:y|ies)|disabled|race|racial|ethnic\w*|gender|religio\w*|pregnan\w*|marital|married|age|nationality|orientation|criminal|felony)\b/iu;

const NUMBER = /\d[\d,.]*\s?%?/gu;
const ALWAYS_ALLOWED = new Set([
  "i",
  "i'm",
  "i've",
  "i'd",
  "i'll",
  "my",
  "me",
  "dear",
  "sincerely",
]);

/** Parses untrusted model output into paragraphs; anything else is a schema failure. */
export function parseParagraphs(
  value: unknown,
  limits: GroundingLimits = DEFAULT_LIMITS,
): { paragraphs: GeneratedParagraph[]; findings: GroundingFinding[] } {
  const findings: GroundingFinding[] = [];
  const paragraphs: GeneratedParagraph[] = [];
  const candidate = value as { paragraphs?: unknown } | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray(candidate.paragraphs) ||
    Object.keys(candidate).length !== 1
  ) {
    return { paragraphs, findings: [{ code: "schema_invalid" }] };
  }
  if (candidate.paragraphs.length === 0) {
    return { paragraphs, findings: [{ code: "empty_output" }] };
  }
  if (candidate.paragraphs.length > limits.maxParagraphs) {
    findings.push({ code: "too_many_paragraphs" });
  }
  for (const [index, raw] of candidate.paragraphs.entries()) {
    const entry = raw as { text?: unknown; factIds?: unknown } | null;
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).length !== 2 ||
      typeof entry.text !== "string" ||
      entry.text.trim().length === 0 ||
      !Array.isArray(entry.factIds) ||
      !entry.factIds.every((id) => typeof id === "string")
    ) {
      findings.push({ code: "schema_invalid", paragraph: index });
      continue;
    }
    if (entry.text.length > limits.maxParagraphChars) {
      findings.push({ code: "paragraph_too_long", paragraph: index });
    }
    paragraphs.push({ text: entry.text.trim(), factIds: [...(entry.factIds as string[])] });
  }
  return { paragraphs, findings };
}

function factText(fact: GraphFact): string {
  return `${fact.key} ${Array.isArray(fact.value) ? fact.value.join(" ") : String(fact.value)}`;
}

function words(text: string): string[] {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'+#.-]*/gu) ?? []).map((word) =>
    word.replace(/[.'-]+$/u, ""),
  );
}

export interface AllowedContext {
  /** Terms from the target job the letter may address, such as the company and role title. */
  jobTerms: readonly string[];
}

/**
 * Deterministic unsupported-claim checks on top of fact grounding. A paragraph passes only if it
 * cites usable confirmed facts and every number and every mid-sentence proper noun it states is
 * present in those facts (or names the target job). It cannot pass by sounding plausible.
 */
export function checkParagraphs(
  paragraphs: readonly GeneratedParagraph[],
  graph: FactGraph,
  context: AllowedContext,
): GroundingFinding[] {
  const findings: GroundingFinding[] = [];
  const jobWords = new Set(context.jobTerms.flatMap((term) => words(term.toLowerCase())));
  for (const [index, paragraph] of paragraphs.entries()) {
    const grounding = graph.ground({ text: paragraph.text, factIds: paragraph.factIds });
    if (!grounding.grounded) {
      const code: FindingCode =
        grounding.reason === "no_evidence"
          ? "no_evidence"
          : grounding.reason === "unknown_fact"
            ? "unknown_fact"
            : "unusable_fact";
      findings.push({ code, paragraph: index });
      continue;
    }
    if (SENSITIVE.test(paragraph.text))
      findings.push({ code: "sensitive_content", paragraph: index });

    const cited = grounding.factIds
      .map((id) => graph.get(id))
      .filter((fact): fact is GraphFact => fact !== undefined);
    const citedText = cited.map(factText).join(" ");
    const citedWords = new Set(words(citedText.toLowerCase()));

    for (const match of paragraph.text.match(NUMBER) ?? []) {
      const number = match.trim().replace(/[.,]+$/u, "");
      if (number && !citedText.includes(number)) {
        findings.push({ code: "ungrounded_number", paragraph: index });
        break;
      }
    }

    // Proper nouns: capitalized words that do not start a sentence must come from the facts.
    let ungroundedEntity = false;
    for (const sentence of paragraph.text.split(/(?<=[.!?])\s+/u)) {
      const tokens = words(sentence);
      for (const token of tokens.slice(1)) {
        const lower = token.toLowerCase();
        if (
          token[0] !== token[0]?.toUpperCase() ||
          token[0] === token[0]?.toLowerCase() ||
          ALWAYS_ALLOWED.has(lower) ||
          citedWords.has(lower) ||
          jobWords.has(lower)
        ) {
          continue;
        }
        ungroundedEntity = true;
      }
    }
    if (ungroundedEntity) findings.push({ code: "ungrounded_entity", paragraph: index });
  }
  return findings;
}
