import { createHash } from "node:crypto";
import type {
  CanonicalJobSummary,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  SavedJobSnapshot,
} from "@ai-job-apply/api-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  decodeSavedJobCursor,
  encodeSavedJobCursor,
  SavedJobCollectionChangedError,
  type SavedJobCursorKeySet,
} from "./saved-job-cursor.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_SAVED_JOBS_PER_OWNER = 1_000;
export const MAX_SAVED_JOB_IDEMPOTENCY_KEYS_PER_OWNER = 2_000;
export const SAVED_JOB_IDEMPOTENCY_RETENTION_HOURS = 24;

export interface SavedJobRecord {
  id: string;
  ownerUserId: string;
  requestedJobId: string;
  resolvedCanonicalJobIdAtSave: string;
  snapshot: SavedJobSnapshot;
  savedAt: Date;
}

export interface SavedJobRecordPage {
  revision: string;
  records: SavedJobRecord[];
  hasMore: boolean;
}

export interface SavedJobStore {
  findCreateReplay(
    ownerUserId: string,
    requestedJobId: string,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<SavedJobRecord | null>;
  create(
    ownerUserId: string,
    requestedJobId: string,
    resolvedJob: CanonicalJobSummary,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<SavedJobRecord>;
  getOwnerRevision(ownerUserId: string): Promise<string>;
  readOwnerPage(
    ownerUserId: string,
    after: { savedAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<SavedJobRecordPage>;
  delete(ownerUserId: string, savedJobId: string, occurredAt: Date): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface SavedJobCatalogResolver {
  getActiveJobSummary(jobId: string, activeAt: Date): Promise<CanonicalJobSummary | null>;
  getCatalogRevision(): Promise<string>;
  resolveActiveJobSummaries(
    jobIds: readonly string[],
    activeAt: Date,
  ): Promise<{
    catalogRevision: string;
    items: Array<{ requestedJobId: string; job: CanonicalJobSummary }>;
  }>;
}

export class SavedJobIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different saved-job request");
    this.name = "SavedJobIdempotencyConflictError";
  }
}

export class SavedJobTargetUnavailableError extends Error {
  constructor() {
    super("The requested job is not available to save");
    this.name = "SavedJobTargetUnavailableError";
  }
}

export class SavedJobLimitError extends Error {
  constructor(maximum = MAX_SAVED_JOBS_PER_OWNER) {
    super(`A candidate can retain at most ${maximum} saved jobs`);
    this.name = "SavedJobLimitError";
  }
}

export class SavedJobIdempotencyLimitError extends Error {
  constructor(maximum = MAX_SAVED_JOB_IDEMPOTENCY_KEYS_PER_OWNER) {
    super(
      `A candidate can retain at most ${maximum} saved-job commands inside the idempotency replay window`,
    );
    this.name = "SavedJobIdempotencyLimitError";
  }
}

function requestHash(requestedJobId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ jobId: requestedJobId }))
    .digest("hex");
}

function snapshot(job: CanonicalJobSummary): SavedJobSnapshot {
  const department = job.department?.trim();
  return {
    jobIdAtSave: job.id,
    company: {
      id: job.company.id,
      name: job.company.name.trim(),
      ...(job.company.verifiedDomain ? { verifiedDomain: job.company.verifiedDomain.trim() } : {}),
    },
    title: job.title.trim(),
    locations: job.locations.map((location) => location.trim()),
    ...(department ? { department } : {}),
    firstObservedAt: job.firstObservedAt,
    lastVerifiedAt: job.lastVerifiedAt,
    expiresAt: job.expiresAt,
  };
}

function publicSavedJob(record: SavedJobRecord, currentJob: CanonicalJobSummary | null): SavedJob {
  return {
    id: record.id,
    requestedJobId: record.requestedJobId,
    snapshot: record.snapshot,
    availability: currentJob ? { state: "available", currentJob } : { state: "unavailable" },
    savedAt: record.savedAt.toISOString(),
  };
}

