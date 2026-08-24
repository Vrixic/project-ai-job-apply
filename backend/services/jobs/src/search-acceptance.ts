import type postgres from "postgres";
import { v5 as uuidv5, v7 as uuidv7 } from "uuid";
import { type CanonicalObservation, canonicalizeObservation } from "./domain/canonical-job.js";

export const JOB_SEARCH_ACCEPTANCE_CONFIRMATION = "generated-synthetic-only";
export const JOB_SEARCH_ACCEPTANCE_SCHEMA_VERSION = 1;
export const JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT = 3;
export const JOB_SEARCH_ACCEPTANCE_MATCHING_COUNT = 2;

const JOB_SEARCH_MIGRATION_VERSION = "0004_job_search";
const JOB_SEARCH_MIGRATION_SHA256 =
  "08cfd97c93645e6feb9e9d795cae86d004f74e1f4d267626a2afe3ad633a769e";
const ACCEPTANCE_ADAPTER_VERSION = "d1-search-acceptance-v1";
const SEEDED_REASON = "search_acceptance_seeded";
const MUTATED_REASON = "search_acceptance_revision_bumped";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1_000;
const MUTATION_OFFSET_MS = 1_000;

export type JobSearchAcceptanceAction = "prepare" | "mutate" | "cleanup";

export interface JobSearchAcceptanceInput {
  action: JobSearchAcceptanceAction;
  runId: string;
  at?: Date;
}

export interface JobSearchAcceptanceResult {
  schemaVersion: 1;
  action: JobSearchAcceptanceAction;
  runId: string;
  queryToken: string;
  revisionBefore: string;
  revisionAfter: string;
  affectedJobs: number;
}

interface AcceptanceFixture {
  companyId: string;
  companyName: string;
  normalizedCompanyName: string;
  verifiedCompanyDomain: string;
  queryToken: string;
  jobs: Array<{
    sourceId: string;
    slug: "alpha" | "bravo" | "sentinel";
    matchesQuery: boolean;
    observation: CanonicalObservation;
  }>;
}

interface FixtureRow {
  id: string;
  companyId: string;
  companyName: string;
  normalizedCompanyName: string;
  companyVerifiedDomain: string | null;
  companyCreatedAt: Date;
  companyUpdatedAt: Date;
  title: string;
  normalizedTitle: string;
  locations: string[];
  normalizedLocations: string[];
  department: string | null;
  normalizedDepartment: string | null;
  description: string | null;
  descriptionHash: string | null;
  dedupeFingerprint: string;
  status: string;
  statusReason: string | null;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  validThrough: Date | null;
  workMode: string | null;
  employmentType: string | null;
  datePosted: Date | null;
  applicationUrl: string | null;
  structuredLocations: unknown;
  consecutiveVerificationFailures: number;
  jobCreatedAt: Date;
  jobUpdatedAt: Date;
  sourceId: string;
  provider: string;
  provenance: string;
  atsTenant: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  canonicalUrlHash: string;
  contentHash: string;
  sourceVerifiedCompanyDomain: string | null;
  externalJobId: string | null;
  employerRequisitionId: string | null;
  adapterVersion: string | null;
  rawSnapshot: unknown;
  sourceFirstObservedAt: Date;
  sourceLastObservedAt: Date;
  sourceLastVerifiedAt: Date;
  sourceValidThrough: Date | null;
  sourceDatePosted: Date | null;
  sourceApplicationUrl: string | null;
  sourceStructuredLocations: unknown;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
}

interface FixtureStatusEventRow {
  id: string;
  jobId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  occurredAt: Date;
}

