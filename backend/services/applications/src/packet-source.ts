import { FactGraph, factConfidence, type GraphFact } from "@ai-job-apply/domain";
import { canonicalHash } from "./canonical.js";
import type { ProposedField } from "./field-policy.js";
import type { ArtifactHashes } from "./packet.js";
import type { PacketPreparation, PacketPreparationSource, UserEntry } from "./service.js";
import type { ApplicationRecord } from "./store.js";

/**
 * The only automatic mappings from confirmed Profile facts to application field keys. Each is
 * exact and unambiguous. Everything else (names, phone, links, employment, answers) reaches a
 * packet only when the candidate enters it, until a reviewed fact-key convention adds a row here.
 */
export const FACT_FIELD_MAP: ReadonlyArray<{ kind: string; key: string; fieldKey: string }> = [
  { kind: "identity", key: "email", fieldKey: "contact.email" },
];

export interface FactBackedPacketSourceDependencies {
  /** The owner's current Profile facts, read through the Profile owner API. */
  facts(ownerUserId: string): Promise<readonly GraphFact[]>;
  /** SHA-256 of the public job facts the packet is prepared against. */
  jobRevision(application: ApplicationRecord): Promise<string>;
  /** Hashes of the resume and cover-letter versions the candidate chose. */
  artifacts(ownerUserId: string, application: ApplicationRecord): Promise<ArtifactHashes>;
  clock?: () => Date;
}

/** Stable revision of the job facts an approval depends on (title, company, location, URL, ...). */
export function jobRevisionHash(jobFacts: unknown): string {
  return canonicalHash({ schema: "job-revision.v1", job: jobFacts });
}

function scalar(value: GraphFact["value"]): string | number | boolean {
  return Array.isArray(value) ? value.join(", ") : (value as string | number | boolean);
}

/**
 * Builds packet proposals from confirmed facts only. A fact is usable only when it is confirmed,
 * available, and effective; when several usable facts compete for one field none is chosen, so
 * the candidate decides. Candidate entries always win and are marked as candidate supplied.
 */
export class FactBackedPacketSource implements PacketPreparationSource {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: FactBackedPacketSourceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async prepare(input: {
    ownerUserId: string;
    application: ApplicationRecord;
    userEntries: readonly UserEntry[];
    form: PacketPreparation["form"];
  }): Promise<PacketPreparation> {
    const graph = FactGraph.build(await this.dependencies.facts(input.ownerUserId), this.clock());
    const entered = new Set(input.userEntries.map((entry) => entry.fieldKey));
    const fields: ProposedField[] = [];

    for (const mapping of FACT_FIELD_MAP) {
      if (entered.has(mapping.fieldKey)) continue;
      const candidates = graph.usable(mapping.kind, mapping.key);
      const [only] = candidates;
      if (candidates.length !== 1 || !only) continue;
      fields.push({
        fieldKey: mapping.fieldKey,
        value: scalar(only.value),
        origin: "confirmed_fact",
        sourceFactIds: [only.id],
        sourceConfirmed: true,
        confidence: factConfidence(only),
      });
    }
    for (const entry of input.userEntries) {
      fields.push({
        fieldKey: entry.fieldKey,
        value: entry.value,
        origin: "user_entered",
        sourceFactIds: [],
        sourceConfirmed: true,
        confidence: 1,
      });
    }
    return {
      jobRevision: await this.dependencies.jobRevision(input.application),
      form: input.form,
      fields,
      artifactHashes: await this.dependencies.artifacts(input.ownerUserId, input.application),
    };
  }
}