function originalAvailableJob(record: SavedJobRecord): CanonicalJobSummary {
  return {
    id: record.snapshot.jobIdAtSave,
    company: record.snapshot.company,
    title: record.snapshot.title,
    locations: record.snapshot.locations,
    ...(record.snapshot.department ? { department: record.snapshot.department } : {}),
    status: "active",
    firstObservedAt: record.snapshot.firstObservedAt,
    lastVerifiedAt: record.snapshot.lastVerifiedAt,
    expiresAt: record.snapshot.expiresAt,
  };
}

export interface SavedJobs {
  create(ownerUserId: string, requestedJobId: string, idempotencyKey: string): Promise<SavedJob>;
  list(ownerUserId: string, input: SavedJobSearchRequest): Promise<SavedJobPage>;
  delete(ownerUserId: string, savedJobId: string): Promise<void>;
  ping(): Promise<void>;
}

export class SavedJobsService implements SavedJobs {
  constructor(
    private readonly store: SavedJobStore,
    private readonly catalog: SavedJobCatalogResolver,
    private readonly cursorKeys: SavedJobCursorKeySet,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private timestamp(): Date {
    const value = this.clock();
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) throw new Error("Saved-job clock is invalid");
    return new Date(milliseconds);
  }

  async create(
    ownerUserId: string,
    requestedJobId: string,
    idempotencyKey: string,
  ): Promise<SavedJob> {
    const occurredAt = this.timestamp();
    const replay = await this.store.findCreateReplay(
      ownerUserId,
      requestedJobId,
      idempotencyKey,
      new Date(occurredAt.getTime()),
    );
    if (replay) {
      return publicSavedJob(replay, originalAvailableJob(replay));
    }
    const current = await this.catalog.getActiveJobSummary(
      requestedJobId,
      new Date(occurredAt.getTime()),
    );
    if (!current) throw new SavedJobTargetUnavailableError();
    const record = await this.store.create(
      ownerUserId,
      requestedJobId,
      current,
      idempotencyKey,
      new Date(occurredAt.getTime()),
    );
    return publicSavedJob(record, originalAvailableJob(record));
  }

  async list(ownerUserId: string, input: SavedJobSearchRequest): Promise<SavedJobPage> {
    const pageSize = input.pageSize ?? 20;
    const activeAt = this.timestamp();
    const catalogRevision = await this.catalog.getCatalogRevision();
    const ownerRevision = await this.store.getOwnerRevision(ownerUserId);
    const cursor = decodeSavedJobCursor(
      input.cursor,
      ownerUserId,
      ownerRevision,
      catalogRevision,
      this.cursorKeys,
    );
    const page = await this.store.readOwnerPage(ownerUserId, cursor, pageSize);
    if (page.revision !== ownerRevision) throw new SavedJobCollectionChangedError();
    const resolved = page.records.length
      ? await this.catalog.resolveActiveJobSummaries(
          page.records.map((item) => item.requestedJobId),
          new Date(activeAt.getTime()),
        )
      : { catalogRevision, items: [] };
    if (resolved.catalogRevision !== catalogRevision) {
      throw new SavedJobCollectionChangedError();
    }
    const currentByRequested = new Map(
      resolved.items.map((item) => [item.requestedJobId, item.job]),
    );
    const items = page.records.map((saved) =>
      publicSavedJob(saved, currentByRequested.get(saved.requestedJobId) ?? null),
    );
    const last = page.records.at(-1);
    return {
      items,
      ...(last && page.hasMore
        ? {
            nextCursor: encodeSavedJobCursor(
              ownerUserId,
              ownerRevision,
              catalogRevision,
              last.savedAt,
              last.id,
              this.cursorKeys,
            ),
          }
        : {}),
    };
  }

  async delete(ownerUserId: string, savedJobId: string): Promise<void> {
    await this.store.delete(ownerUserId, savedJobId, this.timestamp());
  }

