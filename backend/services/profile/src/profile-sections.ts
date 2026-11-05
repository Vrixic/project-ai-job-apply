import { createHash } from "node:crypto";
import {
  type CreateProfileApplicationAnswerRequest,
  type CreateProfileEducationEntryRequest,
  type CreateProfileSkillEntryRequest,
  type CreateProfileWorkExperienceEntryRequest,
  compileComponentValidator,
  type ProfileApplicationAnswer,
  type ProfileEducationEntry,
  type ProfileEntryReference,
  type ProfileImportDraft,
  type ProfilePersonal,
  type ProfileSkillEntry,
  type ProfileWorkExperienceEntry,
  type PutProfilePersonalRequest,
  type SaveProfileImportDraftRequest,
  type UpdateProfileApplicationAnswerRequest,
  type UpdateProfileEducationEntryRequest,
  type UpdateProfileSkillEntryRequest,
  type UpdateProfileWorkExperienceEntryRequest,
} from "@ai-job-apply/api-contracts";
import {
  type EducationRecordLike,
  type GraphFact,
  normalizeQuestionKey,
  type PersonalRecordLike,
  profileEntriesToGraphFacts,
  type SkillRecordLike,
  type WorkRecordLike,
} from "@ai-job-apply/domain";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

/**
 * Structured candidate Profile (ADR-052): Personal, Education, Work experience, Skills and
 * Application answers as plain saved records, plus unsaved import drafts. Every record is owned by
 * exactly one user, standard sensitivity, and written as an append-only version with optimistic
 * concurrency. Restricted answers never enter this store; they stay in the ADR-010 vault.
 *
 * Every write holds the active-candidate lease (quarantined or deleting accounts cannot write),
 * is idempotent per key, and records a content-free audit event. Deleting an entry removes it and
 * all its versions, so a deletion actually erases the candidate's text.
 */

export type ProfileEntrySection = "education" | "workExperience" | "skill" | "applicationAnswer";
export type ProfileDraftSection = "personal" | "education" | "workExperience" | "skill";

export type ProfileEntryRecord =
  | ProfileEducationEntry
  | ProfileWorkExperienceEntry
  | ProfileSkillEntry
  | ProfileApplicationAnswer;

export type CreateProfileEntryRequest =
  | CreateProfileEducationEntryRequest
  | CreateProfileWorkExperienceEntryRequest
  | CreateProfileSkillEntryRequest
  | CreateProfileApplicationAnswerRequest;

export type UpdateProfileEntryRequest =
  | UpdateProfileEducationEntryRequest
  | UpdateProfileWorkExperienceEntryRequest
  | UpdateProfileSkillEntryRequest
  | UpdateProfileApplicationAnswerRequest;

export const PROFILE_SECTION_LIMITS: Readonly<Record<ProfileEntrySection, number>> = Object.freeze({
  education: 20,
  workExperience: 30,
  skill: 100,
  applicationAnswer: 200,
});
const MAX_DRAFTS = 200;

const CREATE_VALIDATORS = {
  education: () => compileComponentValidator("CreateProfileEducationEntryRequest"),
  workExperience: () => compileComponentValidator("CreateProfileWorkExperienceEntryRequest"),
  skill: () => compileComponentValidator("CreateProfileSkillEntryRequest"),
  applicationAnswer: () => compileComponentValidator("CreateProfileApplicationAnswerRequest"),
} as const;

export class ProfileSectionInputError extends Error {
  constructor(reason: string) {
    super(`Profile section input is invalid: ${reason}`);
    this.name = "ProfileSectionInputError";
  }
}

export class ProfileSectionVersionConflictError extends Error {
  constructor() {
    super("The profile record changed after it was loaded");
    this.name = "ProfileSectionVersionConflictError";
  }
}

export class ProfileSectionNotFoundError extends Error {
  constructor() {
    super("The profile record was not found");
    this.name = "ProfileSectionNotFoundError";
  }
}

export class ProfileSectionLimitError extends Error {
  constructor(section: ProfileEntrySection | "drafts") {
    super(`The ${section} section is full`);
    this.name = "ProfileSectionLimitError";
  }
}

