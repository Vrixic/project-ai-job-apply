import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IngestionSourceAdapter } from "./contract.js";
import { SourceRegistry } from "./registry.js";
import { SourceNeutralIngestionRunner } from "./runner.js";
import {
  GeneratedSyntheticIngestionAdapter,
  generatedSyntheticAdapterVersion,
  generatedSyntheticSourceId,
} from "./synthetic.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

interface PersistedFixtureRow {
  adapterVersion: string;
  atsTenant: string | null;
  companyId: string;
  companyName: string;
  consecutiveVerificationFailures: number;
  externalJobId: string | null;
  employmentType: string | null;
  firstObservedAt: Date;
  jobId: string;
  lastObservedAt: Date;
  lastVerifiedAt: Date;
  provider: string;
  provenance: string;
  rawSnapshot: unknown;
  sourceUrl: string;
  status: string;
  verifiedCompanyDomain: string | null;
  workMode: string | null;
}

describeWithDatabase("source-neutral ingestion through PostgresJobCatalog", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const catalog = new PostgresJobCatalog(client, {
    searchCursorKeys: { active: { id: "ingestion-integration-v1", key: Buffer.alloc(32, 7) } },
  });

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(
      new URL("../../../services/jobs/dist/src/migrate.js", import.meta.url),
    );
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    expect(first.stdout.trim()).toBe(
      "Jobs migrations through 0023_contribution_verification_refresh applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Jobs migrations through 0023_contribution_verification_refresh applied and verified.",
    );
    await catalog.ping();
  });

  afterAll(async () => {
    await catalog.close();
  });

  it("creates and idempotently revalidates only exact generated synthetic observations", async () => {
    const seed = randomUUID().replaceAll("-", "");
    const atsTenant = `synthetic-${seed}`;
    const companyName = `Generated Synthetic Company ${seed}`;
    const verifiedCompanyDomain = `${seed}.example.test`;
    const firstObservedAt = new Date("2026-08-16T00:00:00.000Z");
    const secondObservedAt = new Date("2026-08-16T01:00:00.000Z");
    const adapter = new GeneratedSyntheticIngestionAdapter(seed);
    const registry = new SourceRegistry([
      {
        sourceId: generatedSyntheticSourceId,
        provider: "other",
        provenance: "authorized_fixture",
        adapter,
        enabled: true,
      },
    ]);

    async function fixtureRows(): Promise<PersistedFixtureRow[]> {
      return client<PersistedFixtureRow[]>`
        SELECT
          source.adapter_version AS "adapterVersion",
          source.ats_tenant AS "atsTenant",
          company.id AS "companyId",
          company.display_name AS "companyName",
          job.consecutive_verification_failures AS "consecutiveVerificationFailures",
          job.employment_type AS "employmentType",
          source.external_job_id AS "externalJobId",
          source.first_observed_at AS "firstObservedAt",
          job.id AS "jobId",
          source.last_observed_at AS "lastObservedAt",
          source.last_verified_at AS "lastVerifiedAt",
          source.provider,
          source.provenance,
          source.raw_snapshot AS "rawSnapshot",
          source.source_url AS "sourceUrl",
          job.status,
          source.verified_company_domain AS "verifiedCompanyDomain",
          job.work_mode AS "workMode"
        FROM jobs.job_sources AS source
        INNER JOIN jobs.canonical_jobs AS job ON job.id = source.job_id
        INNER JOIN jobs.companies AS company ON company.id = job.company_id
        WHERE source.ats_tenant = ${atsTenant}
        ORDER BY source.external_job_id
      `;
    }

    async function cleanFixture(): Promise<void> {
      await client.begin(async (transaction) => {
        const rows = await transaction<PersistedFixtureRow[]>`
          SELECT
            source.adapter_version AS "adapterVersion",
            source.ats_tenant AS "atsTenant",
            company.id AS "companyId",
            company.display_name AS "companyName",
            job.consecutive_verification_failures AS "consecutiveVerificationFailures",
            job.employment_type AS "employmentType",
            source.external_job_id AS "externalJobId",
            source.first_observed_at AS "firstObservedAt",
            job.id AS "jobId",
            source.last_observed_at AS "lastObservedAt",
            source.last_verified_at AS "lastVerifiedAt",
            source.provider,
            source.provenance,
            source.raw_snapshot AS "rawSnapshot",
            source.source_url AS "sourceUrl",
            job.status,
            source.verified_company_domain AS "verifiedCompanyDomain",
            job.work_mode AS "workMode"
          FROM jobs.job_sources AS source
          INNER JOIN jobs.canonical_jobs AS job ON job.id = source.job_id
          INNER JOIN jobs.companies AS company ON company.id = job.company_id
          WHERE source.ats_tenant = ${atsTenant}
             OR source.verified_company_domain = ${verifiedCompanyDomain}
             OR company.display_name = ${companyName}
          FOR UPDATE OF source, job, company
        `;
        const expectedExternalIds = new Set(["generated-job-1", "generated-job-2"]);
        const ownsEveryRow =
          rows.length <= 2 &&
          new Set(rows.map((row) => row.jobId)).size === rows.length &&
          new Set(rows.map((row) => row.companyId)).size <= 1 &&
          rows.every(
            (row) =>
              row.atsTenant === atsTenant &&
              row.companyName === companyName &&
              row.provider === "other" &&
              row.provenance === "authorized_fixture" &&
              row.adapterVersion === generatedSyntheticAdapterVersion &&
              row.verifiedCompanyDomain === verifiedCompanyDomain &&
              row.externalJobId !== null &&
              expectedExternalIds.delete(row.externalJobId) &&
              row.sourceUrl.startsWith(`https://jobs.example.test/source-neutral/${seed}/`),
          );
        if (!ownsEveryRow) {
          throw new Error("Refusing to clean unrelated ingestion integration records");
        }
        const jobIds = rows.map((row) => row.jobId);
        const companyIds = [...new Set(rows.map((row) => row.companyId))];
        if (jobIds.length > 0) {
          await transaction`DELETE FROM jobs.canonical_jobs WHERE id = ANY(${jobIds})`;
        }
        if (companyIds.length > 0) {
          await transaction`
            DELETE FROM jobs.companies
            WHERE id = ANY(${companyIds})
              AND display_name = ${companyName}
              AND verified_domain = ${verifiedCompanyDomain}
              AND NOT EXISTS (
                SELECT 1 FROM jobs.canonical_jobs WHERE company_id = jobs.companies.id
              )
          `;
        }
      });
    }

    try {
      const first = await new SourceNeutralIngestionRunner(registry, catalog, {
        clock: () => firstObservedAt,
      }).run(generatedSyntheticSourceId, 1, new AbortController().signal);
      expect(first).toEqual({
        sourceId: generatedSyntheticSourceId,
        status: "succeeded",
        observationCount: 2,
        createdCount: 2,
        updatedCount: 0,
      });

      const second = await new SourceNeutralIngestionRunner(registry, catalog, {
        clock: () => secondObservedAt,
      }).run(generatedSyntheticSourceId, 1, new AbortController().signal);
      expect(second).toEqual({
        sourceId: generatedSyntheticSourceId,
        status: "succeeded",
        observationCount: 2,
        createdCount: 0,
        updatedCount: 2,
      });

      const rows = await fixtureRows();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.externalJobId)).toEqual(["generated-job-1", "generated-job-2"]);
      for (const row of rows) {
        expect(row).toMatchObject({
          adapterVersion: generatedSyntheticAdapterVersion,
          atsTenant,
          companyName,
          consecutiveVerificationFailures: 0,
          employmentType: "full_time",
          firstObservedAt,
          lastObservedAt: secondObservedAt,
          lastVerifiedAt: secondObservedAt,
          provider: "other",
          provenance: "authorized_fixture",
          rawSnapshot: null,
          status: "active",
          verifiedCompanyDomain,
        });
        expect(row.sourceUrl).toMatch(
          new RegExp(`^https://jobs\\.example\\.test/source-neutral/${seed}/`),
        );
      }
      expect(rows.map((row) => row.workMode)).toEqual(["remote", "hybrid"]);

      const retryAdapter: IngestionSourceAdapter = {
        sourceId: generatedSyntheticSourceId,
        adapterVersion: generatedSyntheticAdapterVersion,
        async poll() {
          return { kind: "retry", reason: "source_unavailable" };
        },
      };
      const retryRegistry = new SourceRegistry([
        {
          sourceId: generatedSyntheticSourceId,
          provider: "other",
          provenance: "authorized_fixture",
          adapter: retryAdapter,
          enabled: true,
        },
      ]);
      const retry = await new SourceNeutralIngestionRunner(retryRegistry, catalog).run(
        generatedSyntheticSourceId,
        1,
        new AbortController().signal,
      );
      expect(retry).toMatchObject({
        status: "retry",
        observationCount: 0,
        reason: "source_unavailable",
      });
      expect(await fixtureRows()).toEqual(rows);
    } finally {
      await cleanFixture();
      expect(await fixtureRows()).toEqual([]);
    }
  });
});
