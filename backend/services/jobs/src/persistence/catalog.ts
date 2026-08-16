import { createHmac, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type CanonicalObservation,
  canonicalizeObservation,
  type DuplicateResolution,
  defaultFreshnessDays,
  evaluateLifecycle,
  exactIdentityKeys,
  type JobObservation,
  type JobProvenance,
  type JobStatus,
  normalizeText,
  suspectStaleFailureThreshold,
} from "../domain/canonical-job.js";

export interface CatalogObservation extends JobObservation {
  rawSnapshot?: postgres.JSONValue;
}

export interface CatalogJobRecord {
  id: string;
  companyId: string;
  title: string;
  locations: string[];
  description?: string;
  status: JobStatus;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

export interface ActiveJobSourceRecord {
  provider: JobObservation["provider"];
  provenance: JobProvenance;
  canonicalUrl: string;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  validThrough?: Date;
}

export interface ActiveJobRecord {
  id: string;
  company: {
    id: string;
    name: string;
    verifiedDomain?: string;
  };
  title: string;
  locations: string[];
  department?: string;
  description: string;
  status: "active";
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  validThrough?: Date;
  sources: ActiveJobSourceRecord[];
}

export type JobSearchSort = "relevance" | "freshness";

export interface ActiveJobSearchFilters {
  title?: string;
  company?: string;
  location?: string;
  verifiedWithinDays?: number;
}

export interface ActiveJobSearchInput {
  query?: string;
  filters?: ActiveJobSearchFilters;
  sort?: JobSearchSort;
  pageSize?: number;
  cursor?: string;
}

export interface ActiveJobSummaryRecord {
  id: string;
  company: ActiveJobRecord["company"];
  title: string;
  locations: string[];
  department?: string;
  status: "active";
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

export interface ActiveJobSearchPage {
  items: ActiveJobSummaryRecord[];
  nextCursor?: string;
}

export interface ActiveJobSummaryResolutionPage {
  catalogRevision: string;
  items: Array<{ requestedJobId: string; job: ActiveJobSummaryRecord }>;
}

export interface JobCatalogReader {
  ping(): Promise<void>;
  getCatalogRevision(): Promise<string>;
  resolveActiveJobSummaries(
    jobIds: readonly string[],
    now?: Date,
  ): Promise<ActiveJobSummaryResolutionPage>;
  getActiveJob(jobId: string, now?: Date): Promise<ActiveJobRecord | null>;
  searchActiveJobs(input: ActiveJobSearchInput, now?: Date): Promise<ActiveJobSearchPage>;
}

export interface RecordObservationResult {
  outcome: "created" | "exact_match_updated";
  job: CatalogJobRecord;
  probableDuplicateJobIds: string[];
}

export interface DuplicateCandidateRecord {
  jobId: string;
  candidateJobId: string;
  classification: "probable";
  resolution?: DuplicateResolution;
  canonicalJobId?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewReasonCode?: string;
  resolutionVersion: number;
}

export interface ReviewDuplicateCandidateInput {
  jobId: string;
  candidateJobId: string;
  resolution: DuplicateResolution;
  canonicalJobId?: string;
  reviewedBy: string;
  reasonCode: string;
  reviewedAt: Date;
}

export interface ReopenDuplicateCandidateInput {
  jobId: string;
  candidateJobId: string;
  reviewedBy: string;
  reasonCode: string;
  reviewedAt: Date;
}

export interface JobCatalogOptions {
  acceptedProvenance?: ReadonlySet<JobProvenance>;
  searchCursorKeys: JobSearchCursorKeyring;
}

export interface JobCatalogDatabaseOptions {
  maxConnections?: number;
}

export interface JobSearchCursorKey {
  id: string;
  key: Uint8Array;
}

export interface JobSearchCursorKeyring {
  active: JobSearchCursorKey;
  verification?: readonly JobSearchCursorKey[];
}

interface ExactMatchRow {
  jobId: string;
  sourceId: string;
}

interface ExistingJobRow {
  id: string;
  companyId: string;
  status: JobStatus;
  firstObservedAt: Date;
  expiresAt: Date;
  consecutiveVerificationFailures: number;
}

interface CatalogJobRow {
  id: string;
  companyId: string;
  title: string;
  locations: string[];
  description: string | null;
  status: JobStatus;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

interface ActiveJobRow {
  id: string;
  companyId: string;
  companyName: string;
  companyVerifiedDomain: string | null;
  title: string;
  locations: string[];
  department: string | null;
  description: string;
  status: "active";
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  validThrough: Date | null;
  sources: Array<{
    provider: JobObservation["provider"];
    provenance: JobProvenance;
    canonicalUrl: string;
    firstObservedAt: string;
    lastVerifiedAt: string;
    validThrough: string | null;
  }>;
}

interface ActiveJobSearchRow {
  id: string;
  companyId: string;
  companyName: string;
  companyVerifiedDomain: string | null;
  title: string;
  locations: string[];
  department: string | null;
  firstObservedAt: Date | string;
  lastVerifiedAt: Date | string;
  expiresAt: Date | string;
  rankKey: string;
}

interface NormalizedJobSearchInput {
  query: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  verifiedWithinDays: number | null;
  sort: JobSearchSort;
  pageSize: number;
  cursor?: string;
}

interface JobSearchCursor {
  version: 1;
  keyId: string;
  revision: string;
  sort: JobSearchSort;
  asOf: string;
  lastVerifiedAt: string;
  id: string;
  rankKey?: string;
}

const JOB_SEARCH_CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const JOB_SEARCH_CURSOR_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const JOB_SEARCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_SEARCH_RANK_PATTERN = /^\d+\.\d{6}$/;
const JOB_SEARCH_CURSOR_MAXIMUM_AGE_MILLISECONDS = 15 * 60 * 1_000;

function normalizeJobSearchTimestamp(value: unknown, field: string): Date {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new TypeError(`The job-search ${field} timestamp is invalid`);
  }
  const normalized = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    throw new TypeError(`The job-search ${field} timestamp is invalid`);
  }
  return normalized;
}

export class InvalidJobSearchError extends Error {
  constructor(message = "The job search request is invalid") {
    super(message);
    this.name = "InvalidJobSearchError";
  }
}

export class JobSearchCatalogChangedError extends Error {
  constructor() {
    super("The job catalog changed; restart the search from the first page");
    this.name = "JobSearchCatalogChangedError";
  }
}

function normalizeOptionalSearchText(
  value: string | undefined,
  maximumLength: number,
  label: string,
): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length > maximumLength || !/\S/u.test(value)) {
    throw new InvalidJobSearchError(`${label} is invalid`);
  }
  return normalizeText(value);
}