  ping(): Promise<void> {
    return this.store.ping();
  }
}

interface SavedJobRow {
  id: string;
  ownerUserId: string;
  requestedJobId: string;
  resolvedCanonicalJobIdAtSave: string;
  snapshotCompanyId: string;
  snapshotCompanyName: string;
  snapshotVerifiedDomain: string | null;
  snapshotTitle: string;
  snapshotLocations: string[];
  snapshotDepartment: string | null;
  snapshotFirstObservedAt: Date;
  snapshotLastVerifiedAt: Date;
  snapshotExpiresAt: Date;
  savedAt: Date;
}

interface SavedJobReplayRow extends SavedJobRow {
  requestHash: string;
}

function record(row: SavedJobRow): SavedJobRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    requestedJobId: row.requestedJobId,
    resolvedCanonicalJobIdAtSave: row.resolvedCanonicalJobIdAtSave,
    snapshot: {
      jobIdAtSave: row.resolvedCanonicalJobIdAtSave,
      company: {
        id: row.snapshotCompanyId,
        name: row.snapshotCompanyName,
        ...(row.snapshotVerifiedDomain ? { verifiedDomain: row.snapshotVerifiedDomain } : {}),
      },
      title: row.snapshotTitle,
      locations: row.snapshotLocations,
      ...(row.snapshotDepartment ? { department: row.snapshotDepartment } : {}),
      firstObservedAt: new Date(row.snapshotFirstObservedAt).toISOString(),
      lastVerifiedAt: new Date(row.snapshotLastVerifiedAt).toISOString(),
      expiresAt: new Date(row.snapshotExpiresAt).toISOString(),
    },
    savedAt: new Date(row.savedAt),
  };
}

function assertIdentifiers(ownerUserId: string, identifier: string): void {
  if (!UUID_PATTERN.test(ownerUserId) || !UUID_PATTERN.test(identifier)) {
    throw new Error("Saved-job identifiers must be UUIDs");
  }
}

export class PostgresSavedJobStore implements SavedJobStore {
  private readonly maximumSavedJobs: number;
  private readonly maximumIdempotencyKeys: number;

  constructor(
    private readonly client: postgres.Sql,
    limits: {
      maximumSavedJobs?: number;
      maximumIdempotencyKeys?: number;
    } = {},
  ) {
    this.maximumSavedJobs = limits.maximumSavedJobs ?? MAX_SAVED_JOBS_PER_OWNER;
    this.maximumIdempotencyKeys =
      limits.maximumIdempotencyKeys ?? MAX_SAVED_JOB_IDEMPOTENCY_KEYS_PER_OWNER;
    if (
      !Number.isInteger(this.maximumSavedJobs) ||
      this.maximumSavedJobs < 1 ||
      this.maximumSavedJobs > MAX_SAVED_JOBS_PER_OWNER ||
      !Number.isInteger(this.maximumIdempotencyKeys) ||
      this.maximumIdempotencyKeys < 1 ||
      this.maximumIdempotencyKeys > MAX_SAVED_JOB_IDEMPOTENCY_KEYS_PER_OWNER
    ) {
      throw new Error("Saved-job persistence limits are invalid");
    }
  }