type FixturePhase = "prepared" | "mutated";
type ExpectedFixturePhase = FixturePhase | "prepared-or-mutated";

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate === "object" && candidate !== null) {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function exactInstant(value: string, name: string): Date {
  if (!INSTANT_PATTERN.test(value)) {
    throw new Error(`${name} must be an exact UTC millisecond timestamp`);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(`${name} must be an exact UTC millisecond timestamp`);
  }
  return instant;
}

export function parseJobSearchAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): JobSearchAcceptanceInput {
  if (environment.JOB_SEARCH_ACCEPTANCE_CONFIRM !== JOB_SEARCH_ACCEPTANCE_CONFIRMATION) {
    throw new Error("The generated-synthetic acceptance confirmation is required");
  }
  const action = environment.JOB_SEARCH_ACCEPTANCE_ACTION;
  if (action !== "prepare" && action !== "mutate" && action !== "cleanup") {
    throw new Error("The job-search acceptance action is invalid");
  }
  const runId = environment.JOB_SEARCH_ACCEPTANCE_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("The job-search acceptance run ID must be a lowercase UUID v4 or v7");
  }
  const atValue = environment.JOB_SEARCH_ACCEPTANCE_AT;
  if (action === "cleanup") {
    if (atValue !== undefined) {
      throw new Error("Cleanup must not accept an acceptance timestamp");
    }
    return { action, runId };
  }
  if (!atValue) {
    throw new Error("The acceptance timestamp is required");
  }
  return { action, runId, at: exactInstant(atValue, "JOB_SEARCH_ACCEPTANCE_AT") };
}

export function assertRecentJobSearchAcceptanceTime(at: Date, now: Date = new Date()): void {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    Math.abs(now.getTime() - at.getTime()) > MAX_CLOCK_SKEW_MS
  ) {
    throw new Error("The job-search acceptance timestamp is outside the bounded clock window");
  }
}

export function buildJobSearchAcceptanceFixture(
  runId: string,
  observedAt: Date,
): AcceptanceFixture {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("The job-search acceptance run ID must be a lowercase UUID v4 or v7");
  }
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("The job-search acceptance timestamp is invalid");
  }
  const compactRunId = runId.replaceAll("-", "");
  const queryToken = `d1search${compactRunId}`;
  const shortRunId = compactRunId.slice(0, 12);
  const companyName = `ApplyDash Synthetic Search Fixture ${shortRunId}`;
  const normalizedCompanyName = companyName.toLocaleLowerCase("en-US");
  const verifiedCompanyDomain = `search-${shortRunId}.example.test`;
  const companyId = uuidv5("company", runId);
  const definitions = [
    {
      slug: "alpha" as const,
      matchesQuery: true,
      title: "Synthetic Search Fixture Alpha",
      description: `${queryToken} generated synthetic pagination fixture alpha.`,
      publicTruth: true,
    },
    {
      slug: "bravo" as const,
      matchesQuery: true,
      title: "Synthetic Search Fixture Bravo",
      description: `${queryToken} generated synthetic pagination fixture bravo.`,
      publicTruth: true,
    },
    {
      slug: "sentinel" as const,
      matchesQuery: false,
      title: "Synthetic Catalog Revision Sentinel",
      description: "Generated synthetic catalog revision sentinel for bounded acceptance.",
      publicTruth: false,
    },
  ];
  return {
    companyId,
    companyName,
    normalizedCompanyName,
    verifiedCompanyDomain,
    queryToken,
    jobs: definitions.map((definition) => ({
      sourceId: uuidv5(`source:${definition.slug}`, runId),
      slug: definition.slug,
      matchesQuery: definition.matchesQuery,
      observation: canonicalizeObservation({
        provider: "other",
        provenance: "authorized_fixture",
        companyName,
        title: definition.title,
        locations: definition.publicTruth ? ["Synthetic City, NY, US"] : ["Synthetic Remote"],
        description: definition.description,
        sourceUrl: `https://jobs.example.test/d1-search-acceptance/${runId}/${definition.slug}`,
        observedAt,
        externalJobId: `d1-search-${runId}-${definition.slug}`,
        employerRequisitionId: `d1-search-${runId}-${definition.slug}`,
        verifiedCompanyDomain,
        department: "Synthetic Acceptance",
        ...(definition.publicTruth
          ? {
              workMode: definition.slug === "alpha" ? ("on_site" as const) : ("hybrid" as const),
              employmentType: "full_time" as const,
              datePosted: new Date(observedAt.getTime() - 7 * 24 * 60 * 60 * 1_000),
              applicationUrl: `https://jobs.example.test/d1-search-acceptance/${runId}/${definition.slug}/application`,
              structuredLocations: [
                {
                  address: {
                    addressCountry: "US",
                    addressLocality: "Synthetic City",
                    addressRegion: "NY",
                  },
                },
              ],
            }
          : {}),
        adapterVersion: ACCEPTANCE_ADAPTER_VERSION,
      }),
    })),
  };
}