function normalizeJobSearchInput(input: ActiveJobSearchInput): NormalizedJobSearchInput {
  const sort = input.sort ?? "relevance";
  if (sort !== "relevance" && sort !== "freshness") {
    throw new InvalidJobSearchError("Search sort is invalid");
  }
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25) {
    throw new InvalidJobSearchError("Search page size is invalid");
  }
  const verifiedWithinDays = input.filters?.verifiedWithinDays ?? null;
  if (
    verifiedWithinDays !== null &&
    (!Number.isInteger(verifiedWithinDays) || verifiedWithinDays < 1 || verifiedWithinDays > 365)
  ) {
    throw new InvalidJobSearchError("Search freshness is invalid");
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== "string" ||
      input.cursor.length > 1024 ||
      !JOB_SEARCH_CURSOR_PATTERN.test(input.cursor))
  ) {
    throw new InvalidJobSearchError("Search cursor is invalid");
  }
  return {
    query: normalizeOptionalSearchText(input.query, 200, "Search query"),
    title: normalizeOptionalSearchText(input.filters?.title, 240, "Title filter"),
    company: normalizeOptionalSearchText(input.filters?.company, 200, "Company filter"),
    location: normalizeOptionalSearchText(input.filters?.location, 240, "Location filter"),
    verifiedWithinDays,
    sort,
    pageSize,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
}

function canonicalJobSearchRequest(input: NormalizedJobSearchInput): string {
  return JSON.stringify({
    query: input.query,
    title: input.title,
    company: input.company,
    location: input.location,
    verifiedWithinDays: input.verifiedWithinDays,
    sort: input.sort,
    pageSize: input.pageSize,
  });
}

function validateCursorKey(key: JobSearchCursorKey): void {
  if (!JOB_SEARCH_CURSOR_KEY_ID_PATTERN.test(key.id) || key.key.byteLength !== 32) {
    throw new Error("A versioned 32-byte job-search cursor key is required");
  }
}

function cursorSignature(key: Uint8Array, body: string, request: string): Buffer {
  return createHmac("sha256", key)
    .update("job-search-cursor:v1\0", "utf8")
    .update(body, "utf8")
    .update("\0", "utf8")
    .update(request, "utf8")
    .digest();
}

