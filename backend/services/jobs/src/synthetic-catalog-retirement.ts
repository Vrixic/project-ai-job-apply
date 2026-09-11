import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { canonicalizeObservation, normalizeText } from "./domain/canonical-job.js";

export const syntheticCatalogRetirementReason = "development_synthetic_catalog_retired_v1";
const adapterVersion = "synthetic-ingestion-v1";
const maximumJobs = 100;
const maximumSnapshotBytes = 8 * 1_024 * 1_024;
const digestPattern = /^[a-f0-9]{64}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sourcePattern =
  /^https:\/\/jobs\.example\.test\/source-neutral\/([a-z0-9]{8,64})\/(systems-engineer|reliability-engineer)$/u;
const retirableStatuses = new Set(["pending", "active", "suspect_stale"]);
const terminalStatuses = new Set(["expired", "withdrawn", "blocked"]);

export type SyntheticCatalogRetirementInput =
  | Readonly<{ action: "inspect" }>
  | Readonly<{ action: "retire"; expectedManifestSha256: string }>;

export interface SyntheticCatalogRetirementResult {
  schemaVersion: 1;
  action: "inspect" | "retire";
  namespace: "synthetic-foundation-v1";
  manifestSha256: string;
  matchingJobs: number;
  matchingSources: number;
  retirableJobs: number;
  alreadyHiddenJobs: number;
  retiredJobs: number;
  appendedStatusEvents: number;
  otherActiveAuthorizedFixtureJobs: number;
}

/** SQL JSON projections remain private; JSON timestamps retain PostgreSQL precision. */
export interface SyntheticCatalogRetirementRow {
  job: Record<string, unknown>;
  company: Record<string, unknown>;
  sources: Record<string, unknown>[];
  sourceCount: number;
  duplicateBinding: boolean;
  contributionBinding: boolean;
}

function refuse(): never {
  throw new Error("SyntheticCatalogRetirementRejected");
}

function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry === "object" && entry !== null) {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

function exact(actual: unknown, expected: unknown): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) refuse();
}

function validateInput(input: SyntheticCatalogRetirementInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse();
  if (input.action === "inspect") {
    exact(Object.keys(input).sort(), ["action"]);
  } else if (input.action === "retire") {
    exact(Object.keys(input).sort(), ["action", "expectedManifestSha256"]);
    if (
      typeof input.expectedManifestSha256 !== "string" ||
      !digestPattern.test(input.expectedManifestSha256)
    )
      refuse();
  } else {
    refuse();
  }
}

export function parseSyntheticCatalogRetirementEnvironment(
  environment: NodeJS.ProcessEnv,
): SyntheticCatalogRetirementInput {
  const prefix = "SYNTHETIC_CATALOG_RETIREMENT_";
  const allowed = new Set([
    `${prefix}ENVIRONMENT`,
    `${prefix}CONFIRMATION`,
    `${prefix}ACTION`,
    `${prefix}EXPECTED_MANIFEST_SHA256`,
  ]);
  if (
    Object.keys(environment).some((key) => key.startsWith(prefix) && !allowed.has(key)) ||
    environment.SYNTHETIC_CATALOG_RETIREMENT_ENVIRONMENT !== "development" ||
    environment.SYNTHETIC_CATALOG_RETIREMENT_CONFIRMATION !==
      "retain-generated-source-neutral-history"
  )
    refuse();
  const action = environment.SYNTHETIC_CATALOG_RETIREMENT_ACTION;
  const expectedManifestSha256 = environment.SYNTHETIC_CATALOG_RETIREMENT_EXPECTED_MANIFEST_SHA256;
  if (action === "inspect" && expectedManifestSha256 === undefined) return { action };
  if (action === "retire" && expectedManifestSha256 !== undefined) {
    const input = { action, expectedManifestSha256 } as const;
    validateInput(input);
    return input;
  }
  return refuse();
}