async function getRevision(transaction: postgres.TransactionSql): Promise<string> {
  const [state] = await transaction<{ revision: string }[]>`
    SELECT revision::text AS revision
    FROM jobs.catalog_search_state
    WHERE singleton = true
  `;
  if (!state || !/^[1-9]\d*$/.test(state.revision)) {
    throw new Error("The job-search catalog revision is unavailable");
  }
  return state.revision;
}

async function assertSearchMigration(transaction: postgres.TransactionSql): Promise<void> {
  const [migration] = await transaction<{ checksum: string }[]>`
    SELECT checksum
    FROM jobs.schema_migrations
    WHERE version = ${JOB_SEARCH_MIGRATION_VERSION}
  `;
  if (!migration || migration.checksum !== JOB_SEARCH_MIGRATION_SHA256) {
    throw new Error("The exact job-search migration is not applied");
  }
}

async function readFixtureRows(
  transaction: postgres.TransactionSql,
  fixture: AcceptanceFixture,
): Promise<FixtureRow[]> {
  const sourceIds = fixture.jobs.map((job) => job.sourceId);
  return transaction<FixtureRow[]>`
    SELECT
      job.id,
      job.company_id AS "companyId",
      company.display_name AS "companyName",
      company.normalized_name AS "normalizedCompanyName",
      company.verified_domain AS "companyVerifiedDomain",
      company.created_at AS "companyCreatedAt",
      company.updated_at AS "companyUpdatedAt",
      job.title,
      job.normalized_title AS "normalizedTitle",
      job.locations,
      job.normalized_locations AS "normalizedLocations",
      job.department,
      job.normalized_department AS "normalizedDepartment",
      job.description,
      job.description_hash AS "descriptionHash",
      job.dedupe_fingerprint AS "dedupeFingerprint",
      job.status,
      job.status_reason AS "statusReason",
      job.first_observed_at AS "firstObservedAt",
      job.last_verified_at AS "lastVerifiedAt",
      job.expires_at AS "expiresAt",
      job.valid_through AS "validThrough",
      job.work_mode AS "workMode",
      job.employment_type AS "employmentType",
      job.date_posted AS "datePosted",
      job.application_url AS "applicationUrl",
      job.structured_locations AS "structuredLocations",
      job.consecutive_verification_failures AS "consecutiveVerificationFailures",
      job.created_at AS "jobCreatedAt",
      job.updated_at AS "jobUpdatedAt",
      source.id AS "sourceId",
      source.provider,
      source.provenance,
      source.ats_tenant AS "atsTenant",
      source.source_url AS "sourceUrl",
      source.canonical_url AS "canonicalUrl",
      source.canonical_url_hash AS "canonicalUrlHash",
      source.content_hash AS "contentHash",
      source.verified_company_domain AS "sourceVerifiedCompanyDomain",
      source.external_job_id AS "externalJobId",
      source.employer_requisition_id AS "employerRequisitionId",
      source.adapter_version AS "adapterVersion",
      source.raw_snapshot AS "rawSnapshot",
      source.first_observed_at AS "sourceFirstObservedAt",
      source.last_observed_at AS "sourceLastObservedAt",
      source.last_verified_at AS "sourceLastVerifiedAt",
      source.valid_through AS "sourceValidThrough",
      source.date_posted AS "sourceDatePosted",
      source.application_url AS "sourceApplicationUrl",
      source.structured_locations AS "sourceStructuredLocations",
      source.created_at AS "sourceCreatedAt",
      source.updated_at AS "sourceUpdatedAt"
    FROM jobs.canonical_jobs AS job
    INNER JOIN jobs.companies AS company ON company.id = job.company_id
    INNER JOIN jobs.job_sources AS source ON source.job_id = job.id
    WHERE source.id = ANY(${transaction.array(sourceIds)}::uuid[])
    ORDER BY job.id
  `;
}