function encodeJobSearchCursor(
  cursor: JobSearchCursor,
  request: string,
  key: JobSearchCursorKey,
): string {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${body}.${cursorSignature(key.key, body, request).toString("base64url")}`;
}

function decodeJobSearchCursor(
  value: string | undefined,
  request: string,
  sort: JobSearchSort,
  now: Date,
  keys: ReadonlyMap<string, Uint8Array>,
): JobSearchCursor | null {
  if (!value) {
    return null;
  }
  let decoded: string;
  let candidate: unknown;
  try {
    const segments = value.split(".");
    if (segments.length !== 2) {
      throw new Error("invalid cursor segments");
    }
    const [body, signatureText] = segments as [string, string];
    decoded = Buffer.from(body, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== body) {
      throw new Error("non-canonical cursor");
    }
    candidate = JSON.parse(decoded);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("invalid cursor payload");
    }
    const keyId = (candidate as { keyId?: unknown }).keyId;
    const key = typeof keyId === "string" ? keys.get(keyId) : undefined;
    const actual = Buffer.from(signatureText, "base64url");
    if (
      !key ||
      actual.toString("base64url") !== signatureText ||
      actual.byteLength !== 32 ||
      !timingSafeEqual(actual, cursorSignature(key, body, request))
    ) {
      throw new Error("invalid cursor signature");
    }
  } catch {
    throw new InvalidJobSearchError("Search cursor is invalid");
  }
  const cursor = candidate as Partial<JobSearchCursor>;
  if (cursor.version !== 1) {
    throw new InvalidJobSearchError("Search cursor version is unsupported");
  }
  const expectedKeys =
    sort === "relevance"
      ? ["asOf", "id", "keyId", "lastVerifiedAt", "rankKey", "revision", "sort", "version"]
      : ["asOf", "id", "keyId", "lastVerifiedAt", "revision", "sort", "version"];
  const asOf = typeof cursor.asOf === "string" ? new Date(cursor.asOf) : undefined;
  if (
    Object.keys(cursor).sort().join("|") !== expectedKeys.sort().join("|") ||
    typeof cursor.keyId !== "string" ||
    !JOB_SEARCH_CURSOR_KEY_ID_PATTERN.test(cursor.keyId) ||
    typeof cursor.revision !== "string" ||
    !/^[1-9]\d*$/.test(cursor.revision) ||
    cursor.sort !== sort ||
    !asOf ||
    Number.isNaN(asOf.getTime()) ||
    asOf.toISOString() !== cursor.asOf ||
    asOf.getTime() > now.getTime() ||
    now.getTime() - asOf.getTime() > JOB_SEARCH_CURSOR_MAXIMUM_AGE_MILLISECONDS ||
    typeof cursor.lastVerifiedAt !== "string" ||
    Number.isNaN(new Date(cursor.lastVerifiedAt).getTime()) ||
    new Date(cursor.lastVerifiedAt).toISOString() !== cursor.lastVerifiedAt ||
    typeof cursor.id !== "string" ||
    !JOB_SEARCH_ID_PATTERN.test(cursor.id) ||
    (sort === "relevance" &&
      (typeof cursor.rankKey !== "string" || !JOB_SEARCH_RANK_PATTERN.test(cursor.rankKey)))
  ) {
    throw new InvalidJobSearchError("Search cursor does not match this request");
  }
  return cursor as JobSearchCursor;
}

interface DuplicateCandidateRow {
  jobId: string;
  candidateJobId: string;
  classification: "probable";
  resolution: DuplicateResolution | null;
  canonicalJobId: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewReasonCode: string | null;
  resolutionVersion: number;
}

const opaqueReviewerPattern = /^[A-Za-z0-9:_-]{3,200}$/;
const reviewReasonCodePattern = /^[a-z0-9][a-z0-9_.:-]{2,99}$/;

function orderedCandidatePair(jobId: string, candidateJobId: string): [string, string] {
  if (jobId === candidateJobId) {
    throw new Error("A duplicate candidate must contain two different jobs");
  }
  return jobId < candidateJobId ? [jobId, candidateJobId] : [candidateJobId, jobId];
}

function validateReviewMetadata(reviewedBy: string, reasonCode: string, reviewedAt: Date): void {
  if (!opaqueReviewerPattern.test(reviewedBy)) {
    throw new Error("reviewedBy must be a non-PII opaque identifier");
  }
  if (!reviewReasonCodePattern.test(reasonCode)) {
    throw new Error("A non-PII duplicate-review reason code is required");
  }
  if (Number.isNaN(reviewedAt.getTime())) {
    throw new Error("A valid duplicate-review timestamp is required");
  }
}

function mapDuplicateCandidate(row: DuplicateCandidateRow): DuplicateCandidateRecord {
  return {
    jobId: row.jobId,
    candidateJobId: row.candidateJobId,
    classification: row.classification,
    ...(row.resolution ? { resolution: row.resolution } : {}),
    ...(row.canonicalJobId ? { canonicalJobId: row.canonicalJobId } : {}),
    ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
    ...(row.reviewedBy ? { reviewedBy: row.reviewedBy } : {}),
    ...(row.reviewReasonCode ? { reviewReasonCode: row.reviewReasonCode } : {}),
    resolutionVersion: row.resolutionVersion,
  };
}

function mapJob(row: CatalogJobRow): CatalogJobRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    locations: row.locations,
    ...(row.description ? { description: row.description } : {}),
    status: row.status,
    firstObservedAt: row.firstObservedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    expiresAt: row.expiresAt,
  };
}

async function findExactMatches(
  transaction: postgres.TransactionSql,
  observation: CanonicalObservation,
): Promise<ExactMatchRow[]> {
  const matches: ExactMatchRow[] = [];
  if (observation.atsTenant && observation.externalJobId) {
    matches.push(
      ...(await transaction<ExactMatchRow[]>`
        SELECT job_id AS "jobId", id AS "sourceId"
        FROM jobs.job_sources
        WHERE provider = ${observation.provider}
          AND ats_tenant = ${observation.atsTenant}
          AND external_job_id = ${observation.externalJobId}
      `),
    );
  }
  if (observation.employerRequisitionId && observation.verifiedCompanyDomain) {
    matches.push(
      ...(await transaction<ExactMatchRow[]>`
        SELECT job_id AS "jobId", id AS "sourceId"
        FROM jobs.job_sources
        WHERE verified_company_domain = ${observation.verifiedCompanyDomain}
          AND employer_requisition_id = ${observation.employerRequisitionId}
      `),
    );
  }
  matches.push(
    ...(await transaction<ExactMatchRow[]>`
      SELECT job_id AS "jobId", id AS "sourceId"
      FROM jobs.job_sources
      WHERE canonical_url_hash = ${observation.canonicalUrlHash}
    `),
  );
  return matches;
}

export class PostgresJobCatalog {
  private readonly acceptedProvenance: ReadonlySet<JobProvenance>;
  private readonly activeCursorKey: JobSearchCursorKey;
  private readonly cursorKeys: ReadonlyMap<string, Uint8Array>;

  constructor(
    private readonly client: postgres.Sql,
    options: JobCatalogOptions,
  ) {
    this.acceptedProvenance =
      options.acceptedProvenance ?? new Set<JobProvenance>(["authorized_fixture"]);
    const keys = [
      options.searchCursorKeys.active,
      ...(options.searchCursorKeys.verification ?? []),
    ];
    for (const key of keys) {
      validateCursorKey(key);
    }
    if (new Set(keys.map((key) => key.id)).size !== keys.length) {
      throw new Error("Job-search cursor key identifiers must be unique");
    }
    this.activeCursorKey = {
      id: options.searchCursorKeys.active.id,
      key: Buffer.from(options.searchCursorKeys.active.key),
    };
    this.cursorKeys = new Map(keys.map((key) => [key.id, Buffer.from(key.key)]));
  }

  async recordObservation(input: CatalogObservation): Promise<RecordObservationResult> {
    if (!this.acceptedProvenance.has(input.provenance)) {
      throw new Error(`Provenance ${input.provenance} is not enabled for this runtime`);
    }
    const { rawSnapshot, ...jobObservation } = input;
    const observation = canonicalizeObservation(jobObservation);

    return this.client.begin(async (transaction) => {
      for (const identityKey of exactIdentityKeys(observation).sort()) {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:${identityKey}`}))`;
      }

      const exactMatches = await findExactMatches(transaction, observation);
      const matchedJobIds = [...new Set(exactMatches.map((match) => match.jobId))];
      if (matchedJobIds.length > 1) {
        throw new Error("Conflicting exact job identities require manual resolution");
      }

      const matchedJobId = matchedJobIds[0];
      const probableDuplicateJobIds: string[] = [];
      let outcome: RecordObservationResult["outcome"];
      let jobId: string;
      let sourceId: string;
      let resolvedStatus: JobStatus;

      if (matchedJobId) {
        const [existing] = await transaction<ExistingJobRow[]>`
          SELECT
            id,
            company_id AS "companyId",
            status,
            first_observed_at AS "firstObservedAt",
            expires_at AS "expiresAt",
            consecutive_verification_failures AS "consecutiveVerificationFailures"
          FROM jobs.canonical_jobs
          WHERE id = ${matchedJobId}
          FOR UPDATE
        `;
        if (!existing) {
          throw new Error("Exact source identity points to a missing canonical job");
        }
        const nextStatus = evaluateLifecycle({
          currentStatus: existing.status,
          now: observation.observedAt,
          expiresAt: observation.expiresAt,
          positiveVerification: true,
        });
        await transaction`
          UPDATE jobs.canonical_jobs
          SET title = ${observation.title},
              normalized_title = ${observation.normalizedTitle},
              locations = ${transaction.json(observation.locations)},
              normalized_locations = ${transaction.array(observation.normalizedLocations)},
              department = ${observation.department ?? null},
              normalized_department = ${observation.normalizedDepartment ?? null},
              description = CASE WHEN ${nextStatus} IN ('withdrawn', 'blocked')
                THEN NULL ELSE ${observation.description} END,
              description_hash = CASE WHEN ${nextStatus} IN ('withdrawn', 'blocked')
                THEN NULL ELSE ${observation.contentHash} END,
              dedupe_fingerprint = ${observation.fuzzyFingerprint},
              status = ${nextStatus},
              status_reason = 'positive_verification',
              last_verified_at = ${observation.observedAt},
              expires_at = ${observation.expiresAt},
              valid_through = ${observation.validThrough ?? null},
              consecutive_verification_failures = 0,
              updated_at = ${observation.observedAt}
          WHERE id = ${existing.id}
        `;
        if (nextStatus !== existing.status) {
          await transaction`
            INSERT INTO jobs.status_events (
              id, job_id, from_status, to_status, reason, occurred_at
            ) VALUES (
              ${uuidv7()}, ${existing.id}, ${existing.status}, ${nextStatus},
              'positive_verification', ${observation.observedAt}
            )
          `;
        }
        jobId = existing.id;
        sourceId = exactMatches[0]?.sourceId ?? uuidv7();
        outcome = "exact_match_updated";
        resolvedStatus = nextStatus;
      } else {
        const [company] = await transaction<{ id: string }[]>`
          INSERT INTO jobs.companies (
            id, display_name, normalized_name, verified_domain, created_at, updated_at
          ) VALUES (
            ${uuidv7()}, ${observation.companyName}, ${observation.normalizedCompanyName},
            ${observation.verifiedCompanyDomain ?? null}, ${observation.observedAt},
            ${observation.observedAt}
          )
          ON CONFLICT (normalized_name, verified_domain)
          DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
          RETURNING id
        `;
        if (!company) {
          throw new Error("Unable to resolve canonical company");
        }

        const probableRows = await transaction<{ id: string }[]>`
          SELECT id
          FROM jobs.canonical_jobs
          WHERE dedupe_fingerprint = ${observation.fuzzyFingerprint}
          ORDER BY created_at, id
        `;
        probableDuplicateJobIds.push(...probableRows.map((row) => row.id));
        jobId = uuidv7();
        sourceId = uuidv7();
        outcome = "created";
        resolvedStatus = "active";
        await transaction`
          INSERT INTO jobs.canonical_jobs (
            id, company_id, title, normalized_title, locations, normalized_locations,
            department, normalized_department, description, description_hash,
            dedupe_fingerprint, status, status_reason, first_observed_at, last_verified_at,
            expires_at, valid_through, consecutive_verification_failures, created_at, updated_at
          ) VALUES (
            ${jobId}, ${company.id}, ${observation.title}, ${observation.normalizedTitle},
            ${transaction.json(observation.locations)},
            ${transaction.array(observation.normalizedLocations)},
            ${observation.department ?? null}, ${observation.normalizedDepartment ?? null},
            ${observation.description}, ${observation.contentHash}, ${observation.fuzzyFingerprint},
            'active', 'first_positive_verification', ${observation.observedAt},
            ${observation.observedAt}, ${observation.expiresAt},
            ${observation.validThrough ?? null}, 0, ${observation.observedAt},
            ${observation.observedAt}
          )
        `;
        await transaction`
          INSERT INTO jobs.status_events (
            id, job_id, from_status, to_status, reason, occurred_at
          ) VALUES (
            ${uuidv7()}, ${jobId}, NULL, 'active', 'first_positive_verification',
            ${observation.observedAt}
          )
        `;
        for (const candidateJobId of probableDuplicateJobIds) {
          const lowerId = jobId < candidateJobId ? jobId : candidateJobId;
          const upperId = jobId < candidateJobId ? candidateJobId : jobId;
          await transaction`
            INSERT INTO jobs.duplicate_candidates (
              job_id, candidate_job_id, classification, fingerprint, created_at
            ) VALUES (
              ${lowerId}, ${upperId}, 'probable', ${observation.fuzzyFingerprint},
              ${observation.observedAt}
            )
            ON CONFLICT (job_id, candidate_job_id) DO NOTHING
          `;
        }
      }

      if (exactMatches.length > 0) {
        await transaction`
          UPDATE jobs.job_sources
          SET provider = ${observation.provider},
              provenance = ${observation.provenance},
              ats_tenant = ${observation.atsTenant ?? null},
              external_job_id = ${observation.externalJobId ?? null},
              employer_requisition_id = ${observation.employerRequisitionId ?? null},
              verified_company_domain = ${observation.verifiedCompanyDomain ?? null},
              source_url = ${observation.canonicalUrl},
              canonical_url = ${observation.canonicalUrl},
              canonical_url_hash = ${observation.canonicalUrlHash},
              content_hash = ${observation.contentHash},
              adapter_version = ${observation.adapterVersion ?? null},
              raw_snapshot = CASE WHEN ${resolvedStatus} IN ('withdrawn', 'blocked')
                THEN NULL ELSE ${rawSnapshot ? transaction.json(rawSnapshot) : null}::jsonb END,
              last_observed_at = ${observation.observedAt},
              last_verified_at = ${observation.observedAt},
              valid_through = ${observation.validThrough ?? null},
              updated_at = ${observation.observedAt}
          WHERE id = ${sourceId}
        `;
      } else {
        await transaction`
          INSERT INTO jobs.job_sources (
            id, job_id, provider, provenance, ats_tenant, external_job_id,
            employer_requisition_id, verified_company_domain, source_url, canonical_url,
            canonical_url_hash, content_hash, adapter_version, raw_snapshot, first_observed_at,
            last_observed_at, last_verified_at, valid_through, created_at, updated_at
          ) VALUES (
            ${sourceId}, ${jobId}, ${observation.provider}, ${observation.provenance},
            ${observation.atsTenant ?? null}, ${observation.externalJobId ?? null},
            ${observation.employerRequisitionId ?? null},
            ${observation.verifiedCompanyDomain ?? null}, ${observation.canonicalUrl},
            ${observation.canonicalUrl}, ${observation.canonicalUrlHash},
            ${observation.contentHash}, ${observation.adapterVersion ?? null},
            ${rawSnapshot ? transaction.json(rawSnapshot) : null}::jsonb,
            ${observation.observedAt},
            ${observation.observedAt}, ${observation.observedAt},
            ${observation.validThrough ?? null}, ${observation.observedAt},
            ${observation.observedAt}
          )
        `;
      }

      const job = await this.getByIdWithClient(transaction, jobId);
      if (!job) {
        throw new Error("Canonical job disappeared during observation transaction");
      }
      return { outcome, job, probableDuplicateJobIds };
    });
  }

  async recordVerificationFailure(jobId: string, checkedAt: Date): Promise<JobStatus> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:verification:${jobId}`}))`;
      const [existing] = await transaction<ExistingJobRow[]>`
        SELECT
          id,
          company_id AS "companyId",
          status,
          first_observed_at AS "firstObservedAt",
          expires_at AS "expiresAt",
          consecutive_verification_failures AS "consecutiveVerificationFailures"
        FROM jobs.canonical_jobs
        WHERE id = ${jobId}
        FOR UPDATE
      `;
      if (!existing) {
        throw new Error("Canonical job not found");
      }
      const failureCount = existing.consecutiveVerificationFailures + 1;
      const nextStatus = evaluateLifecycle({
        currentStatus: existing.status,
        now: checkedAt,
        expiresAt: existing.expiresAt,
        consecutiveVerificationFailures: failureCount,
      });
      await transaction`
        UPDATE jobs.canonical_jobs
        SET status = ${nextStatus},
            status_reason = 'verification_failure',
            consecutive_verification_failures = ${failureCount},
            description = CASE WHEN ${nextStatus} IN ('expired', 'withdrawn', 'blocked')
              THEN NULL ELSE description END,
            updated_at = ${checkedAt}
        WHERE id = ${jobId}
      `;
      if (["expired", "withdrawn", "blocked"].includes(nextStatus)) {
        await transaction`
          UPDATE jobs.job_sources SET raw_snapshot = NULL, updated_at = ${checkedAt}
          WHERE job_id = ${jobId}
        `;
      }
      if (nextStatus !== existing.status) {
        await transaction`
          INSERT INTO jobs.status_events (
            id, job_id, from_status, to_status, reason, occurred_at
          ) VALUES (
            ${uuidv7()}, ${jobId}, ${existing.status}, ${nextStatus},
            'verification_failure', ${checkedAt}
          )
        `;
      }
      return nextStatus;
    });
  }

  async reviewDuplicateCandidate(
    input: ReviewDuplicateCandidateInput,
  ): Promise<DuplicateCandidateRecord> {
    const [jobId, candidateJobId] = orderedCandidatePair(input.jobId, input.candidateJobId);
    validateReviewMetadata(input.reviewedBy, input.reasonCode, input.reviewedAt);
    if (input.resolution === "exact") {
      if (input.canonicalJobId !== jobId && input.canonicalJobId !== candidateJobId) {
        throw new Error("An exact resolution requires one candidate member as canonicalJobId");
      }
    } else if (input.canonicalJobId !== undefined) {
      throw new Error("Only an exact resolution may select a canonical job");
    }
    return this.applyDuplicateResolution({
      jobId,
      candidateJobId,
      resolution: input.resolution,
      canonicalJobId: input.canonicalJobId ?? null,
      reviewedBy: input.reviewedBy,
      reasonCode: input.reasonCode,
      reviewedAt: input.reviewedAt,
    });
  }

  async reopenDuplicateCandidate(
    input: ReopenDuplicateCandidateInput,
  ): Promise<DuplicateCandidateRecord> {
    const [jobId, candidateJobId] = orderedCandidatePair(input.jobId, input.candidateJobId);
    validateReviewMetadata(input.reviewedBy, input.reasonCode, input.reviewedAt);
    return this.applyDuplicateResolution({
      jobId,
      candidateJobId,
      resolution: null,
      canonicalJobId: null,
      reviewedBy: input.reviewedBy,
      reasonCode: input.reasonCode,
      reviewedAt: input.reviewedAt,
    });
  }

  async setTerminalStatus(
    jobId: string,
    status: "withdrawn" | "blocked",
    reason: string,
    occurredAt: Date,
  ): Promise<void> {
    if (!reason.trim()) {
      throw new Error("A terminal status reason is required");
    }
    await this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:terminal:${jobId}`}))`;
      const [existing] = await transaction<{ status: JobStatus }[]>`
        SELECT status FROM jobs.canonical_jobs WHERE id = ${jobId} FOR UPDATE
      `;
      if (!existing) {
        throw new Error("Canonical job not found");
      }
      await transaction`
        UPDATE jobs.canonical_jobs
        SET status = ${status}, status_reason = ${reason}, description = NULL,
            description_hash = NULL, updated_at = ${occurredAt}
        WHERE id = ${jobId}
      `;
      await transaction`
        UPDATE jobs.job_sources SET raw_snapshot = NULL, updated_at = ${occurredAt}
        WHERE job_id = ${jobId}
      `;
      if (existing.status !== status) {
        await transaction`
          INSERT INTO jobs.status_events (
            id, job_id, from_status, to_status, reason, occurred_at
          ) VALUES (
            ${uuidv7()}, ${jobId}, ${existing.status}, ${status}, ${reason}, ${occurredAt}
          )
        `;
      }
    });
  }

  async expireStaleJobs(now: Date): Promise<string[]> {
    return this.client.begin(async (transaction) => {
      const rows = await transaction<{ id: string; status: JobStatus }[]>`
        SELECT id, status
        FROM jobs.canonical_jobs
        WHERE status IN ('pending', 'active', 'suspect_stale')
          AND expires_at <= ${now}
        ORDER BY id
        FOR UPDATE
      `;
      for (const row of rows) {
        await transaction`
          UPDATE jobs.canonical_jobs
          SET status = 'expired', status_reason = 'freshness_window_elapsed',
              description = NULL, description_hash = NULL, updated_at = ${now}
          WHERE id = ${row.id}
        `;
        await transaction`
          UPDATE jobs.job_sources SET raw_snapshot = NULL, updated_at = ${now}
          WHERE job_id = ${row.id}
        `;
        await transaction`
          INSERT INTO jobs.status_events (
            id, job_id, from_status, to_status, reason, occurred_at
          ) VALUES (
            ${uuidv7()}, ${row.id}, ${row.status}, 'expired',
            'freshness_window_elapsed', ${now}
          )
        `;
      }
      return rows.map((row) => row.id);
    });
  }

  async getById(jobId: string): Promise<CatalogJobRecord | null> {
    return this.getByIdWithClient(this.client, jobId);
  }

  async ping(): Promise<void> {
    const [result] = await this.client<{ catalogPresent: boolean }[]>`
      SELECT (to_regclass('jobs.canonical_jobs') IS NOT NULL) AS "catalogPresent"
    `;
    if (!result?.catalogPresent) {
      throw new Error("Jobs catalog schema is unavailable");
    }
  }

  async getCatalogRevision(): Promise<string> {
    const [state] = await this.client<{ revision: string }[]>`
      SELECT revision::text AS revision
      FROM jobs.catalog_search_state
      WHERE singleton = true
    `;
    if (!state) throw new Error("The job catalog revision is unavailable");
    return state.revision;
  }

  async resolveActiveJobSummaries(
    jobIds: readonly string[],
    now: Date = new Date(),
  ): Promise<ActiveJobSummaryResolutionPage> {
    if (jobIds.length < 1 || jobIds.length > 50) {
      throw new Error("Active job summary resolution requires 1 to 50 identifiers");
    }
    if (!Number.isFinite(now.getTime())) throw new RangeError("Active job boundary is invalid");
    const activeAt = now.toISOString();
    return this.client.begin("read only isolation level repeatable read", async (transaction) => {
      const [state] = await transaction<{ revision: string }[]>`
        SELECT revision::text AS revision
        FROM jobs.catalog_search_state
        WHERE singleton = true
      `;
      if (!state) throw new Error("The job catalog revision is unavailable");
      const rows = await transaction<Array<ActiveJobSearchRow & { requestedJobId: string }>>`
        WITH RECURSIVE requested(requested_id) AS (
          SELECT unnest(${jobIds as string[]}::uuid[])
        ), resolution(requested_id, id, path) AS (
          SELECT requested_id, requested_id, ARRAY[requested_id]
          FROM requested
          UNION ALL
          SELECT resolution.requested_id, duplicate.canonical_job_id,
            resolution.path || duplicate.canonical_job_id
          FROM resolution
          INNER JOIN jobs.duplicate_candidates AS duplicate
            ON duplicate.resolution = 'exact'
            AND CASE
              WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
              ELSE duplicate.job_id
            END = resolution.id
          WHERE NOT duplicate.canonical_job_id = ANY(resolution.path)
        ), canonical AS (
          SELECT DISTINCT ON (requested_id) requested_id, id
          FROM resolution
          ORDER BY requested_id, cardinality(path) DESC
        )
        SELECT canonical.requested_id AS "requestedJobId", job.id,
          company.id AS "companyId", company.display_name AS "companyName",
          company.verified_domain AS "companyVerifiedDomain", job.title, job.locations,
          job.department, job.first_observed_at AS "firstObservedAt",
          job.last_verified_at AS "lastVerifiedAt", job.expires_at AS "expiresAt",
          '0'::text AS "rankKey"
        FROM canonical
        INNER JOIN jobs.canonical_jobs AS job ON job.id = canonical.id
        INNER JOIN jobs.companies AS company ON company.id = job.company_id
        WHERE job.status = 'active' AND job.expires_at > ${activeAt}
          AND job.description IS NOT NULL
      `;
      return {
        catalogRevision: state.revision,
        items: rows.map((row) => ({
          requestedJobId: row.requestedJobId,
          job: {
            id: row.id,
            company: {
              id: row.companyId,
              name: row.companyName,
              ...(row.companyVerifiedDomain ? { verifiedDomain: row.companyVerifiedDomain } : {}),
            },
            title: row.title,
            locations: row.locations,
            ...(row.department ? { department: row.department } : {}),
            status: "active",
            firstObservedAt: normalizeJobSearchTimestamp(row.firstObservedAt, "first-observed"),
            lastVerifiedAt: normalizeJobSearchTimestamp(row.lastVerifiedAt, "last-verified"),
            expiresAt: normalizeJobSearchTimestamp(row.expiresAt, "expiry"),
          },
        })),
      };
    });
  }

  async getActiveJob(jobId: string, now: Date = new Date()): Promise<ActiveJobRecord | null> {
    // Keep the PostgreSQL wire value primitive. The bundled Lambda runtime must not pass a Date
    // object across the postgres.js serializer boundary; an ISO timestamp remains parameterized
    // and PostgreSQL infers timestamptz from the comparison target.
    const activeAt = now.toISOString();
    const canonicalJobId = await this.resolveCanonicalJobId(jobId);
    const [row] = await this.client<ActiveJobRow[]>`
      WITH RECURSIVE canonical_members(id) AS (
        SELECT ${canonicalJobId}::uuid
        UNION
        SELECT CASE
          WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
          ELSE duplicate.job_id
        END
        FROM jobs.duplicate_candidates AS duplicate
        INNER JOIN canonical_members AS member ON duplicate.canonical_job_id = member.id
        WHERE duplicate.resolution = 'exact'
      )
      SELECT
        job.id,
        company.id AS "companyId",
        company.display_name AS "companyName",
        company.verified_domain AS "companyVerifiedDomain",
        job.title,
        job.locations,
        job.department,
        job.description,
        job.status,
        job.first_observed_at AS "firstObservedAt",
        job.last_verified_at AS "lastVerifiedAt",
        job.expires_at AS "expiresAt",
        job.valid_through AS "validThrough",
        jsonb_agg(
          jsonb_build_object(
            'provider', source.provider,
            'provenance', source.provenance,
            'canonicalUrl', source.canonical_url,
            'firstObservedAt', source.first_observed_at,
            'lastVerifiedAt', source.last_verified_at,
            'validThrough', source.valid_through
          ) ORDER BY source.first_observed_at, source.id
        ) AS sources
      FROM jobs.canonical_jobs AS job
      INNER JOIN jobs.companies AS company ON company.id = job.company_id
      INNER JOIN jobs.job_sources AS source
        ON source.job_id IN (SELECT id FROM canonical_members)
      WHERE job.id = ${canonicalJobId}
        AND job.status = 'active'
        AND job.expires_at > ${activeAt}
        AND job.description IS NOT NULL
      GROUP BY job.id, company.id
      LIMIT 1
    `;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      company: {
        id: row.companyId,
        name: row.companyName,
        ...(row.companyVerifiedDomain ? { verifiedDomain: row.companyVerifiedDomain } : {}),
      },
      title: row.title,
      locations: row.locations,
      ...(row.department ? { department: row.department } : {}),
      description: row.description,
      status: "active",
      firstObservedAt: row.firstObservedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      expiresAt: row.expiresAt,
      ...(row.validThrough ? { validThrough: row.validThrough } : {}),
      sources: row.sources.map((source) => ({
        provider: source.provider,
        provenance: source.provenance,
        canonicalUrl: source.canonicalUrl,
        firstObservedAt: new Date(source.firstObservedAt),
        lastVerifiedAt: new Date(source.lastVerifiedAt),
        ...(source.validThrough ? { validThrough: new Date(source.validThrough) } : {}),
      })),
    };
  }

  async searchActiveJobs(
    input: ActiveJobSearchInput,
    now: Date = new Date(),
  ): Promise<ActiveJobSearchPage> {
    if (!Number.isFinite(now.getTime())) {
      throw new InvalidJobSearchError("Search freshness boundary is invalid");
    }
    const normalized = normalizeJobSearchInput(input);
    const canonicalRequest = canonicalJobSearchRequest(normalized);
    const cursor = decodeJobSearchCursor(
      normalized.cursor,
      canonicalRequest,
      normalized.sort,
      now,
      this.cursorKeys,
    );
    const activeAt = cursor?.asOf ?? now.toISOString();
    const cursorVerifiedAt = cursor?.lastVerifiedAt ?? null;
    const cursorId = cursor?.id ?? null;
    const cursorRank = cursor?.rankKey ?? null;
    return this.client.begin("read only isolation level repeatable read", async (transaction) => {
      const [state] = await transaction<{ revision: string }[]>`
        SELECT revision::text AS revision
        FROM jobs.catalog_search_state
        WHERE singleton = true
      `;
      if (!state) {
        throw new Error("The job-search catalog revision is unavailable");
      }
      if (cursor && cursor.revision !== state.revision) {
        throw new JobSearchCatalogChangedError();
      }
      const rows = await transaction<ActiveJobSearchRow[]>`
      WITH ranked_jobs AS (
        SELECT
          job.id,
          company.id AS "companyId",
          company.display_name AS "companyName",
          company.verified_domain AS "companyVerifiedDomain",
          job.title,
          job.locations,
          job.department,
          job.first_observed_at AS "firstObservedAt",
          job.last_verified_at AS "lastVerifiedAt",
          job.expires_at AS "expiresAt",
          round((CASE
            WHEN ${normalized.query}::text IS NULL THEN 0::numeric
            ELSE
              ts_rank_cd(
                job.search_document,
                websearch_to_tsquery('simple'::regconfig, ${normalized.query}::text)
              )::numeric +
              CASE WHEN strpos(company.normalized_name, ${normalized.query}::text) > 0
                THEN 0.5::numeric ELSE 0::numeric END
          END), 6) AS rank_key
        FROM jobs.canonical_jobs AS job
        INNER JOIN jobs.companies AS company ON company.id = job.company_id
        WHERE job.status = 'active'
          AND job.expires_at > ${activeAt}
          AND job.description IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM jobs.duplicate_candidates AS duplicate
            WHERE duplicate.resolution = 'exact'
              AND CASE
                WHEN duplicate.canonical_job_id = duplicate.job_id
                  THEN duplicate.candidate_job_id
                ELSE duplicate.job_id
              END = job.id
          )
          AND (
            ${normalized.query}::text IS NULL
            OR job.search_document @@ websearch_to_tsquery(
              'simple'::regconfig,
              ${normalized.query}::text
            )
            OR strpos(company.normalized_name, ${normalized.query}::text) > 0
          )
          AND (${normalized.title}::text IS NULL OR job.normalized_title = ${normalized.title})
          AND (${normalized.company}::text IS NULL OR company.normalized_name = ${normalized.company})
          AND (
            ${normalized.location}::text IS NULL
            OR job.normalized_locations @> ARRAY[${normalized.location}]::text[]
          )
          AND (
            ${normalized.verifiedWithinDays}::integer IS NULL
            OR job.last_verified_at >= (
              ${activeAt}::timestamptz - (${normalized.verifiedWithinDays} * interval '1 day')
            )
          )
      )
      SELECT
        id,
        "companyId",
        "companyName",
        "companyVerifiedDomain",
        title,
        locations,
        department,
        "firstObservedAt",
        "lastVerifiedAt",
        "expiresAt",
        rank_key::text AS "rankKey"
      FROM ranked_jobs
      WHERE ${cursorId}::uuid IS NULL
        OR (
          ${normalized.sort}::text = 'relevance'
          AND (
            rank_key < ${cursorRank}::numeric
            OR (rank_key = ${cursorRank}::numeric AND "lastVerifiedAt" < ${cursorVerifiedAt}::timestamptz)
            OR (
              rank_key = ${cursorRank}::numeric
              AND "lastVerifiedAt" = ${cursorVerifiedAt}::timestamptz
              AND id > ${cursorId}::uuid
            )
          )
        )
        OR (
          ${normalized.sort}::text = 'freshness'
          AND (
            "lastVerifiedAt" < ${cursorVerifiedAt}::timestamptz
            OR (
              "lastVerifiedAt" = ${cursorVerifiedAt}::timestamptz
              AND id > ${cursorId}::uuid
            )
          )
        )
      ORDER BY
        CASE WHEN ${normalized.sort}::text = 'relevance' THEN rank_key END DESC,
        "lastVerifiedAt" DESC,
        id ASC
      LIMIT ${normalized.pageSize + 1}
    `;
      const pageRows = rows.slice(0, normalized.pageSize).map((row) => ({
        ...row,
        firstObservedAt: normalizeJobSearchTimestamp(row.firstObservedAt, "first-observed"),
        lastVerifiedAt: normalizeJobSearchTimestamp(row.lastVerifiedAt, "last-verified"),
        expiresAt: normalizeJobSearchTimestamp(row.expiresAt, "expiry"),
      }));
      const items = pageRows.map(
        (row): ActiveJobSummaryRecord => ({
          id: row.id,
          company: {
            id: row.companyId,
            name: row.companyName,
            ...(row.companyVerifiedDomain ? { verifiedDomain: row.companyVerifiedDomain } : {}),
          },
          title: row.title,
          locations: row.locations,
          ...(row.department ? { department: row.department } : {}),
          status: "active",
          firstObservedAt: row.firstObservedAt,
          lastVerifiedAt: row.lastVerifiedAt,
          expiresAt: row.expiresAt,
        }),
      );
      const last = rows.length > normalized.pageSize ? pageRows.at(-1) : undefined;
      if (!last) {
        return { items };
      }
      const nextCursor = encodeJobSearchCursor(
        {
          version: 1,
          keyId: this.activeCursorKey.id,
          revision: state.revision,
          sort: normalized.sort,
          asOf: activeAt,
          lastVerifiedAt: last.lastVerifiedAt.toISOString(),
          id: last.id,
          ...(normalized.sort === "relevance" ? { rankKey: last.rankKey } : {}),
        },
        canonicalRequest,
        this.activeCursorKey,
      );
      return { items, nextCursor };
    });
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async resolveCanonicalJobId(jobId: string): Promise<string> {
    const [resolved] = await this.client<{ id: string }[]>`
      WITH RECURSIVE resolution(id, path) AS (
        SELECT ${jobId}::uuid, ARRAY[${jobId}::uuid]
        UNION ALL
        SELECT duplicate.canonical_job_id, resolution.path || duplicate.canonical_job_id
        FROM resolution
        INNER JOIN jobs.duplicate_candidates AS duplicate
          ON duplicate.resolution = 'exact'
          AND CASE
            WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
            ELSE duplicate.job_id
          END = resolution.id
        WHERE NOT duplicate.canonical_job_id = ANY(resolution.path)
      )
      SELECT id FROM resolution ORDER BY cardinality(path) DESC LIMIT 1
    `;
    return resolved?.id ?? jobId;
  }

  private async applyDuplicateResolution(input: {
    jobId: string;
    candidateJobId: string;
    resolution: DuplicateResolution | null;
    canonicalJobId: string | null;
    reviewedBy: string;
    reasonCode: string;
    reviewedAt: Date;
  }): Promise<DuplicateCandidateRecord> {
    return this.client.begin(async (transaction) => {
      for (const id of [input.jobId, input.candidateJobId].sort()) {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:duplicate-job:${id}`}))`;
      }
      const [existing] = await transaction<DuplicateCandidateRow[]>`
        SELECT
          job_id AS "jobId",
          candidate_job_id AS "candidateJobId",
          classification,
          resolution,
          canonical_job_id AS "canonicalJobId",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason_code AS "reviewReasonCode",
          resolution_version AS "resolutionVersion"
        FROM jobs.duplicate_candidates
        WHERE job_id = ${input.jobId} AND candidate_job_id = ${input.candidateJobId}
        FOR UPDATE
      `;
      if (!existing) {
        throw new Error("Probable duplicate candidate not found");
      }
      if (existing.classification !== "probable") {
        throw new Error("Only probable duplicate candidates may be reviewed");
      }
      if (
        existing.resolution === input.resolution &&
        existing.canonicalJobId === input.canonicalJobId
      ) {
        return mapDuplicateCandidate(existing);
      }

      if (input.resolution === "exact" && input.canonicalJobId) {
        const loserJobId =
          input.canonicalJobId === input.jobId ? input.candidateJobId : input.jobId;
        const [topology] = await transaction<{ conflicts: boolean }[]>`
          SELECT EXISTS (
            SELECT 1
            FROM jobs.duplicate_candidates AS duplicate
            WHERE duplicate.resolution = 'exact'
              AND NOT (
                duplicate.job_id = ${input.jobId}
                AND duplicate.candidate_job_id = ${input.candidateJobId}
              )
              AND (
                duplicate.canonical_job_id = ${loserJobId}
                OR CASE
                  WHEN duplicate.canonical_job_id = duplicate.job_id
                    THEN duplicate.candidate_job_id
                  ELSE duplicate.job_id
                END = ${loserJobId}
                OR CASE
                  WHEN duplicate.canonical_job_id = duplicate.job_id
                    THEN duplicate.candidate_job_id
                  ELSE duplicate.job_id
                END = ${input.canonicalJobId}
              )
          ) AS conflicts
        `;
        if (topology?.conflicts) {
          throw new Error("Exact resolution would create an ambiguous canonical-job topology");
        }
      }

      const resolutionVersion = existing.resolutionVersion + 1;
      const [updated] = await transaction<DuplicateCandidateRow[]>`
        UPDATE jobs.duplicate_candidates
        SET resolution = ${input.resolution},
            canonical_job_id = ${input.canonicalJobId},
            reviewed_at = ${input.resolution ? input.reviewedAt : null},
            reviewed_by = ${input.resolution ? input.reviewedBy : null},
            review_reason_code = ${input.resolution ? input.reasonCode : null},
            resolution_version = ${resolutionVersion}
        WHERE job_id = ${input.jobId} AND candidate_job_id = ${input.candidateJobId}
        RETURNING
          job_id AS "jobId",
          candidate_job_id AS "candidateJobId",
          classification,
          resolution,
          canonical_job_id AS "canonicalJobId",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason_code AS "reviewReasonCode",
          resolution_version AS "resolutionVersion"
      `;
      if (!updated) {
        throw new Error("Duplicate candidate disappeared during review");
      }
      await transaction`
        INSERT INTO jobs.duplicate_resolution_events (
          id, job_id, candidate_job_id, previous_resolution,
          previous_canonical_job_id, resolution, canonical_job_id,
          reviewed_by, reason_code, occurred_at, resolution_version
        ) VALUES (
          ${uuidv7()}, ${input.jobId}, ${input.candidateJobId}, ${existing.resolution},
          ${existing.canonicalJobId}, ${input.resolution}, ${input.canonicalJobId},
          ${input.reviewedBy}, ${input.reasonCode}, ${input.reviewedAt}, ${resolutionVersion}
        )
      `;
      return mapDuplicateCandidate(updated);
    });
  }

  private async getByIdWithClient(
    sql: postgres.Sql | postgres.TransactionSql,
    jobId: string,
  ): Promise<CatalogJobRecord | null> {
    const [row] = await sql<CatalogJobRow[]>`
      SELECT
        id,
        company_id AS "companyId",
        title,
        locations,
        description,
        status,
        first_observed_at AS "firstObservedAt",
        last_verified_at AS "lastVerifiedAt",
        expires_at AS "expiresAt"
      FROM jobs.canonical_jobs
      WHERE id = ${jobId}
      LIMIT 1
    `;
    return row ? mapJob(row) : null;
  }
}

export function createJobCatalogDatabase(
  databaseUrl: string,
  options: JobCatalogDatabaseOptions = {},
): postgres.Sql {
  return postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
}

export function nextDefaultExpiry(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + defaultFreshnessDays * 24 * 60 * 60 * 1000);
}

export { suspectStaleFailureThreshold };
