import { FactGraph, factConfidence, type GraphFact } from "@ai-job-apply/domain";
import { canonicalHash } from "./canonical.js";
import type { ProposedField } from "./field-policy.js";
import { type FieldDefinition, isDirectActionField } from "./field-policy.js";
import type { ArtifactHashes } from "./packet.js";
import { PacketInvariantError } from "./packet.js";
import type { PacketPreparation, PacketPreparationSource, UserEntry } from "./service.js";
import { ApplicationsUnavailableError } from "./service.js";
import type { ApplicationRecord } from "./store.js";
import { StalePacketError } from "./store.js";
import {
  decodeVaultValue,
  type VaultReader,
  type VaultSelection,
  validVaultReference,
} from "./vault.js";

export type FactValueType = "string" | "date" | "decimal" | "boolean" | "enum";

export interface FactFieldMapping {
  /** Profile fact kind, an exact match. */
  kind: string;
  /** Profile fact key, an exact match. */
  key: string;
  /** Application field the fact fills. */
  fieldKey: string;
  /** The field's value type; a fact whose value does not fit it is left for the candidate. */
  valueType: FactValueType;
}

const row = (
  kind: string,
  key: string,
  fieldKey: string,
  valueType: FactValueType = "string",
): FactFieldMapping => ({ kind, key, fieldKey, valueType });

/**
 * The only automatic mappings from confirmed Profile facts to application field keys, approved by the
 * owner (2026-09-19). Each is an exact fact kind and key: `identity` facts for name, contact, and links,
 * `employment`, `education`, and `preference` facts for the rest. Restricted answers (authorization,
 * disclosures, demographics, attestations, signatures), narrative questions, and documents are never
 * mapped here; they need the candidate, the answer vault, or a document artifact. Everything else
 * reaches a packet only when the candidate enters it.
 */
export const FACT_FIELD_MAP: ReadonlyArray<FactFieldMapping> = [
  row("identity", "legal_name.first", "identity.legal_name.first"),
  row("identity", "legal_name.middle", "identity.legal_name.middle"),
  row("identity", "legal_name.last", "identity.legal_name.last"),
  row("identity", "preferred_name", "identity.preferred_name"),
  row("identity", "email", "contact.email"),
  row("identity", "phone", "contact.phone"),
  row("identity", "address.line1", "contact.address.line1"),
  row("identity", "address.city", "contact.address.city"),
  row("identity", "address.region", "contact.address.region"),
  row("identity", "address.postal_code", "contact.address.postal_code"),
  row("identity", "linkedin", "links.linkedin"),
  row("identity", "portfolio", "links.portfolio"),
  row("identity", "github", "links.github"),
  row("employment", "current_company", "employment.current_company"),
  row("employment", "current_title", "employment.current_title"),
  row("employment", "start_date", "employment.start_date", "date"),
  row("employment", "end_date", "employment.end_date", "date"),
  row("education", "school", "education.school"),
  row("education", "degree", "education.degree"),
  row("education", "field", "education.field"),
  row("education", "graduation_date", "education.graduation_date", "date"),
  row("preference", "notice_period", "job.notice_period"),
  row("preference", "available_start_date", "job.available_start_date", "date"),
  row("preference", "salary_expectation", "job.salary_expectation", "decimal"),
  row("preference", "relocation", "job.relocation", "boolean"),
  row("preference", "remote_preference", "job.remote_preference", "enum"),
];

const MAXIMUM_TEXT_CHARACTERS = 500;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** True only when the fact's value has exactly the shape the field expects; arrays never fit. */
export function factValueFits(value: GraphFact["value"], valueType: FactValueType): boolean {
  switch (valueType) {
    case "string":
    case "enum":
      return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= MAXIMUM_TEXT_CHARACTERS
      );
    case "date":
      return typeof value === "string" && isCalendarDate(value);
    case "decimal":
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    case "boolean":
      return typeof value === "boolean";
  }
}