async function assertExactFixture(
  transaction: postgres.TransactionSql,
  fixture: AcceptanceFixture,
  runId: string,
  expectedPhase: ExpectedFixturePhase,
  inferObservedAt = false,
): Promise<FixtureRow[]> {
  const rows = await readFixtureRows(transaction, fixture);
  if (rows.length !== JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT) {
    throw new Error("The claimed job-search acceptance fixture is incomplete");
  }
  const observedAt = rows[0]?.firstObservedAt;
  if (!observedAt || !Number.isFinite(observedAt.getTime())) {
    throw new Error("The claimed job-search acceptance fixture has an invalid observed timestamp");
  }
  const expectedFixture = inferObservedAt
    ? buildJobSearchAcceptanceFixture(runId, observedAt)
    : fixture;
  const contractObservedAt = expectedFixture.jobs[0]?.observation.observedAt;
  if (!contractObservedAt || contractObservedAt.getTime() !== observedAt.getTime()) {
    throw new Error(
      "The claimed job-search acceptance fixture has an unexpected observed timestamp",
    );
  }
  const bySourceId = new Map(rows.map((row) => [row.sourceId, row]));
  const sentinel = expectedFixture.jobs.find((job) => job.slug === "sentinel");
  const sentinelRow = sentinel ? bySourceId.get(sentinel.sourceId) : undefined;
  const matchingRows = expectedFixture.jobs
    .filter((job) => job.matchesQuery)
    .map((job) => bySourceId.get(job.sourceId));
  if (!sentinelRow) {
    throw new Error("The claimed job-search acceptance fixture has no sentinel");
  }
  const matchingRowsArePrepared = matchingRows.every((row) => row?.statusReason === SEEDED_REASON);
  const actualPhase: FixturePhase | undefined =
    matchingRowsArePrepared && sentinelRow?.statusReason === SEEDED_REASON
      ? "prepared"
      : matchingRowsArePrepared && sentinelRow?.statusReason === MUTATED_REASON
        ? "mutated"
        : undefined;
  if (!actualPhase || (expectedPhase !== "prepared-or-mutated" && actualPhase !== expectedPhase)) {
    throw new Error("The claimed job-search acceptance fixture is not in its exact expected phase");
  }
  const mutationAt = actualPhase === "mutated" ? sentinelRow.lastVerifiedAt : undefined;
  if (
    mutationAt &&
    (!Number.isFinite(mutationAt.getTime()) ||
      mutationAt.getTime() !== observedAt.getTime() + MUTATION_OFFSET_MS ||
      mutationAt >= sentinelRow.expiresAt)
  ) {
    throw new Error("The claimed job-search acceptance fixture has an invalid mutation timestamp");
  }
  const sameInstant = (value: Date, expected: Date): boolean =>
    Number.isFinite(value?.getTime()) && value.getTime() === expected.getTime();
  for (const expected of expectedFixture.jobs) {
    const row = bySourceId.get(expected.sourceId);
    const observation = expected.observation;
    const rowMutableAt = expected.slug === "sentinel" && mutationAt ? mutationAt : observedAt;
    const expectedStatusReason =
      expected.slug === "sentinel" && actualPhase === "mutated" ? MUTATED_REASON : SEEDED_REASON;
    if (
      !row ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
      row.companyId !== fixture.companyId ||
      row.companyName !== fixture.companyName ||
      row.normalizedCompanyName !== fixture.normalizedCompanyName ||
      row.companyVerifiedDomain !== fixture.verifiedCompanyDomain ||
      !sameInstant(row.companyCreatedAt, observedAt) ||
      !sameInstant(row.companyUpdatedAt, observedAt) ||
      row.title !== observation.title ||
      row.normalizedTitle !== observation.normalizedTitle ||
      JSON.stringify(row.locations) !== JSON.stringify(observation.locations) ||
      JSON.stringify(row.normalizedLocations) !== JSON.stringify(observation.normalizedLocations) ||
      row.department !== (observation.department ?? null) ||
      row.normalizedDepartment !== (observation.normalizedDepartment ?? null) ||
      row.description !== observation.description ||
      row.descriptionHash !== observation.contentHash ||
      row.dedupeFingerprint !== observation.fuzzyFingerprint ||
      row.status !== "active" ||
      row.statusReason !== expectedStatusReason ||
      !sameInstant(row.firstObservedAt, observedAt) ||
      !sameInstant(row.lastVerifiedAt, rowMutableAt) ||
      !sameInstant(row.expiresAt, observation.expiresAt) ||
      row.validThrough !== null ||
      row.workMode !== (observation.workMode ?? null) ||
      row.employmentType !== (observation.employmentType ?? null) ||
      (row.datePosted === null) !== (observation.datePosted === undefined) ||
      (row.datePosted !== null &&
        observation.datePosted !== undefined &&
        !sameInstant(row.datePosted, observation.datePosted)) ||
      row.applicationUrl !== (observation.applicationUrl ?? null) ||
      canonicalJson(row.structuredLocations) !==
        canonicalJson(observation.structuredLocations ?? null) ||
      row.consecutiveVerificationFailures !== 0 ||
      !sameInstant(row.jobCreatedAt, observedAt) ||
      !sameInstant(row.jobUpdatedAt, rowMutableAt) ||
      row.sourceId !== expected.sourceId ||
      row.provider !== "other" ||
      row.provenance !== "authorized_fixture" ||
      row.atsTenant !== null ||
      row.sourceUrl !== observation.canonicalUrl ||
      row.canonicalUrl !== observation.canonicalUrl ||
      row.canonicalUrlHash !== observation.canonicalUrlHash ||
      row.contentHash !== observation.contentHash ||
      row.sourceVerifiedCompanyDomain !== observation.verifiedCompanyDomain ||
      row.externalJobId !== observation.externalJobId ||
      row.employerRequisitionId !== observation.employerRequisitionId ||
      row.adapterVersion !== ACCEPTANCE_ADAPTER_VERSION ||
      row.rawSnapshot !== null ||
      !sameInstant(row.sourceFirstObservedAt, observedAt) ||
      !sameInstant(row.sourceLastObservedAt, rowMutableAt) ||
      !sameInstant(row.sourceLastVerifiedAt, rowMutableAt) ||
      row.sourceValidThrough !== null ||
      (row.sourceDatePosted === null) !== (observation.datePosted === undefined) ||
      (row.sourceDatePosted !== null &&
        observation.datePosted !== undefined &&
        !sameInstant(row.sourceDatePosted, observation.datePosted)) ||
      row.sourceApplicationUrl !== (observation.applicationUrl ?? null) ||
      canonicalJson(row.sourceStructuredLocations) !==
        canonicalJson(observation.structuredLocations ?? null) ||
      !sameInstant(row.sourceCreatedAt, observedAt) ||
      !sameInstant(row.sourceUpdatedAt, rowMutableAt)
    ) {
      throw new Error(
        "The claimed job-search acceptance fixture does not match its exact contract",
      );
    }
  }
  const jobIds = rows.map((row) => row.id);
  const [related] = await transaction<
    { companyJobCount: number; sourceCount: number; eventCount: number; duplicateCount: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM jobs.canonical_jobs
        WHERE company_id = ${fixture.companyId}) AS "companyJobCount",
      (SELECT count(*)::int FROM jobs.job_sources
        WHERE job_id = ANY(${transaction.array(jobIds)}::uuid[])) AS "sourceCount",
      (SELECT count(*)::int FROM jobs.status_events
        WHERE job_id = ANY(${transaction.array(jobIds)}::uuid[])) AS "eventCount",
      (SELECT count(*)::int FROM jobs.duplicate_candidates
        WHERE job_id = ANY(${transaction.array(jobIds)}::uuid[])
           OR candidate_job_id = ANY(${transaction.array(jobIds)}::uuid[])) AS "duplicateCount"
  `;
  if (
    related?.companyJobCount !== JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT ||
    related.sourceCount !== JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT ||
    related.eventCount !== JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT ||
    related.duplicateCount !== 0
  ) {
    throw new Error("The claimed job-search acceptance fixture has unexpected related records");
  }
  const events = await transaction<FixtureStatusEventRow[]>`
    SELECT id, job_id AS "jobId", from_status AS "fromStatus", to_status AS "toStatus",
      reason, occurred_at AS "occurredAt"
    FROM jobs.status_events
    WHERE job_id = ANY(${transaction.array(jobIds)}::uuid[])
    ORDER BY job_id, id
  `;
  const eventsByJobId = new Map(events.map((event) => [event.jobId, event]));
  for (const row of rows) {
    const event = eventsByJobId.get(row.id);
    if (
      !event ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id) ||
      event.fromStatus !== null ||
      event.toStatus !== "active" ||
      event.reason !== SEEDED_REASON ||
      !sameInstant(event.occurredAt, observedAt)
    ) {
      throw new Error("The claimed job-search acceptance fixture has an unexpected status event");
    }
  }
  return rows;
}

async function prepareFixture(
  transaction: postgres.TransactionSql,
  fixture: AcceptanceFixture,
  runId: string,
): Promise<number> {
  const sourceIds = fixture.jobs.map((job) => job.sourceId);
  const [existing] = await transaction<
    { companyCount: number; jobCount: number; sourceCount: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM jobs.companies WHERE id = ${fixture.companyId}) AS "companyCount",
      (SELECT count(*)::int FROM jobs.canonical_jobs AS job
        INNER JOIN jobs.job_sources AS source ON source.job_id = job.id
        WHERE source.id = ANY(${transaction.array(sourceIds)}::uuid[])) AS "jobCount",
      (SELECT count(*)::int FROM jobs.job_sources
        WHERE id = ANY(${transaction.array(sourceIds)}::uuid[])) AS "sourceCount"
  `;
  if (existing?.companyCount !== 0 || existing.jobCount !== 0 || existing.sourceCount !== 0) {
    throw new Error("The job-search acceptance run ID has already been used");
  }
  const firstJob = fixture.jobs[0];
  if (!firstJob) {
    throw new Error("The job-search acceptance fixture definition is incomplete");
  }
  await transaction`
    INSERT INTO jobs.companies (
      id, display_name, normalized_name, verified_domain, created_at, updated_at
    ) VALUES (
      ${fixture.companyId}, ${fixture.companyName}, ${fixture.normalizedCompanyName},
      ${fixture.verifiedCompanyDomain}, ${firstJob.observation.observedAt},
      ${firstJob.observation.observedAt}
    )
  `;
  for (const job of fixture.jobs) {
    const observation = job.observation;
    const jobId = uuidv7();
    const statusEventId = uuidv7();
    await transaction`
      INSERT INTO jobs.canonical_jobs (
        id, company_id, title, normalized_title, locations, normalized_locations,
        department, normalized_department, work_mode, employment_type,
        description, description_hash,
        dedupe_fingerprint, status, status_reason, first_observed_at, last_verified_at,
        expires_at, valid_through, date_posted, application_url, structured_locations,
        consecutive_verification_failures, created_at, updated_at
      ) VALUES (
        ${jobId}, ${fixture.companyId}, ${observation.title}, ${observation.normalizedTitle},
        ${transaction.json(observation.locations)},
        ${transaction.array(observation.normalizedLocations)},
        ${observation.department ?? null}, ${observation.normalizedDepartment ?? null},
        ${observation.workMode ?? null}, ${observation.employmentType ?? null},
        ${observation.description}, ${observation.contentHash}, ${observation.fuzzyFingerprint},
        'active', ${SEEDED_REASON}, ${observation.observedAt}, ${observation.observedAt},
        ${observation.expiresAt}, ${observation.validThrough ?? null},
        ${observation.datePosted ?? null}, ${observation.applicationUrl ?? null},
        ${
          observation.structuredLocations
            ? transaction.json(observation.structuredLocations as unknown as postgres.JSONValue)
            : null
        }::jsonb,
        0,
        ${observation.observedAt}, ${observation.observedAt}
      )
    `;
    await transaction`
      INSERT INTO jobs.job_sources (
        id, job_id, provider, provenance, external_job_id, employer_requisition_id,
        verified_company_domain, source_url, canonical_url, canonical_url_hash, content_hash,
        adapter_version, raw_snapshot, first_observed_at, last_observed_at, last_verified_at,
        valid_through, date_posted, application_url, structured_locations, created_at, updated_at
      ) VALUES (
        ${job.sourceId}, ${jobId}, 'other', 'authorized_fixture',
        ${observation.externalJobId ?? null}, ${observation.employerRequisitionId ?? null},
        ${observation.verifiedCompanyDomain ?? null}, ${observation.canonicalUrl},
        ${observation.canonicalUrl}, ${observation.canonicalUrlHash}, ${observation.contentHash},
        ${ACCEPTANCE_ADAPTER_VERSION}, NULL, ${observation.observedAt},
        ${observation.observedAt}, ${observation.observedAt},
        ${observation.validThrough ?? null}, ${observation.datePosted ?? null},
        ${observation.applicationUrl ?? null},
        ${
          observation.structuredLocations
            ? transaction.json(observation.structuredLocations as unknown as postgres.JSONValue)
            : null
        }::jsonb,
        ${observation.observedAt}, ${observation.observedAt}
      )
    `;
    await transaction`
      INSERT INTO jobs.status_events (
        id, job_id, from_status, to_status, reason, occurred_at
      ) VALUES (
        ${statusEventId}, ${jobId}, NULL, 'active', ${SEEDED_REASON},
        ${observation.observedAt}
      )
    `;
  }
  await assertExactFixture(transaction, fixture, runId, "prepared");
  return JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT;
}