export class ProfileSectionDuplicateError extends Error {
  constructor() {
    super("A saved record with the same name or question already exists");
    this.name = "ProfileSectionDuplicateError";
  }
}

export class ProfileSectionOrderError extends Error {
  constructor() {
    super("The order must list every saved entry of the section exactly once");
    this.name = "ProfileSectionOrderError";
  }
}

export class ProfileSectionRestrictedQuestionError extends Error {
  constructor() {
    super("Restricted questions are saved through the restricted answer vault");
    this.name = "ProfileSectionRestrictedQuestionError";
  }
}

export class ProfileSectionIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
    this.name = "ProfileSectionIdempotencyConflictError";
  }
}

export interface ProfileSectionStore {
  getPersonal(userId: string): Promise<ProfilePersonal | null>;
  putPersonal(
    userId: string,
    input: PutProfilePersonalRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfilePersonal>;
  listEntries(userId: string, section: ProfileEntrySection): Promise<ProfileEntryRecord[]>;
  createEntry(
    userId: string,
    section: ProfileEntrySection,
    input: CreateProfileEntryRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord>;
  updateEntry(
    userId: string,
    section: ProfileEntrySection,
    entryId: string,
    input: UpdateProfileEntryRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord>;
  deleteEntry(
    userId: string,
    section: ProfileEntrySection,
    entryId: string,
    expectedVersion: number,
    idempotencyKey: string,
    traceId: string,
  ): Promise<void>;
  reorderEntries(
    userId: string,
    section: Exclude<ProfileEntrySection, "applicationAnswer">,
    orderedEntryIds: readonly string[],
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord[]>;
  /**
   * Exact-key reuse (ADR-052): the saved answer whose normalized question key equals the asked
   * question's, or null. Restricted questions never match, and nothing is inferred or fuzzy.
   */
  matchApplicationAnswer(
    userId: string,
    question: string,
  ): Promise<ProfileApplicationAnswer | null>;
  /**
   * The saved Profile as grounding evidence for generation and application packets, read from one
   * consistent snapshot. Drafts are never included.
   */
  listGroundingFacts(userId: string): Promise<GraphFact[]>;
  listDrafts(userId: string): Promise<ProfileImportDraft[]>;
  createDraft(
    userId: string,
    importId: string,
    section: ProfileDraftSection,
    values: Record<string, unknown>,
  ): Promise<ProfileImportDraft>;
  discardDraft(
    userId: string,
    draftId: string,
    idempotencyKey: string,
    traceId: string,
  ): Promise<void>;
  saveDraft(
    userId: string,
    draftId: string,
    input: SaveProfileImportDraftRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryReference>;
}

type Tx = postgres.TransactionSql;
type Json = Record<string, unknown>;

interface EntryRow {
  id: string;
  section: ProfileEntrySection;
  displayOrder: number;
  naturalKey: string | null;
  createdAt: Date | string;
  version: number;
  content: Json;
  origin: "entered" | "imported";
  importId: string | null;
  updatedAt: Date | string;
}

interface PersonalRow {
  version: number;
  content: Json;
  origin: "entered" | "imported";
  importId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface DraftRow {
  id: string;
  importId: string;
  section: ProfileDraftSection;
  values: Json;
  createdAt: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Json)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function naturalKey(section: ProfileEntrySection, content: Json): string | null {
  if (section === "skill") {
    return String(content.name).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  }
  if (section === "applicationAnswer") return normalizeQuestionKey(String(content.question));
  return null;
}

function checkContent(section: ProfileEntrySection, content: Json): void {
  const validate = CREATE_VALIDATORS[section]();
  if (!validate(content)) throw new ProfileSectionInputError("fields are invalid");
  const start = content.startDate;
  const end = content.endDate;
  if (typeof start === "string" && typeof end === "string" && end < start) {
    throw new ProfileSectionInputError("the end date precedes the start date");
  }
  if (section === "applicationAnswer") {
    if (naturalKey(section, content)?.length === 0) {
      throw new ProfileSectionInputError("the question is empty");
    }
  }
}

function mapEntry(row: EntryRow): ProfileEntryRecord {
  const record: Json = {
    id: row.id,
    ...row.content,
    version: row.version,
    origin: row.origin,
    ...(row.importId ? { importId: row.importId } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (row.section === "applicationAnswer") record.questionKey = row.naturalKey ?? "";
  else record.displayOrder = row.displayOrder;
  return record as unknown as ProfileEntryRecord;
}

function mapPersonal(row: PersonalRow): ProfilePersonal {
  return {
    ...row.content,
    version: row.version,
    origin: row.origin,
    ...(row.importId ? { importId: row.importId } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  } as unknown as ProfilePersonal;
}

function mapDraft(row: DraftRow): ProfileImportDraft {
  return {
    id: row.id,
    importId: row.importId,
    section: row.section,
    values: row.values,
    createdAt: iso(row.createdAt),
  } as unknown as ProfileImportDraft;
}

function referenceFor(section: ProfileDraftSection, entryId: string | null, version: number) {
  return (
    section === "personal"
      ? { section: "personal", version }
      : { section, entryId: entryId as string, version }
  ) as ProfileEntryReference;
}

const ENTRY_SELECT = `
  e.id, e.section, e.display_order AS "displayOrder", e.natural_key AS "naturalKey",
  e.created_at AS "createdAt", v.version, v.content, v.origin, v.import_id AS "importId",
  v.created_at AS "updatedAt"`;

/** Draft values must already satisfy the contract of the record they would become. */
export function assertValidDraftValues(
  section: ProfileDraftSection,
  values: Record<string, unknown>,
): void {
  const valid =
    section === "personal"
      ? compileComponentValidator("PutProfilePersonalRequest")({ expectedVersion: 0, ...values })
      : CREATE_VALIDATORS[section]()(values);
  if (!valid) throw new ProfileSectionInputError("draft values are invalid");
}

export const PROFILE_DRAFT_CAPACITY = MAX_DRAFTS;

export class PostgresProfileSectionStore implements ProfileSectionStore {
  constructor(private readonly client: postgres.Sql) {}

  async getPersonal(userId: string): Promise<ProfilePersonal | null> {
    const rows = await this.client<PersonalRow[]>`
      SELECT v.version, v.content, v.origin, v.import_id AS "importId",
        v.created_at AS "updatedAt",
        (SELECT created_at FROM profile.personal_versions WHERE user_id = ${userId} AND version = 1)
          AS "createdAt"
      FROM profile.personal_versions AS v
      WHERE v.user_id = ${userId}
      ORDER BY v.version DESC
      LIMIT 1
    `;
    return rows[0] ? mapPersonal(rows[0]) : null;
  }

  async putPersonal(
    userId: string,
    input: PutProfilePersonalRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfilePersonal> {
    return this.idempotent(
      userId,
      "profile.personal.put.v1",
      idempotencyKey,
      input,
      traceId,
      async (tx) => {
        const { expectedVersion, ...content } = input;
        const saved = await this.writePersonal(
          tx,
          userId,
          content as Json,
          expectedVersion,
          "entered",
          null,
        );
        return {
          response: saved,
          audit: {
            action: "profile.personal.saved",
            resourceId: null,
            metadata: { version: saved.version },
          },
        };
      },
    );
  }

  async listEntries(userId: string, section: ProfileEntrySection): Promise<ProfileEntryRecord[]> {
    const rows = await this.client.unsafe<EntryRow[]>(
      `SELECT ${ENTRY_SELECT}
       FROM profile.entries AS e
       JOIN LATERAL (
         SELECT * FROM profile.entry_versions WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
       ) AS v ON true
       WHERE e.user_id = $1 AND e.section = $2
       ORDER BY e.display_order, e.id`,
      [userId, section],
    );
    return rows.map(mapEntry);
  }

  async createEntry(
    userId: string,
    section: ProfileEntrySection,
    input: CreateProfileEntryRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord> {
    return this.idempotent(
      userId,
      `profile.entry.create.v1:${section}`,
      idempotencyKey,
      input,
      traceId,
      async (tx) => {
        const created = await this.insertEntry(tx, userId, section, input as Json, "entered", null);
        return {
          response: created,
          audit: {
            action: "profile.entry.created",
            resourceId: created.id,
            metadata: { section, version: 1 },
          },
        };
      },
    );
  }

  async updateEntry(
    userId: string,
    section: ProfileEntrySection,
    entryId: string,
    input: UpdateProfileEntryRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord> {
    return this.idempotent(
      userId,
      `profile.entry.update.v1:${section}:${entryId}`,
      idempotencyKey,
      input,
      traceId,
      async (tx) => {
        const current = await this.lockEntry(tx, userId, section, entryId);
        if (current.version !== input.expectedVersion)
          throw new ProfileSectionVersionConflictError();
        const next: Json = { ...current.content };
        for (const [key, value] of Object.entries(input)) {
          if (key === "expectedVersion") continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        checkContent(section, next);
        if (canonical(next) === canonical(current.content)) {
          return { response: mapEntry(current), audit: null };
        }
        const key = naturalKey(section, next);
        const updatedAt = new Date().toISOString();
        const version = current.version + 1;
        try {
          if (key !== current.naturalKey) {
            await tx`UPDATE profile.entries SET natural_key = ${key} WHERE id = ${entryId}`;
          }
          await tx`
            INSERT INTO profile.entry_versions (entry_id, version, content, origin, import_id, created_at)
            VALUES (
              ${entryId}, ${version}, ${JSON.stringify(next)}::text::jsonb, ${current.origin},
              ${current.importId}, ${updatedAt}::timestamptz
            )
          `;
        } catch (error) {
          throw translateUniqueViolation(error);
        }
        const response = mapEntry({
          ...current,
          naturalKey: key,
          version,
          content: next,
          updatedAt,
        });
        return {
          response,
          audit: {
            action: "profile.entry.version.created",
            resourceId: entryId,
            metadata: { section, version },
          },
        };
      },
    );
  }

  async deleteEntry(
    userId: string,
    section: ProfileEntrySection,
    entryId: string,
    expectedVersion: number,
    idempotencyKey: string,
    traceId: string,
  ): Promise<void> {
    await this.idempotent<Json>(
      userId,
      `profile.entry.delete.v1:${section}:${entryId}`,
      idempotencyKey,
      { expectedVersion },
      traceId,
      async (tx) => {
        const current = await this.lockEntry(tx, userId, section, entryId);
        if (current.version !== expectedVersion) throw new ProfileSectionVersionConflictError();
        await tx`DELETE FROM profile.entries WHERE id = ${entryId} AND user_id = ${userId}`;
        // Replay records keep whole responses; drop every one that still carries the erased text.
        await tx`
          DELETE FROM platform.idempotency_keys
          WHERE user_id = ${userId}
            AND (
              scope LIKE ${`profile.entry.%:${section}:${entryId}`}
              OR (scope LIKE 'profile.entry.create.v1:%' AND response ->> 'id' = ${entryId})
              OR scope = ${`profile.entry.reorder.v1:${section}`}
            )
        `;
        return {
          response: {},
          audit: { action: "profile.entry.deleted", resourceId: entryId, metadata: { section } },
        };
      },
    );
  }

  async reorderEntries(
    userId: string,
    section: Exclude<ProfileEntrySection, "applicationAnswer">,
    orderedEntryIds: readonly string[],
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryRecord[]> {
    return this.idempotent(
      userId,
      `profile.entry.reorder.v1:${section}`,
      idempotencyKey,
      { orderedEntryIds },
      traceId,
      async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`profile-section:${userId}:${section}`}))`;
        const live = await tx<{ id: string }[]>`
          SELECT id FROM profile.entries WHERE user_id = ${userId} AND section = ${section}
        `;
        const wanted = new Set(orderedEntryIds);
        if (
          wanted.size !== orderedEntryIds.length ||
          live.length !== wanted.size ||
          live.some((row) => !wanted.has(row.id))
        ) {
          throw new ProfileSectionOrderError();
        }
        await tx`
          UPDATE profile.entries AS e
          SET display_order = ordered.position - 1
          FROM unnest(${orderedEntryIds as string[]}::uuid[]) WITH ORDINALITY AS ordered(id, position)
          WHERE e.id = ordered.id AND e.user_id = ${userId}
        `;
        const rows = await tx.unsafe<EntryRow[]>(
          `SELECT ${ENTRY_SELECT}
           FROM profile.entries AS e
           JOIN LATERAL (
             SELECT * FROM profile.entry_versions WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
           ) AS v ON true
           WHERE e.user_id = $1 AND e.section = $2
           ORDER BY e.display_order, e.id`,
          [userId, section],
        );
        return {
          response: rows.map(mapEntry),
          audit: { action: "profile.entry.reordered", resourceId: null, metadata: { section } },
        };
      },
    );
  }

  async matchApplicationAnswer(
    userId: string,
    question: string,
  ): Promise<ProfileApplicationAnswer | null> {
    const key = normalizeQuestionKey(question);
    if (key.length === 0) return null;
    const rows = await this.client.unsafe<EntryRow[]>(
      `SELECT ${ENTRY_SELECT}
       FROM profile.entries AS e
       JOIN LATERAL (
         SELECT * FROM profile.entry_versions WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
       ) AS v ON true
       WHERE e.user_id = $1 AND e.section = 'applicationAnswer' AND e.natural_key = $2`,
      [userId, key],
    );
    return rows[0] ? (mapEntry(rows[0]) as ProfileApplicationAnswer) : null;
  }

  async listGroundingFacts(userId: string): Promise<GraphFact[]> {
    return this.client.begin("isolation level repeatable read read only", async (tx) => {
      const personal = await tx<PersonalRow[]>`
        SELECT v.version, v.content, v.origin, v.import_id AS "importId",
          v.created_at AS "updatedAt", v.created_at AS "createdAt"
        FROM profile.personal_versions AS v
        WHERE v.user_id = ${userId}
        ORDER BY v.version DESC
        LIMIT 1
      `;
      const entries = async (section: ProfileEntrySection) =>
        (
          await tx.unsafe<EntryRow[]>(
            `SELECT ${ENTRY_SELECT}
             FROM profile.entries AS e
             JOIN LATERAL (
               SELECT * FROM profile.entry_versions WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
             ) AS v ON true
             WHERE e.user_id = $1 AND e.section = $2
             ORDER BY e.display_order, e.id`,
            [userId, section],
          )
        ).map(mapEntry) as unknown[];
      return profileEntriesToGraphFacts({
        userId,
        personal: personal[0] ? (mapPersonal(personal[0]) as unknown as PersonalRecordLike) : null,
        education: (await entries("education")) as EducationRecordLike[],
        workExperience: (await entries("workExperience")) as WorkRecordLike[],
        skills: (await entries("skill")) as SkillRecordLike[],
      });
    }) as Promise<GraphFact[]>;
  }

  async listDrafts(userId: string): Promise<ProfileImportDraft[]> {
    const rows = await this.client<DraftRow[]>`
      SELECT id, import_id AS "importId", section, draft_values AS "values", created_at AS "createdAt"
      FROM profile.import_drafts
      WHERE user_id = ${userId}
      ORDER BY created_at, id
    `;
    return rows.map(mapDraft);
  }

  async createDraft(
    userId: string,
    importId: string,
    section: ProfileDraftSection,
    values: Record<string, unknown>,
  ): Promise<ProfileImportDraft> {
    assertValidDraftValues(section, values);
    const id = uuidv7();
    return this.client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${userId}::uuid)`;
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`profile-drafts:${userId}`}))`;
      const [counted] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM profile.import_drafts WHERE user_id = ${userId}
      `;
      if ((counted?.count ?? 0) >= MAX_DRAFTS) throw new ProfileSectionLimitError("drafts");
      const createdAt = new Date().toISOString();
      await tx`
        INSERT INTO profile.import_drafts (id, user_id, import_id, section, draft_values, created_at)
        VALUES (
          ${id}, ${userId}, ${importId}, ${section}, ${JSON.stringify(values)}::text::jsonb,
          ${createdAt}::timestamptz
        )
      `;
      return mapDraft({ id, importId, section, values, createdAt });
    });
  }

  async discardDraft(
    userId: string,
    draftId: string,
    idempotencyKey: string,
    traceId: string,
  ): Promise<void> {
    await this.idempotent<Json>(
      userId,
      `profile.draft.discard.v1:${draftId}`,
      idempotencyKey,
      { draftId },
      traceId,
      async (tx) => {
        const removed = await tx<{ id: string }[]>`
          DELETE FROM profile.import_drafts WHERE id = ${draftId} AND user_id = ${userId}
          RETURNING id
        `;
        if (!removed[0]) throw new ProfileSectionNotFoundError();
        return {
          response: {},
          audit: { action: "profile.draft.discarded", resourceId: draftId, metadata: {} },
        };
      },
    );
  }

  async saveDraft(
    userId: string,
    draftId: string,
    input: SaveProfileImportDraftRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileEntryReference> {
    return this.idempotent(
      userId,
      `profile.draft.save.v1:${draftId}`,
      idempotencyKey,
      input,
      traceId,
      async (tx) => {
        const rows = await tx<DraftRow[]>`
          SELECT id, import_id AS "importId", section, draft_values AS "values",
            created_at AS "createdAt"
          FROM profile.import_drafts
          WHERE id = ${draftId} AND user_id = ${userId}
          FOR UPDATE
        `;
        const draft = rows[0];
        if (!draft) throw new ProfileSectionNotFoundError();
        const values = (input.values as Json | undefined) ?? draft.values;
        let reference: ProfileEntryReference;
        if (draft.section === "personal") {
          if (input.expectedPersonalVersion === undefined) {
            throw new ProfileSectionInputError("a personal draft needs expectedPersonalVersion");
          }
          const saved = await this.writePersonal(
            tx,
            userId,
            values,
            input.expectedPersonalVersion,
            "imported",
            draft.importId,
          );
          reference = referenceFor("personal", null, saved.version);
        } else {
          const created = await this.insertEntry(
            tx,
            userId,
            draft.section,
            values,
            "imported",
            draft.importId,
          );
          reference = referenceFor(draft.section, created.id, created.version);
        }
        await tx`DELETE FROM profile.import_drafts WHERE id = ${draftId} AND user_id = ${userId}`;
        return {
          response: reference,
          audit: {
            action: "profile.draft.saved",
            resourceId: draftId,
            metadata: { section: draft.section },
          },
        };
      },
    );
  }

  private async idempotent<T>(
    userId: string,
    scope: string,
    idempotencyKey: string,
    request: unknown,
    traceId: string,
    run: (tx: Tx) => Promise<{
      response: T;
      audit: { action: string; resourceId: string | null; metadata: Json } | null;
    }>,
  ): Promise<T> {
    const hash = requestHash(request);
    return this.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${idempotencyKey}`}))`;
      const prior = await tx<Array<{ requestHash: string; response: T }>>`
        SELECT request_hash AS "requestHash", response
        FROM platform.idempotency_keys
        WHERE user_id = ${userId} AND scope = ${scope} AND key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].requestHash !== hash) throw new ProfileSectionIdempotencyConflictError();
        return prior[0].response;
      }
      await tx`SELECT identity.require_active_candidate(${userId}::uuid)`;
      const { response, audit } = await run(tx);
      await tx`
        INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
        VALUES (${userId}, ${scope}, ${idempotencyKey}, ${hash}, ${JSON.stringify(response)}::text::jsonb)
      `;
      if (audit) {
        await tx`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata
          ) VALUES (
            ${uuidv7()}, ${userId}, ${audit.action}, 'profile_section', ${audit.resourceId},
            ${traceId}, ${JSON.stringify(audit.metadata)}::text::jsonb
          )
        `;
      }
      return response;
    }) as Promise<T>;
  }

  private async lockEntry(
    tx: Tx,
    userId: string,
    section: ProfileEntrySection,
    entryId: string,
  ): Promise<EntryRow> {
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM profile.entries
      WHERE id = ${entryId} AND user_id = ${userId} AND section = ${section}
      FOR UPDATE
    `;
    if (!owned[0]) throw new ProfileSectionNotFoundError();
    const rows = await tx.unsafe<EntryRow[]>(
      `SELECT ${ENTRY_SELECT}
       FROM profile.entries AS e
       JOIN LATERAL (
         SELECT * FROM profile.entry_versions WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
       ) AS v ON true
       WHERE e.id = $1 AND e.user_id = $2`,
      [entryId, userId],
    );
    if (!rows[0]) throw new ProfileSectionNotFoundError();
    return rows[0];
  }

  private async writePersonal(
    tx: Tx,
    userId: string,
    content: Json,
    expectedVersion: number,
    origin: "entered" | "imported",
    importId: string | null,
  ): Promise<ProfilePersonal> {
    const validate = compileComponentValidator("PutProfilePersonalRequest");
    if (!validate({ expectedVersion, ...content })) {
      throw new ProfileSectionInputError("personal fields are invalid");
    }
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`profile-personal:${userId}`}))`;
    const latest = await tx<
      { version: number; origin: "entered" | "imported"; importId: string | null }[]
    >`
      SELECT version, origin, import_id AS "importId"
      FROM profile.personal_versions
      WHERE user_id = ${userId}
      ORDER BY version DESC
      LIMIT 1
    `;
    const currentVersion = latest[0]?.version ?? 0;
    if (currentVersion !== expectedVersion) throw new ProfileSectionVersionConflictError();
    const version = currentVersion + 1;
    const savedAt = new Date().toISOString();
    // Provenance is that of the first save; later edits keep it.
    const keptOrigin = latest[0]?.origin ?? origin;
    const keptImportId = latest[0] ? latest[0].importId : importId;
    await tx`
      INSERT INTO profile.personal_versions (user_id, version, content, origin, import_id, created_at)
      VALUES (
        ${userId}, ${version}, ${JSON.stringify(content)}::text::jsonb, ${keptOrigin}, ${keptImportId},
        ${savedAt}::timestamptz
      )
    `;
    const first = await tx<{ createdAt: Date | string }[]>`
      SELECT created_at AS "createdAt" FROM profile.personal_versions
      WHERE user_id = ${userId} AND version = 1
    `;
    return mapPersonal({
      version,
      content,
      origin: keptOrigin,
      importId: keptImportId,
      createdAt: first[0]?.createdAt ?? savedAt,
      updatedAt: savedAt,
    });
  }

  private async insertEntry(
    tx: Tx,
    userId: string,
    section: ProfileEntrySection,
    content: Json,
    origin: "entered" | "imported",
    importId: string | null,
  ): Promise<ProfileEntryRecord> {
    checkContent(section, content);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`profile-section:${userId}:${section}`}))`;
    const [counted] = await tx<{ count: number; next: number }[]>`
      SELECT count(*)::int AS count, COALESCE(max(display_order) + 1, 0)::int AS next
      FROM profile.entries
      WHERE user_id = ${userId} AND section = ${section}
    `;
    const count = counted?.count ?? 0;
    const next = counted?.next ?? 0;
    if (count >= PROFILE_SECTION_LIMITS[section]) throw new ProfileSectionLimitError(section);
    const id = uuidv7();
    const key = naturalKey(section, content);
    const createdAt = new Date().toISOString();
    try {
      await tx`
        INSERT INTO profile.entries (id, user_id, section, display_order, natural_key, created_at)
        VALUES (
          ${id}, ${userId}, ${section}, ${Math.min(next, 999)}, ${key}, ${createdAt}::timestamptz
        )
      `;
      await tx`
        INSERT INTO profile.entry_versions (entry_id, version, content, origin, import_id, created_at)
        VALUES (
          ${id}, 1, ${JSON.stringify(content)}::text::jsonb, ${origin}, ${importId}, ${createdAt}::timestamptz
        )
      `;
    } catch (error) {
      throw translateUniqueViolation(error);
    }
    return mapEntry({
      id,
      section,
      displayOrder: Math.min(next, 999),
      naturalKey: key,
      createdAt,
      version: 1,
      content,
      origin,
      importId,
      updatedAt: createdAt,
    });
  }
}

function translateUniqueViolation(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code;
  const constraint = (error as { constraint_name?: string } | null)?.constraint_name;
  if (code === "23505" && constraint === "profile_entries_natural_key_idx") {
    return new ProfileSectionDuplicateError();
  }
  return error;
}

export function createProfileSectionStore(client: postgres.Sql): ProfileSectionStore {
  return new PostgresProfileSectionStore(client);
}