function validateRow(row: SyntheticCatalogRetirementRow): void {
  const { job, company, sources } = row;
  if (
    row.sourceCount !== 1 ||
    sources.length !== 1 ||
    row.duplicateBinding !== false ||
    row.contributionBinding !== false ||
    typeof job.id !== "string" ||
    !uuidPattern.test(job.id) ||
    typeof company.id !== "string" ||
    !uuidPattern.test(company.id)
  )
    refuse();
  const source = sources[0];
  if (
    !source ||
    typeof source.id !== "string" ||
    !uuidPattern.test(source.id) ||
    typeof source.canonical_url !== "string"
  )
    refuse();
  const match = sourcePattern.exec(source.canonical_url);
  const seed = match?.[1];
  const slug = match?.[2];
  if (!seed || !slug) refuse();
  const systems = slug === "systems-engineer";
  // Mirrors only the two fixed templates in ingestion/src/synthetic.ts. Importing the
  // ingestion worker here would invert the existing worker -> Jobs ownership boundary.
  const observation = canonicalizeObservation({
    provider: "other",
    provenance: "authorized_fixture",
    companyName: `Generated Synthetic Company ${seed}`,
    title: systems ? "Generated Systems Engineer" : "Generated Reliability Engineer",
    locations: [systems ? "Remote - US" : "Synthetic City, NY"],
    description: systems
      ? "Generated synthetic job content for deterministic source-neutral ingestion verification."
      : "Generated synthetic reliability content with no provider, employer, or candidate data.",
    department: systems ? "Synthetic Engineering" : "Synthetic Reliability",
    sourceUrl: source.canonical_url,
    observedAt: new Date(0),
  });
  const expectedSource = {
    job_id: job.id,
    provider: "other",
    provenance: "authorized_fixture",
    ats_tenant: `synthetic-${seed}`,
    external_job_id: `generated-job-${systems ? 1 : 2}`,
    employer_requisition_id: `generated-${seed}-${systems ? 1 : 2}`,
    verified_company_domain: `${seed}.example.test`,
    source_url: observation.canonicalUrl,
    canonical_url: observation.canonicalUrl,
    canonical_url_hash: observation.canonicalUrlHash,
    content_hash: observation.contentHash,
    adapter_version: adapterVersion,
    date_posted: null,
    application_url: null,
    structured_locations: null,
  };
  for (const [key, value] of Object.entries(expectedSource)) exact(source[key], value);
  exact(company.display_name, observation.companyName);
  exact(company.normalized_name, observation.normalizedCompanyName);
  exact(company.verified_domain, `${seed}.example.test`);
  const expectedJob = {
    company_id: company.id,
    title: observation.title,
    normalized_title: observation.normalizedTitle,
    locations: observation.locations,
    normalized_locations: observation.normalizedLocations,
    department: observation.department,
    normalized_department: normalizeText(observation.department ?? ""),
    work_mode: systems ? "remote" : "hybrid",
    employment_type: "full_time",
    dedupe_fingerprint: observation.fuzzyFingerprint,
    date_posted: null,
    application_url: null,
    structured_locations: null,
  };
  for (const [key, value] of Object.entries(expectedJob)) exact(job[key], value);
  if (
    typeof job.status !== "string" ||
    (!retirableStatuses.has(job.status) && !terminalStatuses.has(job.status))
  )
    refuse();
  if (job.description === null && terminalStatuses.has(job.status)) {
    exact(job.description_hash, null);
  } else {
    exact(job.description, observation.description);
    exact(job.description_hash, observation.contentHash);
  }
}

/** Pure validation for both Inspect and the locked Retire re-read; never returns row data. */
export function inspectSyntheticCatalogRetirementRows(
  rows: readonly SyntheticCatalogRetirementRow[],
): Omit<
  SyntheticCatalogRetirementResult,
  "action" | "retiredJobs" | "appendedStatusEvents" | "otherActiveAuthorizedFixtureJobs"