  async findCreateReplay(
    ownerUserId: string,
    requestedJobId: string,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<SavedJobRecord | null> {
    assertIdentifiers(ownerUserId, requestedJobId);
    const occurredAtMilliseconds = occurredAt.getTime();
    if (!Number.isFinite(occurredAtMilliseconds)) throw new Error("Saved-job clock is invalid");
    const [row] = await this.client<SavedJobReplayRow[]>`
      SELECT request_hash AS "requestHash", saved_job_id AS id,
        owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
        resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
        snapshot_company_id AS "snapshotCompanyId",
        snapshot_company_name AS "snapshotCompanyName",
        snapshot_verified_domain AS "snapshotVerifiedDomain",
        snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
        snapshot_department AS "snapshotDepartment",
        snapshot_first_observed_at AS "snapshotFirstObservedAt",
        snapshot_last_verified_at AS "snapshotLastVerifiedAt",
        snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
      FROM matching.idempotency_keys
      WHERE owner_user_id = ${ownerUserId} AND idempotency_key = ${idempotencyKey}
        AND idempotency_expires_at > ${new Date(occurredAtMilliseconds)}
    `;
    if (!row) return null;
    if (row.requestHash !== requestHash(requestedJobId)) {
      throw new SavedJobIdempotencyConflictError();
    }
    return record(row);
  }

  async create(
    ownerUserId: string,
    requestedJobId: string,
    resolvedJob: CanonicalJobSummary,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<SavedJobRecord> {
    assertIdentifiers(ownerUserId, requestedJobId);
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new Error("Saved-job idempotency key is invalid");
    }
    const occurredAtMilliseconds = occurredAt.getTime();
    if (!Number.isFinite(occurredAtMilliseconds)) throw new Error("Saved-job clock is invalid");
    const timestamp = new Date(occurredAtMilliseconds);
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`matching:saved:${ownerUserId}`}))`;
      const [replay] = await transaction<SavedJobReplayRow[]>`
        SELECT request_hash AS "requestHash", saved_job_id AS id,
          owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
          resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
          snapshot_company_id AS "snapshotCompanyId",
          snapshot_company_name AS "snapshotCompanyName",
          snapshot_verified_domain AS "snapshotVerifiedDomain",
          snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
          snapshot_department AS "snapshotDepartment",
          snapshot_first_observed_at AS "snapshotFirstObservedAt",
          snapshot_last_verified_at AS "snapshotLastVerifiedAt",
          snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
        FROM matching.idempotency_keys
        WHERE owner_user_id = ${ownerUserId} AND idempotency_key = ${idempotencyKey}
          AND idempotency_expires_at > ${timestamp}
      `;
      if (replay) {
        if (replay.requestHash !== requestHash(requestedJobId)) {
          throw new SavedJobIdempotencyConflictError();
        }
        return record(replay);
      }
      await transaction`
        DELETE FROM matching.idempotency_keys
        WHERE owner_user_id = ${ownerUserId} AND idempotency_expires_at <= ${timestamp}
      `;
      const [idempotencyUsage] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM matching.idempotency_keys
        WHERE owner_user_id = ${ownerUserId}
      `;
      if (Number(idempotencyUsage?.count ?? 0) >= this.maximumIdempotencyKeys) {
        throw new SavedJobIdempotencyLimitError(this.maximumIdempotencyKeys);
      }
      const [existing] = await transaction<SavedJobRow[]>`
        SELECT id, owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
          resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
          snapshot_company_id AS "snapshotCompanyId",
          snapshot_company_name AS "snapshotCompanyName",
          snapshot_verified_domain AS "snapshotVerifiedDomain",
          snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
          snapshot_department AS "snapshotDepartment",
          snapshot_first_observed_at AS "snapshotFirstObservedAt",
          snapshot_last_verified_at AS "snapshotLastVerifiedAt",
          snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
        FROM matching.saved_jobs
        WHERE owner_user_id = ${ownerUserId} AND requested_job_id = ${requestedJobId}
      `;
      let created = existing ? record(existing) : undefined;
      if (!created) {
        const [savedJobUsage] = await transaction<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM matching.saved_jobs
          WHERE owner_user_id = ${ownerUserId}
        `;
        if (Number(savedJobUsage?.count ?? 0) >= this.maximumSavedJobs) {
          throw new SavedJobLimitError(this.maximumSavedJobs);
        }
        const id = uuidv7();
        const boundedSnapshot = snapshot(resolvedJob);
        const [inserted] = await transaction<SavedJobRow[]>`
          INSERT INTO matching.saved_jobs (
            id, owner_user_id, requested_job_id, resolved_canonical_job_id_at_save,
            snapshot_company_id, snapshot_company_name, snapshot_verified_domain,
            snapshot_title, snapshot_locations, snapshot_department,
            snapshot_first_observed_at, snapshot_last_verified_at, snapshot_expires_at,
            saved_at, updated_at
          ) VALUES (
            ${id}, ${ownerUserId}, ${requestedJobId}, ${resolvedJob.id},
            ${boundedSnapshot.company.id}, ${boundedSnapshot.company.name},
            ${boundedSnapshot.company.verifiedDomain ?? null}, ${boundedSnapshot.title},
            ${transaction.array(boundedSnapshot.locations)}, ${boundedSnapshot.department ?? null},
            ${boundedSnapshot.firstObservedAt}, ${boundedSnapshot.lastVerifiedAt},
            ${boundedSnapshot.expiresAt}, ${timestamp}, ${timestamp}
          )
          RETURNING id, owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
            resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
            snapshot_company_id AS "snapshotCompanyId",
            snapshot_company_name AS "snapshotCompanyName",
            snapshot_verified_domain AS "snapshotVerifiedDomain",
            snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
            snapshot_department AS "snapshotDepartment",
            snapshot_first_observed_at AS "snapshotFirstObservedAt",
            snapshot_last_verified_at AS "snapshotLastVerifiedAt",
            snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
        `;
        if (!inserted) throw new Error("Saved job insert returned no row");
        created = record(inserted);
        await transaction`
          INSERT INTO matching.saved_job_list_state (owner_user_id, revision)
          VALUES (${ownerUserId}, 2)
          ON CONFLICT (owner_user_id) DO UPDATE
          SET revision = matching.saved_job_list_state.revision + 1
        `;
        await transaction`
          INSERT INTO matching.audit_events (
            id, owner_user_id, saved_job_id, requested_job_id,
            resolved_canonical_job_id_at_save, action, occurred_at
          ) VALUES (
            ${uuidv7()}, ${ownerUserId}, ${created.id}, ${requestedJobId},
            ${resolvedJob.id}, 'saved', ${timestamp}
          )
        `;
      }
      await transaction`
        INSERT INTO matching.idempotency_keys (
          owner_user_id, idempotency_key, request_hash, saved_job_id, requested_job_id,
          resolved_canonical_job_id_at_save, snapshot_company_id, snapshot_company_name,
          snapshot_verified_domain, snapshot_title, snapshot_locations, snapshot_department,
          snapshot_first_observed_at, snapshot_last_verified_at, snapshot_expires_at,
          saved_at, created_at, idempotency_expires_at
        ) VALUES (
          ${ownerUserId}, ${idempotencyKey}, ${requestHash(requestedJobId)}, ${created.id},
          ${created.requestedJobId}, ${created.resolvedCanonicalJobIdAtSave},
          ${created.snapshot.company.id}, ${created.snapshot.company.name},
          ${created.snapshot.company.verifiedDomain ?? null}, ${created.snapshot.title},
          ${transaction.array(created.snapshot.locations)}, ${created.snapshot.department ?? null},
          ${created.snapshot.firstObservedAt}, ${created.snapshot.lastVerifiedAt},
          ${created.snapshot.expiresAt}, ${created.savedAt}, ${timestamp},
          ${new Date(timestamp.getTime() + SAVED_JOB_IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1_000)}
        )
      `;
      return created;
    });
  }

  async getOwnerRevision(ownerUserId: string): Promise<string> {
    assertIdentifiers(ownerUserId, ownerUserId);
    const [state] = await this.client<{ revision: string }[]>`
      SELECT revision::text AS revision
      FROM matching.saved_job_list_state
      WHERE owner_user_id = ${ownerUserId}
    `;
    return state?.revision ?? "1";
  }

  async readOwnerPage(
    ownerUserId: string,
    after: { savedAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<SavedJobRecordPage> {
    assertIdentifiers(ownerUserId, ownerUserId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Saved-job page scan limit is invalid");
    }
    if (after) assertIdentifiers(ownerUserId, after.id);
    return this.client.begin("read only isolation level repeatable read", async (transaction) => {
      const [state] = await transaction<{ revision: string }[]>`
        SELECT revision::text AS revision
        FROM matching.saved_job_list_state
        WHERE owner_user_id = ${ownerUserId}
      `;
      const records = await transaction<SavedJobRow[]>`
        SELECT id, owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
          resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
          snapshot_company_id AS "snapshotCompanyId",
          snapshot_company_name AS "snapshotCompanyName",
          snapshot_verified_domain AS "snapshotVerifiedDomain",
          snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
          snapshot_department AS "snapshotDepartment",
          snapshot_first_observed_at AS "snapshotFirstObservedAt",
          snapshot_last_verified_at AS "snapshotLastVerifiedAt",
          snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
        FROM matching.saved_jobs
        WHERE owner_user_id = ${ownerUserId}
          AND (
            ${after?.savedAt.toISOString() ?? null}::timestamptz IS NULL
            OR saved_at < ${after?.savedAt.toISOString() ?? null}::timestamptz
            OR (
              saved_at = ${after?.savedAt.toISOString() ?? null}::timestamptz
              AND id < ${after?.id ?? null}::uuid
            )
          )
        ORDER BY saved_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
      return {
        revision: state?.revision ?? "1",
        records: records.slice(0, limit).map(record),
        hasMore: records.length > limit,
      };
    });
  }

  async delete(ownerUserId: string, savedJobId: string, occurredAt: Date): Promise<void> {
    assertIdentifiers(ownerUserId, savedJobId);
    const occurredAtMilliseconds = occurredAt.getTime();
    if (!Number.isFinite(occurredAtMilliseconds)) throw new Error("Saved-job clock is invalid");
    const timestamp = new Date(occurredAtMilliseconds);
    await this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`matching:saved:${ownerUserId}`}))`;
      const [deleted] = await transaction<SavedJobRow[]>`
        DELETE FROM matching.saved_jobs
        WHERE owner_user_id = ${ownerUserId} AND id = ${savedJobId}
        RETURNING id, owner_user_id AS "ownerUserId", requested_job_id AS "requestedJobId",
          resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
          snapshot_company_id AS "snapshotCompanyId",
          snapshot_company_name AS "snapshotCompanyName",
          snapshot_verified_domain AS "snapshotVerifiedDomain",
          snapshot_title AS "snapshotTitle", snapshot_locations AS "snapshotLocations",
          snapshot_department AS "snapshotDepartment",
          snapshot_first_observed_at AS "snapshotFirstObservedAt",
          snapshot_last_verified_at AS "snapshotLastVerifiedAt",
          snapshot_expires_at AS "snapshotExpiresAt", saved_at AS "savedAt"
      `;
      if (!deleted) return;
      await transaction`
        INSERT INTO matching.saved_job_list_state (owner_user_id, revision)
        VALUES (${ownerUserId}, 2)
        ON CONFLICT (owner_user_id) DO UPDATE
        SET revision = matching.saved_job_list_state.revision + 1
      `;
      await transaction`
        INSERT INTO matching.audit_events (
          id, owner_user_id, saved_job_id, requested_job_id,
          resolved_canonical_job_id_at_save, action, occurred_at
        ) VALUES (
          ${uuidv7()}, ${ownerUserId}, ${deleted.id}, ${deleted.requestedJobId},
          ${deleted.resolvedCanonicalJobIdAtSave}, 'unsaved', ${timestamp}
        )
      `;
    });
  }

  async ping(): Promise<void> {
    const [result] = await this.client<{ present: boolean }[]>`
      SELECT to_regclass('matching.saved_jobs') IS NOT NULL AS present
    `;
    if (!result?.present) throw new Error("Matching saved-job schema is unavailable");
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
