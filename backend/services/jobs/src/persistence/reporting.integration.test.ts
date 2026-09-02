import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidModerationCursorError,
  JobAlreadyReportedError,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  JobReportTargetUnavailableError,
} from "../reporting.js";
import type { CatalogObservation } from "./catalog.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";
import { PostgresJobModerationStore, PostgresJobReportStore } from "./reporting.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("Jobs reporting and moderation persistence", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 3,
  });
  const catalog = new PostgresJobCatalog(client, {
    searchCursorKeys: { active: { id: "reporting-test", key: Buffer.alloc(32, 8) } },
  });
  const reports = new PostgresJobReportStore(client);
  const moderation = new PostgresJobModerationStore(client, {
    id: "reporting-test",
    key: Buffer.alloc(32, 7),
  });
  const runId = crypto.randomUUID();
  const now = new Date();
  const migrationExecutable = fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url));

  function fixture(suffix: string): CatalogObservation {
    return {
      provider: "other",
      provenance: "authorized_fixture",
      companyName: `Synthetic Reporting ${runId}`,
      title: "Reporting Engineer",
      locations: ["Remote - US"],
      description: "Generated synthetic detail used only for reporting persistence acceptance.",
      sourceUrl: `https://jobs.example.test/${runId}/${suffix}`,
      observedAt: now,
      atsTenant: `report-${runId}`,
      externalJobId: suffix,
      employerRequisitionId: `report-${runId}-${suffix}`,
      verifiedCompanyDomain: `${runId}.example.test`,
      adapterVersion: "synthetic-report-v1",
    };
  }

  beforeAll(async () => {
    const result = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(result.stdout.trim()).toBe(
      "Jobs migrations through 0015_source_revalidation_lifecycle applied and verified.",
    );
    await reports.ping();
  });

  afterAll(async () => {
    await catalog.close();
  });

  it("binds semantic replay to one owner and canonical job without mutating moderation state", async () => {
    const created = await catalog.recordObservation(fixture("canonical"));
    const owner = uuidv7();
    const command = {
      ownerUserId: owner,
      requestedJobId: created.job.id,
      reason: "job_inaccurate" as const,
      idempotencyKey: "reporting-key-canonical-0001",
    };

    const first = await reports.create(command);
    await catalog.setTerminalStatus(
      created.job.id,
      "withdrawn",
      "synthetic_after_report",
      new Date(),
    );
    const replay = await reports.create(command);

    expect(replay).toEqual(first);
    await expect(reports.create({ ...command, reason: "suspected_scam" })).rejects.toBeInstanceOf(
      JobReportIdempotencyConflictError,
    );
    const [state] = await client<{ caseCount: string; status: string }[]>`
      SELECT (
        SELECT count(*)::text FROM jobs.moderation_cases WHERE job_id = ${created.job.id}
      ) AS "caseCount", status
      FROM jobs.canonical_jobs WHERE id = ${created.job.id}
    `;
    expect(state).toEqual({ caseCount: "0", status: "withdrawn" });
  });

  it("resolves an exact alias, isolates owners, rejects duplicates, and aggregates no owner data", async () => {
    const canonical = await catalog.recordObservation(fixture("alias-canonical"));
    const alias = await catalog.recordObservation(fixture("alias-requested"));
    await catalog.reviewDuplicateCandidate({
      jobId: canonical.job.id,
      candidateJobId: alias.job.id,
      resolution: "exact",
      canonicalJobId: canonical.job.id,
      reviewedBy: "operator:report-test",
      reasonCode: "synthetic.reporting_alias",
      reviewedAt: now,
    });
    const firstOwner = uuidv7();
    const secondOwner = uuidv7();
    const first = await reports.create({
      ownerUserId: firstOwner,
      requestedJobId: alias.job.id,
      reason: "duplicate_listing",
      idempotencyKey: "reporting-key-alias-000001",
    });
    await reports.create({
      ownerUserId: secondOwner,
      requestedJobId: canonical.job.id,
      reason: "suspected_scam",
      idempotencyKey: "reporting-key-alias-000002",
    });

    expect(first).toMatchObject({ requestedJobId: alias.job.id, canonicalJobId: canonical.job.id });
    await expect(
      reports.create({
        ownerUserId: firstOwner,
        requestedJobId: canonical.job.id,
        reason: "job_closed",
        idempotencyKey: "reporting-key-alias-000003",
      }),
    ).rejects.toBeInstanceOf(JobAlreadyReportedError);
    expect(await moderation.summarizeReports(canonical.job.id)).toEqual({
      canonicalJobId: canonical.job.id,
      total: 2,
      counts: {
        job_closed: 0,
        job_not_found: 0,
        job_inaccurate: 0,
        suspected_scam: 1,
        duplicate_listing: 1,
        other_catalog_issue: 0,
      },
    });
  });

  it("enforces retained limits and rejects unavailable targets without writes", async () => {
    const oneReport = new PostgresJobReportStore(client, 1);
    const first = await catalog.recordObservation(fixture("limit-first"));
    const second = await catalog.recordObservation(fixture("limit-second"));
    const owner = uuidv7();
    await oneReport.create({
      ownerUserId: owner,
      requestedJobId: first.job.id,
      reason: "job_closed",
      idempotencyKey: "reporting-key-limit-000001",
    });
    await expect(
      oneReport.create({
        ownerUserId: owner,
        requestedJobId: second.job.id,
        reason: "job_closed",
        idempotencyKey: "reporting-key-limit-000002",
      }),
    ).rejects.toBeInstanceOf(JobReportLimitError);
    await catalog.setTerminalStatus(second.job.id, "blocked", "synthetic_unavailable", new Date());
    await expect(
      reports.create({
        ownerUserId: uuidv7(),
        requestedJobId: second.job.id,
        reason: "job_not_found",
        idempotencyKey: "reporting-key-unavailable-1",
      }),
    ).rejects.toBeInstanceOf(JobReportTargetUnavailableError);
  });

  it("records append-only moderation decisions and exposes only an exact source pause", async () => {
    const job = await catalog.recordObservation(fixture("moderated-job"));
    const jobCase = await moderation.openCase({
      target: { kind: "job", jobId: job.job.id },
      operatorId: "operator:moderator",
      reasonCode: "candidate_reports",
    });
    const blocked = await moderation.resolveCase({
      caseId: jobCase.id,
      expectedVersion: 0,
      resolution: "block_job",
      operatorId: "operator:moderator",
      reasonCode: "report_confirmed",
    });
    expect(blocked).toMatchObject({ status: "resolved", version: 1, resolution: "block_job" });
    await expect(catalog.getActiveJob(job.job.id, new Date())).resolves.toBeNull();

    const source = {
      kind: "source" as const,
      sourceId: "synthetic-generated",
      adapterVersion: "synthetic-report-v1",
      adapterConfigSha256: "8".repeat(64),
    };
    const sourceCase = await moderation.openCase({
      target: source,
      operatorId: "operator:moderator",
      reasonCode: "source_integrity",
    });
    await moderation.resolveCase({
      caseId: sourceCase.id,
      expectedVersion: 0,
      resolution: "pause_source",
      operatorId: "operator:moderator",
      reasonCode: "source_integrity_failure",
    });
    await expect(moderation.isSourcePaused(source)).resolves.toBe(true);
    await expect(
      moderation.isSourcePaused({ ...source, adapterConfigSha256: "9".repeat(64) }),
    ).resolves.toBe(false);

    const firstPage = await moderation.searchCases({ status: "resolved", pageSize: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const nextCursor = firstPage.nextCursor;
    if (!nextCursor) throw new Error("The first moderation page did not return a cursor");
    const secondPage = await moderation.searchCases({
      status: "resolved",
      pageSize: 1,
      cursor: nextCursor,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
    await expect(
      moderation.searchCases({
        status: "open",
        pageSize: 1,
        cursor: nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidModerationCursorError);

    await expect(
      client`DELETE FROM jobs.moderation_events WHERE case_id = ${sourceCase.id}`,
    ).rejects.toThrow();
    await expect(client`UPDATE jobs.job_reports SET reason='job_closed'`).rejects.toThrow();
  });
});
