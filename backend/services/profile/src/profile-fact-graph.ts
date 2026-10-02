import type { ProfileFact } from "@ai-job-apply/api-contracts";
import type { GraphFact } from "@ai-job-apply/domain";

/** Snapshot the graph projection without owner/audit transport metadata. No facts are inferred. */
export function profileFactToGraphFact(fact: ProfileFact): GraphFact {
  return structuredClone({
    id: fact.id,
    kind: fact.kind,
    key: fact.key,
    value: fact.value,
    verification: fact.verification,
    sensitivity: fact.sensitivity,
    source: { type: fact.source.type, reference: fact.source.reference },
    ...(fact.evidence ? { evidence: { supportingSpans: fact.evidence.supportingSpans } } : {}),
    ...(fact.availability ? { availability: fact.availability } : {}),
    ...(fact.effectiveFrom ? { effectiveFrom: fact.effectiveFrom } : {}),
    ...(fact.effectiveTo ? { effectiveTo: fact.effectiveTo } : {}),
    version: fact.version,
  }) as GraphFact;
}