async function mutateFixture(
  transaction: postgres.TransactionSql,
  fixture: AcceptanceFixture,
  runId: string,
  at: Date,
): Promise<number> {
  const rows = await assertExactFixture(transaction, fixture, runId, "prepared", true);
  const sentinel = fixture.jobs.find((job) => job.slug === "sentinel");
  const current = sentinel ? rows.find((row) => row.sourceId === sentinel.sourceId) : undefined;
  if (!sentinel || !current || current.statusReason !== SEEDED_REASON) {
    throw new Error("The job-search acceptance sentinel is not in its prepared state");
  }
  if (
    at.getTime() !== current.lastVerifiedAt.getTime() + MUTATION_OFFSET_MS ||
    at >= current.expiresAt
  ) {
    throw new Error("The job-search acceptance mutation timestamp is outside the fixture lifetime");
  }
  const updated = await transaction`
    UPDATE jobs.canonical_jobs
    SET status_reason = ${MUTATED_REASON}, last_verified_at = ${at}, updated_at = ${at}
    WHERE id = ${current.id} AND status = 'active' AND status_reason = ${SEEDED_REASON}
  `;
  if (updated.count !== 1) {
    throw new Error("The job-search acceptance sentinel mutation was not exclusive");
  }
  const sourceUpdated = await transaction`
    UPDATE jobs.job_sources
    SET last_observed_at = ${at}, last_verified_at = ${at}, updated_at = ${at}
    WHERE id = ${sentinel.sourceId} AND job_id = ${current.id}
  `;
  if (sourceUpdated.count !== 1) {
    throw new Error("The job-search acceptance source mutation was not exclusive");
  }
  const after = await assertExactFixture(transaction, fixture, runId, "mutated", true);
  if (after.find((row) => row.sourceId === sentinel.sourceId)?.statusReason !== MUTATED_REASON) {
    throw new Error("The job-search acceptance sentinel mutation was not retained");
  }
  return 1;
}