export interface FactBackedPacketSourceDependencies {
  /** The owner's current Profile facts, read through the Profile owner API. */
  facts(ownerUserId: string): Promise<readonly GraphFact[]>;
  /** SHA-256 of the public job facts the packet is prepared against. */
  jobRevision(application: ApplicationRecord): Promise<string>;
  /** Hashes of the resume and cover-letter versions the candidate chose. */
  artifacts(ownerUserId: string, application: ApplicationRecord): Promise<ArtifactHashes>;
  vault?: VaultReader;
  definitions?: ReadonlyMap<string, FieldDefinition>;
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
    vaultSelections?: readonly VaultSelection[];
    form: PacketPreparation["form"];
  }): Promise<PacketPreparation> {
    input = structuredClone(input);
    const selections = input.vaultSelections ?? [];
    if (
      selections.length > 20 ||
      new Set(selections.map((selection) => selection.fieldKey)).size !== selections.length
    ) {
      throw new PacketInvariantError("Invalid saved-answer selections");
    }
    for (const selection of selections) {
      const definition = this.dependencies.definitions?.get(selection.fieldKey);
      if (
        !input.form ||
        !validVaultReference({ ...selection, validUntilEpochMs: null }) ||
        !definition ||
        definition.sensitivity === "standard" ||
        isDirectActionField(selection.fieldKey) ||
        input.userEntries.some((entry) => entry.fieldKey === selection.fieldKey)
      ) {
        throw new PacketInvariantError("Invalid saved-answer selection");
      }
    }
    if (selections.length && !this.dependencies.vault) throw new ApplicationsUnavailableError();
    const graph = FactGraph.build(await this.dependencies.facts(input.ownerUserId), this.clock());
    const entered = new Set([
      ...input.userEntries.map((entry) => entry.fieldKey),
      ...selections.map((selection) => selection.fieldKey),
    ]);
    const fields: ProposedField[] = [];

    for (const mapping of FACT_FIELD_MAP) {
      if (entered.has(mapping.fieldKey)) continue;
      const candidates = graph.usable(mapping.kind, mapping.key);
      const [only] = candidates;
      if (candidates.length !== 1 || !only || !factValueFits(only.value, mapping.valueType))
        continue;
      fields.push({
        fieldKey: mapping.fieldKey,
        value: scalar(only.value),
        origin: "confirmed_fact",
        sourceFactIds: [only.id],
        sourceConfirmed: true,
        confidence: factConfidence(only),
      });
    }
    for (const selection of selections) {
      const vault = this.dependencies.vault;
      const definition = this.dependencies.definitions?.get(selection.fieldKey);
      if (!vault || !definition) throw new ApplicationsUnavailableError();
      let saved: Awaited<ReturnType<VaultReader["readSelectedValue"]>>;
      try {
        saved = await vault.readSelectedValue(input.ownerUserId, selection);
      } catch {
        throw new ApplicationsUnavailableError();
      }
      if (
        !saved ||
        saved.id !== selection.id ||
        saved.version !== selection.version ||
        saved.fieldKey !== selection.fieldKey ||
        saved.context !== selection.context
      ) {
        throw new StalePacketError(["vault_answer_changed"]);
      }
      const reference = {
        id: saved.id,
        version: saved.version,
        context: saved.context,
        questionHash: selection.questionHash,
        meaningConfirmed: true as const,
        validUntilEpochMs: saved.validUntilEpochMs,
      };
      const value = decodeVaultValue(definition, saved);
      const selectedAt = this.clock().getTime();
      if (
        !Number.isFinite(selectedAt) ||
        value === undefined ||
        !validVaultReference(reference) ||
        (reference.validUntilEpochMs !== null && selectedAt >= reference.validUntilEpochMs)
      ) {
        throw new PacketInvariantError("Unsupported saved answer");
      }
      fields.push({
        fieldKey: selection.fieldKey,
        value,
        origin: "answer_vault",
        sourceFactIds: [saved.id],
        sourceConfirmed: true,
        confidence: 1,
        vaultReference: reference,
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