> {
  if (!Array.isArray(rows) || rows.length > maximumJobs) refuse();
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  for (const row of rows) {
    validateRow(row);
    const id = row.job.id as string;
    const sourceId = row.sources[0]?.id as string;
    if (ids.has(id) || sourceIds.has(sourceId)) refuse();
    ids.add(id);
    sourceIds.add(sourceId);
  }
  const sorted = [...rows].sort((left, right) =>
    String(left.job.id).localeCompare(String(right.job.id)),
  );
  const snapshot = canonicalJson(sorted);
  if (Buffer.byteLength(snapshot, "utf8") > maximumSnapshotBytes) refuse();
  const retirableJobs = rows.filter((row) => retirableStatuses.has(String(row.job.status))).length;
  return {
    schemaVersion: 1,
    namespace: "synthetic-foundation-v1",
    manifestSha256: createHash("sha256")
      .update("jobs-synthetic-catalog-retirement/v1\n")
      .update(snapshot)
      .digest("hex"),
    matchingJobs: rows.length,
    matchingSources: sourceIds.size,
    retirableJobs,
    alreadyHiddenJobs: rows.length - retirableJobs,
  };
}

async function readRows(
  transaction: postgres.TransactionSql,
): Promise<SyntheticCatalogRetirementRow[]> {
  // Namespace hints discover candidates, but are never sufficient permission to mutate one.
  return transaction<SyntheticCatalogRetirementRow[]>`
    SELECT to_jsonb(job) - 'search_document' AS job, to_jsonb(company) AS company,
      (SELECT count(*)::integer FROM jobs.job_sources AS source WHERE source.job_id = job.id) AS "sourceCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(source) ORDER BY source.id) FROM
        (SELECT * FROM jobs.job_sources WHERE job_id = job.id ORDER BY id LIMIT 2) AS source), '[]'::jsonb) AS sources,
      EXISTS (SELECT 1 FROM jobs.duplicate_candidates AS duplicate WHERE duplicate.job_id = job.id
        OR duplicate.candidate_job_id = job.id OR duplicate.canonical_job_id = job.id) AS "duplicateBinding",
      (EXISTS (SELECT 1 FROM jobs.job_contribution_independent_verifications AS verification
        WHERE verification.job_id = job.id OR verification.source_id IN
          (SELECT id FROM jobs.job_sources WHERE job_id = job.id))
       OR EXISTS (SELECT 1 FROM jobs.job_contribution_reconciliations AS reconciliation
        WHERE reconciliation.job_id = job.id OR reconciliation.source_id IN
          (SELECT id FROM jobs.job_sources WHERE job_id = job.id))) AS "contributionBinding"
    FROM jobs.canonical_jobs AS job JOIN jobs.companies AS company ON company.id = job.company_id
    WHERE EXISTS (SELECT 1 FROM jobs.job_sources AS candidate WHERE candidate.job_id = job.id
      AND (candidate.adapter_version = ${adapterVersion}
        OR candidate.canonical_url LIKE 'https://jobs.example.test/source-neutral/%'
        OR candidate.source_url LIKE 'https://jobs.example.test/source-neutral/%'))
    ORDER BY job.id LIMIT ${maximumJobs + 1}
  `;
}