async function cleanupFixture(
  transaction: postgres.TransactionSql,
  fixture: AcceptanceFixture,
  runId: string,
): Promise<number> {
  const rows = await assertExactFixture(transaction, fixture, runId, "prepared-or-mutated", true);
  const jobIds = rows.map((row) => row.id);
  const deleted = await transaction`
    DELETE FROM jobs.canonical_jobs
    WHERE id = ANY(${transaction.array(jobIds)}::uuid[])
  `;
  if (deleted.count !== JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT) {
    throw new Error("The job-search acceptance cleanup did not remove exactly its claimed jobs");
  }
  const deletedCompany = await transaction`
    DELETE FROM jobs.companies
    WHERE id = ${fixture.companyId}
      AND NOT EXISTS (
        SELECT 1 FROM jobs.canonical_jobs WHERE company_id = ${fixture.companyId}
      )
  `;
  if (deletedCompany.count !== 1 || (await readFixtureRows(transaction, fixture)).length !== 0) {
    throw new Error("The job-search acceptance cleanup did not remove its exact fixture boundary");
  }
  const sourceIds = fixture.jobs.map((job) => job.sourceId);
  const [remaining] = await transaction<
    { companyCount: number; jobCount: number; sourceCount: number; eventCount: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM jobs.companies WHERE id = ${fixture.companyId}) AS "companyCount",
      (SELECT count(*)::int FROM jobs.canonical_jobs
        WHERE id = ANY(${transaction.array(jobIds)}::uuid[])) AS "jobCount",
      (SELECT count(*)::int FROM jobs.job_sources
        WHERE id = ANY(${transaction.array(sourceIds)}::uuid[])) AS "sourceCount",
      (SELECT count(*)::int FROM jobs.status_events
        WHERE job_id = ANY(${transaction.array(jobIds)}::uuid[])) AS "eventCount"
  `;
  if (
    remaining?.companyCount !== 0 ||
    remaining.jobCount !== 0 ||
    remaining.sourceCount !== 0 ||
    remaining.eventCount !== 0
  ) {
    throw new Error("The job-search acceptance cleanup left claimed fixture records behind");
  }
  return JOB_SEARCH_ACCEPTANCE_FIXTURE_COUNT;
}

export async function executeJobSearchAcceptance(
  client: postgres.Sql,
  input: JobSearchAcceptanceInput,
): Promise<JobSearchAcceptanceResult> {
  const fixtureAt = input.at ?? new Date(0);
  const fixture = buildJobSearchAcceptanceFixture(input.runId, fixtureAt);
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${`jobs:search-acceptance:${input.runId}`}))
    `;
    await assertSearchMigration(transaction);
    const revisionBefore = await getRevision(transaction);
    let affectedJobs: number;
    switch (input.action) {
      case "prepare":
        if (!input.at) {
          throw new Error("Prepare requires an acceptance timestamp");
        }
        affectedJobs = await prepareFixture(transaction, fixture, input.runId);
        break;
      case "mutate":
        if (!input.at) {
          throw new Error("Mutate requires an acceptance timestamp");
        }
        affectedJobs = await mutateFixture(transaction, fixture, input.runId, input.at);
        break;
      case "cleanup":
        affectedJobs = await cleanupFixture(transaction, fixture, input.runId);
        break;
    }
    const revisionAfter = await getRevision(transaction);
    if (BigInt(revisionAfter) <= BigInt(revisionBefore)) {
      throw new Error("The job-search acceptance action did not advance the catalog revision");
    }
    return {
      schemaVersion: JOB_SEARCH_ACCEPTANCE_SCHEMA_VERSION,
      action: input.action,
      runId: input.runId,
      queryToken: fixture.queryToken,
      revisionBefore,
      revisionAfter,
      affectedJobs,
    };
  });
}
