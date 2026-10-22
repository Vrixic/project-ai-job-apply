import { createHash } from "node:crypto";
import type { GraphFact } from "./fact-graph.js";

/**
 * Grounding evidence from the structured Profile (ADR-052). Generated content and application
 * packets read only saved Profile records. This adapter presents those records to the existing
 * fact checks (`FactGraph`, ADR-030 grounding, packet field mapping) so they run unchanged: every
 * saved record is usable by construction, and nothing is inferred beyond the single documented
 * name split and the "current" and "first" selections below.
 *
 * Fact identifiers are the record's own id where a record is cited directly (work experience,
 * education and skills) and stable derived identifiers where one record feeds several packet
 * fields. Every fact names its record in `source.reference` as
 * `profile-entry:{section}:{recordId}:v{version}`, and `profileEntryReference` reads it back.
 */

export interface PersonalRecordLike {
  version: number;
  fullName?: string;
  email?: string;
  phone?: string;
  address?: Partial<Record<"street" | "city" | "region" | "postalCode" | "country", string>>;
  links?: ReadonlyArray<{ kind: string; url: string }>;
}

export interface EducationRecordLike {
  id: string;
  version: number;
  school: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
}

export interface WorkRecordLike {
  id: string;
  version: number;
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  bullets?: readonly string[];
}

export interface SkillRecordLike {
  id: string;
  version: number;
  name: string;
}

export interface ProfileEntryFactInput {
  userId: string;
  personal?: PersonalRecordLike | null | undefined;
  /** Each list is in the candidate's display order. */
  education: readonly EducationRecordLike[];
  workExperience: readonly WorkRecordLike[];
  skills: readonly SkillRecordLike[];
}

export type ProfileEntrySectionName = "personal" | "education" | "workExperience" | "skill";

export interface ProfileEntryReference {
  section: ProfileEntrySectionName;
  entryId: string;
  version: number;
}

const REFERENCE =
  /^profile-entry:(personal|education|workExperience|skill):([0-9a-f-]{36}):v([1-9][0-9]*)$/u;

function derivedId(...parts: readonly string[]): string {
  const hex = createHash("sha256")
    .update(`ai-job-apply/profile-entry-fact/v1\0${parts.join("\0")}`)
    .digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The stable identifier of a candidate's Personal record, which has no id of its own. */
export function personalRecordId(userId: string): string {
  return derivedId("personal", userId);
}

function reference(section: ProfileEntrySectionName, entryId: string, version: number): string {
  return `profile-entry:${section}:${entryId}:v${version}`;
}

/** The Profile record a fact came from, or undefined for a fact that did not come from one. */
export function profileEntryReference(
  fact: Pick<GraphFact, "source">,
): ProfileEntryReference | undefined {
  const match = REFERENCE.exec(fact.source.reference);
  if (!match) return undefined;
  return {
    section: match[1] as ProfileEntrySectionName,
    entryId: match[2] as string,
    version: Number(match[3]),
  };
}

function fact(
  id: string,
  kind: string,
  key: string,
  value: GraphFact["value"],
  sensitivity: GraphFact["sensitivity"],
  ref: string,
  version: number,
): GraphFact {
  return {
    id,
    kind,
    key,
    value,
    verification: "confirmed",
    sensitivity,
    source: { type: "user", reference: ref },
    version,
  };
}

function dateText(start?: string, end?: string): string | undefined {
  if (!start && !end) return undefined;
  return `${start ?? "?"} to ${end ?? "present"}`;
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function personalFacts(userId: string, personal: PersonalRecordLike): GraphFact[] {
  const id = personalRecordId(userId);
  const ref = reference("personal", id, personal.version);
  const facts: GraphFact[] = [];
  const add = (key: string, value: string | undefined) => {
    if (!present(value)) return;
    facts.push(
      fact(
        derivedId("personal", userId, key),
        "identity",
        key,
        value.trim(),
        "confidential",
        ref,
        personal.version,
      ),
    );
  };
  if (present(personal.fullName)) {
    // The only inference: a whitespace split. First and last word are the first and last name.
    const words = personal.fullName.trim().split(/\s+/u);
    add("legal_name.first", words[0]);
    if (words.length > 1) add("legal_name.last", words.at(-1));
    if (words.length > 2) add("legal_name.middle", words.slice(1, -1).join(" "));
  }
  add("email", personal.email);
  add("phone", personal.phone);
  add("address.line1", personal.address?.street);
  add("address.city", personal.address?.city);
  add("address.region", personal.address?.region);
  add("address.postal_code", personal.address?.postalCode);
  const link = (kind: string) => personal.links?.find((item) => item.kind === kind)?.url;
  add("linkedin", link("linkedin"));
  add("github", link("github"));
  add("portfolio", link("portfolio"));
  return facts;
}

function workFacts(userId: string, entries: readonly WorkRecordLike[]): GraphFact[] {
  const facts: GraphFact[] = [];
  for (const entry of entries) {
    const ref = reference("workExperience", entry.id, entry.version);
    const value = [
      `${entry.title} at ${entry.company}`,
      ...(present(entry.location) ? [entry.location] : []),
      dateText(entry.startDate, entry.endDate) ?? "",
      ...(entry.bullets ?? []),
    ].filter(present);
    facts.push(fact(entry.id, "employment", "role", value, "standard", ref, entry.version));
  }
  // The current job is the first saved entry without an end date.
  const current = entries.find((entry) => !present(entry.endDate));
  if (current) {
    const ref = reference("workExperience", current.id, current.version);
    const add = (key: string, value: string) =>
      facts.push(
        fact(
          derivedId("work-current", userId, key),
          "employment",
          key,
          value,
          "confidential",
          ref,
          current.version,
        ),
      );
    add("current_company", current.company);
    add("current_title", current.title);
    add("start_date", current.startDate);
  }
  return facts;
}

function educationFacts(userId: string, entries: readonly EducationRecordLike[]): GraphFact[] {
  const facts: GraphFact[] = [];
  for (const entry of entries) {
    const ref = reference("education", entry.id, entry.version);
    const value = [
      entry.school,
      ...(present(entry.degree) ? [entry.degree] : []),
      ...(present(entry.fieldOfStudy) ? [entry.fieldOfStudy] : []),
      dateText(entry.startDate, entry.endDate) ?? "",
    ].filter(present);
    facts.push(fact(entry.id, "education", "entry", value, "standard", ref, entry.version));
  }
  // Packet fields use the first saved education entry.
  const first = entries[0];
  if (first) {
    const ref = reference("education", first.id, first.version);
    const add = (key: string, value: string | undefined) => {
      if (!present(value)) return;
      facts.push(
        fact(
          derivedId("education-first", userId, key),
          "education",
          key,
          value,
          "confidential",
          ref,
          first.version,
        ),
      );
    };
    add("school", first.school);
    add("degree", first.degree);
    add("field", first.fieldOfStudy);
    add("graduation_date", first.endDate);
  }
  return facts;
}

export function profileEntriesToGraphFacts(input: ProfileEntryFactInput): GraphFact[] {
  return [
    ...(input.personal ? personalFacts(input.userId, input.personal) : []),
    ...workFacts(input.userId, input.workExperience),
    ...educationFacts(input.userId, input.education),
    ...input.skills.map((skill) =>
      fact(
        skill.id,
        "skill",
        "skill",
        skill.name,
        "standard",
        reference("skill", skill.id, skill.version),
        skill.version,
      ),
    ),
  ];
}