export async function executeSyntheticCatalogRetirement(
  client: postgres.Sql,
  input: SyntheticCatalogRetirementInput,
): Promise<SyntheticCatalogRetirementResult> {
  validateInput(input);
  return client.begin(
    input.action === "inspect"
      ? "isolation level repeatable read read only"
      : "isolation level serializable",
    async (transaction) => {
      await transaction`SET LOCAL statement_timeout = '15s'`;
      await transaction`SET LOCAL lock_timeout = '5s'`;
      await transaction`SET LOCAL timezone = 'UTC'`;
      const [outside] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM jobs.canonical_jobs AS job
        WHERE job.status = 'active' AND job.expires_at > statement_timestamp()
          AND job.description IS NOT NULL AND length(btrim(job.description)) > 0
          AND EXISTS (SELECT 1 FROM jobs.job_sources WHERE job_id = job.id AND provenance = 'authorized_fixture')
          AND NOT EXISTS (SELECT 1 FROM jobs.job_sources WHERE job_id = job.id
            AND (adapter_version = ${adapterVersion}
              OR canonical_url LIKE 'https://jobs.example.test/source-neutral/%'
              OR source_url LIKE 'https://jobs.example.test/source-neutral/%'))
      `;
      const otherActiveAuthorizedFixtureJobs = Number(outside?.count);
      if (
        !Number.isSafeInteger(otherActiveAuthorizedFixtureJobs) ||
        otherActiveAuthorizedFixtureJobs < 0
      )
        refuse();
      let rows = await readRows(transaction);
      inspectSyntheticCatalogRetirementRows(rows);
      if (input.action === "retire" && rows.length > 0) {
        const ids = rows.map((row) => row.job.id as string);
        await transaction`SELECT id FROM jobs.canonical_jobs WHERE id = ANY(${transaction.array(ids)}::uuid[]) ORDER BY id FOR UPDATE`;
        await transaction`SELECT id FROM jobs.job_sources WHERE job_id = ANY(${transaction.array(ids)}::uuid[]) ORDER BY id FOR UPDATE`;
        const companyIds = [...new Set(rows.map((row) => row.company.id as string))].sort();
        await transaction`SELECT id FROM jobs.companies WHERE id = ANY(${transaction.array(companyIds)}::uuid[]) ORDER BY id FOR SHARE`;
        // Canonical/source locks also exclude new FK-linked aliases and D2 publication links.
        rows = await readRows(transaction);
      }
      const inspection = inspectSyntheticCatalogRetirementRows(rows);
      if (input.action === "inspect")
        return {
          ...inspection,
          action: input.action,
          retiredJobs: 0,
          appendedStatusEvents: 0,
          otherActiveAuthorizedFixtureJobs,
        };
      if (inspection.manifestSha256 !== input.expectedManifestSha256) refuse();
      const targets = rows.filter((row) => retirableStatuses.has(String(row.job.status)));
      if (targets.length > 0) {
        const [revisionBefore] = await transaction<{ revision: string }[]>`
          SELECT revision::text AS revision FROM jobs.catalog_search_state WHERE singleton = true
        `;
        if (!revisionBefore || !/^[1-9][0-9]*$/u.test(revisionBefore.revision)) refuse();
        const targetIds = targets.map((row) => row.job.id as string);
        const changed = await transaction<{ id: string }[]>`
          UPDATE jobs.canonical_jobs
          SET status = 'blocked', status_reason = ${syntheticCatalogRetirementReason},
            updated_at = GREATEST(updated_at, statement_timestamp())
          WHERE id = ANY(${transaction.array(targetIds)}::uuid[]) AND status IN ('pending', 'active', 'suspect_stale')
          RETURNING id
        `;
        if (changed.length !== targets.length) refuse();
        for (const row of targets) {
          await transaction`
            INSERT INTO jobs.status_events (id, job_id, from_status, to_status, reason, occurred_at)
            SELECT ${uuidv7()}, id, ${String(row.job.status)}, 'blocked', ${syntheticCatalogRetirementReason}, updated_at
            FROM jobs.canonical_jobs WHERE id = ${String(row.job.id)}
          `;
        }
        const [revisionAfter] = await transaction<{ revision: string }[]>`
          SELECT revision::text AS revision FROM jobs.catalog_search_state WHERE singleton = true
        `;
        if (
          !revisionAfter ||
          BigInt(revisionAfter.revision) !== BigInt(revisionBefore.revision) + 1n
        )
          refuse();
        const after = await readRows(transaction);
        inspectSyntheticCatalogRetirementRows(after);
        exact(
          after.map((row) => row.job.id),
          rows.map((row) => row.job.id),
        );
        for (let index = 0; index < rows.length; index += 1) {
          const beforeRow = rows[index];
          const afterRow = after[index];
          if (!beforeRow || !afterRow) refuse();
          if (retirableStatuses.has(String(beforeRow.job.status))) {
            exact(afterRow.job.status, "blocked");
            exact(afterRow.job.status_reason, syntheticCatalogRetirementReason);
            // Compare a clone; retain every source/company/payload field and every
            // other canonical field, including full-precision observation clocks.
            exact(
              {
                ...afterRow,
                job: {
                  ...afterRow.job,
                  status: beforeRow.job.status,
                  status_reason: beforeRow.job.status_reason,
                  updated_at: beforeRow.job.updated_at,
                },
              },
              beforeRow,
            );
          } else {
            exact(afterRow, beforeRow);
          }
        }
      }
      return {
        ...inspection,
        action: input.action,
        retiredJobs: targets.length,
        appendedStatusEvents: targets.length,
        otherActiveAuthorizedFixtureJobs,
      };
    },
  );
}
