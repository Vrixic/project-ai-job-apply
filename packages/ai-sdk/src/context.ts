import { createHash } from "node:crypto";
import { FactGraph, type GraphFact } from "@ai-job-apply/domain";
import { type JobPromptFacts, PROMPT_VERSIONS, type PromptFact } from "./prompts.js";

const GENERATION_FACT_KINDS = ["employment", "education", "project", "skill", "certification"];
const MAX_FACTS = 40;

export function selectPromptFacts(graph: FactGraph, facts: readonly GraphFact[]): PromptFact[] {
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
