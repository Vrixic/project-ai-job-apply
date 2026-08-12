import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  canonicalizeObservation,
  defaultFreshnessDays,
  evaluateLifecycle,
  exactIdentityKeys,
  suspectStaleFailureThreshold,
  type CanonicalObservation,
  type JobObservation,
  type JobProvenance,
  type JobStatus,
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

export interface JobCatalogReader {
  ping(): Promise<void>;
  getActiveJob(jobId: string, now?: Date): Promise<ActiveJobRecord | null>;
}

export interface RecordObservationResult {
  outcome: "created" | "exact_match_updated";
  job: CatalogJobRecord;
  probableDuplicateJobIds: string[];
}

export interface JobCatalogOptions {
  acceptedProvenance?: ReadonlySet<JobProvenance>;
  maxConnections?: number;
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

  constructor(
    private readonly client: postgres.Sql,
    options: JobCatalogOptions = {},
  ) {
    this.acceptedProvenance =
      options.acceptedProvenance ?? new Set<JobProvenance>(["authorized_fixture"]);
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
                THEN NULL ELSE ${rawSnapshot ? transaction.json(rawSnapshot) : null} END,
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
            ${rawSnapshot ? transaction.json(rawSnapshot) : null}, ${observation.observedAt},
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

  async getActiveJob(jobId: string, now: Date = new Date()): Promise<ActiveJobRecord | null> {
    // Keep the PostgreSQL wire value primitive. The bundled Lambda runtime must not pass a Date
    // object across the postgres.js serializer boundary; an ISO timestamp remains parameterized
    // and PostgreSQL infers timestamptz from the comparison target.
    const activeAt = now.toISOString();
    const [row] = await this.client<ActiveJobRow[]>`
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
      INNER JOIN jobs.job_sources AS source ON source.job_id = job.id
      WHERE job.id = ${jobId}
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

  async close(): Promise<void> {
    await this.client.end();
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
  options: JobCatalogOptions = {},
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
