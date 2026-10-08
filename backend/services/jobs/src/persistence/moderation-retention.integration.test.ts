import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CatalogObservation,
  createJobCatalogDatabase,
  PostgresJobCatalog,
} from "./catalog.js";
import {
  PostgresJobModerationStore,
  PostgresJobReportStore,
  PostgresJobRetentionStore,
} from "./reporting.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("moderation retention preserves catalog controls on PostgreSQL", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 4,
  });
  const catalog = new PostgresJobCatalog(client, {
    searchCursorKeys: { active: { id: "mod-retention", key: Buffer.alloc(32, 7) } },
  });
  const moderation = new PostgresJobModerationStore(client);
  const reports = new PostgresJobReportStore(client);
  const retention = new PostgresJobRetentionStore(client);
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url))],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    await reports.ping();
  });
  afterAll(async () => {
    await catalog.close();
  });

  function observation(suffix: string): CatalogObservation {
    return {
      provider: "other",
      provenance: "authorized_fixture",
      companyName: `Synthetic Moderation ${runId}`,
      title: "Synthetic Moderation Retention Engineer",
      locations: ["Remote - US"],
      description: "Synthetic catalog fixture for moderation expiry acceptance.",
      sourceUrl: `https://jobs.example.test/${runId}/${suffix}`,
      observedAt: new Date(),
      atsTenant: `mod-retention-${runId}`,
      externalJobId: suffix,
      employerRequisitionId: `mod-retention-${runId}-${suffix}`,
      verifiedCompanyDomain: `${runId}.example.test`,
      adapterVersion: "synthetic-moderation-retention-v1",
    };
  }

  async function jobCase(jobId: string, openedDays = 400) {
    const id = uuidv7();
    await client`INSERT INTO jobs.moderation_cases(id, target_kind, job_id, status, version, opened_by, open_reason_code, opened_at)
      VALUES (${id}, 'job', ${jobId}, 'open', 0, 'operator:synthetic-moderation-retention', 'catalog_integrity',
        clock_timestamp() - ${openedDays} * interval '1 day')`;
    return id;
  }
  async function closeCase(
    caseId: string,
    resolution: "no_action" | "block_job" | "pause_source",
    days = 366,
  ) {
    await client`UPDATE jobs.moderation_cases SET status = 'resolved', version = 1, resolution = ${resolution},
      resolved_by = 'operator:synthetic-moderation-retention', resolution_reason_code = 'catalog_policy_violation',
      resolved_at = clock_timestamp() - ${days} * interval '1 day' WHERE id = ${caseId}`;
  }
  function source(suffix: string) {
    return {
      kind: "source" as const,
      sourceId: `synthetic-mod-${runId}-${suffix}`,
      adapterVersion: "synthetic-moderation-retention-v1",
      adapterConfigSha256: "c".repeat(64),
    };
  }
  async function sourceCase(target: ReturnType<typeof source>, days = 400) {
    const id = uuidv7();
    await client`INSERT INTO jobs.moderation_cases(id, target_kind, source_id, adapter_version, adapter_config_sha256,
      status, version, opened_by, open_reason_code, opened_at)
      VALUES (${id}, 'source', ${target.sourceId}, ${target.adapterVersion}, ${target.adapterConfigSha256},
        'open', 0, 'operator:synthetic-moderation-retention', 'source_integrity', clock_timestamp() - ${days} * interval '1 day')`;
    return id;
  }
  async function evidence(caseId: string) {
    const [row] = await client<{ cases: number; events: number }[]>`
      SELECT (SELECT count(*)::integer FROM jobs.moderation_cases WHERE id = ${caseId}) AS cases,
        (SELECT count(*)::integer FROM jobs.moderation_events WHERE case_id = ${caseId}) AS events
    `;
    return row;
  }
  async function ageReport(reportId: string, days = 450) {
    // Test-only immutable-row clock aging in the disposable fixture; restore the guard atomically.
    await client.begin(async (transaction) => {
      await transaction.unsafe("ALTER TABLE jobs.job_reports DISABLE TRIGGER job_reports_guard");
      await transaction`UPDATE jobs.job_reports SET created_at = clock_timestamp() - ${days} * interval '1 day' WHERE id = ${reportId}`;
      await transaction.unsafe("ALTER TABLE jobs.job_reports ENABLE TRIGGER job_reports_guard");
    });
  }

  it("runs compiled private maintenance through the real owning SQL runtime and replays safely", async () => {
    const job = await catalog.recordObservation(observation("managed-maintenance"));
    const caseId = await jobCase(job.job.id);
    await closeCase(caseId, "no_action");
    const workflow = await import(
      new URL("../../../../workflows/dist/src/job-retention-lambda.js", import.meta.url).href
    );
    const env: Record<string, string | undefined> = {
      JOB_RETENTION_ENABLED: "true",
      JOB_RETENTION_BATCH_LIMIT: "100",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-job-retention",
      AWS_LAMBDA_FUNCTION_VERSION: "7",
      AWS_SESSION_TOKEN: "synthetic-session",
      DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-jobs",
    };
    const run = workflow.createJobRetentionLambda({
      environment: () => env,
      resolveDatabaseUrl: async () => databaseUrl,
    });
    const context = {
      invokedFunctionArn:
        "arn:aws:lambda:us-east-2:123456789012:function:synthetic-job-retention:7",
    };
    expect(await run({ schemaVersion: 1, action: "expire" }, context)).toEqual({
      schemaVersion: 1,
      owner: "jobs",
      reportsExpired: 0,
      casesExpired: 1,
      eventsExpired: 2,
      controlsExpired: 0,
    });
    expect(await evidence(caseId)).toEqual({ cases: 0, events: 0 });
    expect(await run({ schemaVersion: 1, action: "expire" }, context)).toEqual({
      schemaVersion: 1,
      owner: "jobs",
      reportsExpired: 0,
      casesExpired: 0,
      eventsExpired: 0,
      controlsExpired: 0,
    });
    env.JOB_RETENTION_ENABLED = "false";
    await expect(run({ schemaVersion: 1, action: "expire" }, context)).rejects.toThrow(
      "JobRetentionUnavailable",
    );
  });

  it("expires closed no-action operator detail and both decision events after 365 days", async () => {
    const job = await catalog.recordObservation(observation("no-action"));
    const caseId = await jobCase(job.job.id);
    await closeCase(caseId, "no_action");
    expect(await evidence(caseId)).toEqual({ cases: 1, events: 2 });
    expect(await retention.purgeExpired()).toEqual({
      reportsExpired: 0,
      casesExpired: 1,
      eventsExpired: 2,
      controlsExpired: 0,
    });
    expect(await evidence(caseId)).toEqual({ cases: 0, events: 0 });
    expect((await catalog.getActiveJob(job.job.id, new Date()))?.id).toBe(job.job.id);
  });

  it("preserves an exact source pause after all case and operator detail is gone", async () => {
    const target = source("pause");
    const caseId = await sourceCase(target);
    await closeCase(caseId, "pause_source");
    expect(await moderation.isSourcePaused(target)).toBe(true);
    expect((await retention.purgeExpired()).casesExpired).toBe(1);
    expect(await evidence(caseId)).toEqual({ cases: 0, events: 0 });
    expect(await moderation.isSourcePaused(target)).toBe(true);
    expect(
      await moderation.isSourcePaused({ ...target, adapterConfigSha256: "d".repeat(64) }),
    ).toBe(false);
    expect(
      await moderation.isSourcePaused({ ...target, adapterVersion: "synthetic-other-v1" }),
    ).toBe(false);
    const [control] = await client<{ metadata: Record<string, unknown> }[]>`
      SELECT to_jsonb(pause) AS metadata FROM jobs.source_moderation_pauses AS pause WHERE source_id = ${target.sourceId}
    `;
    expect(Object.keys(control?.metadata ?? {}).sort()).toEqual([
      "adapterConfigSha256",
      "adapterVersion",
      "lastActionAt",
      "sourceId",
    ]);
    await expect(
      client`DELETE FROM jobs.source_moderation_pauses WHERE source_id = ${target.sourceId}`,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("preserves a blocked job and refuses provider resurrection after retiring its case", async () => {
    const fixture = observation("blocked");
    const job = await catalog.recordObservation(fixture);
    const caseId = await jobCase(job.job.id);
    await closeCase(caseId, "block_job");
    expect((await retention.purgeExpired()).casesExpired).toBe(1);
    expect(await evidence(caseId)).toEqual({ cases: 0, events: 0 });
    expect(await catalog.getActiveJob(job.job.id, new Date())).toBeNull();
    await catalog.recordObservation({ ...fixture, observedAt: new Date() });
    const [state] = await client<
      { status: string }[]
    >`SELECT status FROM jobs.canonical_jobs WHERE id = ${job.job.id}`;
    expect(state?.status).toBe("blocked");
    await expect(
      client`DELETE FROM jobs.job_moderation_blocks WHERE job_id = ${job.job.id}`,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("does not erase recent closure or open-case evidence and keeps ordinary mutation forbidden", async () => {
    const job = await catalog.recordObservation(observation("recent"));
    const recent = await jobCase(job.job.id);
    await closeCase(recent, "no_action", 364);
    const open = await jobCase(job.job.id, 500);
    expect((await retention.purgeExpired()).casesExpired).toBe(0);
    expect(await evidence(recent)).toEqual({ cases: 1, events: 2 });
    expect(await evidence(open)).toEqual({ cases: 1, events: 1 });
    await expect(
      client`DELETE FROM jobs.moderation_cases WHERE id = ${recent}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`DELETE FROM jobs.moderation_events WHERE case_id = ${recent}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`UPDATE jobs.moderation_events SET operator_id = 'operator:changed' WHERE case_id = ${recent}`,
    ).rejects.toThrow();
  });

  it("cleans reporter links first and then expires their case in the same bounded transaction", async () => {
    const job = await catalog.recordObservation(observation("linked"));
    const report = await reports.create({
      ownerUserId: uuidv7(),
      requestedJobId: job.job.id,
      reason: "job_inaccurate",
      idempotencyKey: `synthetic-linked-${runId}`,
    });
    const caseId = await jobCase(job.job.id);
    await ageReport(report.id);
    await closeCase(caseId, "no_action");
    const [held] = await client<
      { result: { casesDeleted: number } }[]
    >`SELECT jobs.purge_expired_moderation_cases(100) AS result`;
    expect(held?.result.casesDeleted).toBe(0);
    expect(await retention.purgeExpired()).toEqual({
      reportsExpired: 1,
      casesExpired: 1,
      eventsExpired: 2,
      controlsExpired: 0,
    });
    expect(await evidence(caseId)).toEqual({ cases: 0, events: 0 });
    expect((await moderation.summarizeReports(job.job.id)).total).toBe(1);
  });

  it("rolls back report expiry when the following case-cleanup boundary fails", async () => {
    const job = await catalog.recordObservation(observation("rollback"));
    const report = await reports.create({
      ownerUserId: uuidv7(),
      requestedJobId: job.job.id,
      reason: "job_inaccurate",
      idempotencyKey: `synthetic-rollback-${runId}`,
    });
    const caseId = await jobCase(job.job.id);
    await ageReport(report.id);
    await closeCase(caseId, "no_action");
    await client.unsafe(
      "ALTER FUNCTION jobs.purge_expired_moderation_cases(integer) RENAME TO test_unavailable_moderation_retention",
    );
    try {
      await expect(retention.purgeExpired()).rejects.toMatchObject({ code: "42883" });
      const [retained] = await client<{ reports: number; totals: number }[]>`
        SELECT (SELECT count(*)::integer FROM jobs.job_reports WHERE id = ${report.id}) AS reports,
          (SELECT count(*)::integer FROM jobs.job_report_retention_totals WHERE canonical_job_id = ${job.job.id}) AS totals
      `;
      expect(retained).toEqual({ reports: 1, totals: 0 });
      expect(await evidence(caseId)).toEqual({ cases: 1, events: 2 });
    } finally {
      await client.unsafe(
        "ALTER FUNCTION jobs.test_unavailable_moderation_retention(integer) RENAME TO purge_expired_moderation_cases",
      );
    }
    expect((await retention.purgeExpired()).reportsExpired).toBe(1);
  });

  it("deduplicates repeated pause controls while bounded concurrent cleanup removes only old details", async () => {
    const target = source("repeat");
    const first = await sourceCase(target, 400);
    await closeCase(first, "pause_source", 380);
    const second = await sourceCase(target, 375);
    await closeCase(second, "pause_source", 370);
    const results = await Promise.all([retention.purgeExpired(1), retention.purgeExpired(1)]);
    expect(results.reduce((total, result) => total + result.casesExpired, 0)).toBe(2);
    expect(await moderation.isSourcePaused(target)).toBe(true);
    const [count] = await client<
      { count: number }[]
    >`SELECT count(*)::integer AS count FROM jobs.source_moderation_pauses WHERE source_id = ${target.sourceId}`;
    expect(count?.count).toBe(1);
    expect((await retention.purgeExpired()).casesExpired).toBe(0);
  });

  it("rejects unreviewed control forgery, changed identities, invalid batch sizes and PUBLIC execution", async () => {
    const job = await catalog.recordObservation(observation("forgery"));
    await expect(
      client`INSERT INTO jobs.job_moderation_blocks(job_id, last_action_at) VALUES (${job.job.id}, clock_timestamp())`,
    ).rejects.toMatchObject({ code: "55000" });
    const target = source("forgery");
    await expect(client`INSERT INTO jobs.source_moderation_pauses(source_id, adapter_version, adapter_config_sha256, last_action_at)
      VALUES (${target.sourceId}, ${target.adapterVersion}, ${target.adapterConfigSha256}, clock_timestamp())`).rejects.toMatchObject(
      { code: "55000" },
    );
    for (const value of [0, -1, 1001, 1.5, NaN])
      await expect(retention.purgeExpired(value)).rejects.toThrow();
    await expect(client`SELECT jobs.purge_expired_moderation_cases(NULL)`).rejects.toMatchObject({
      code: "22023",
    });
    const [grants] = await client<{ publicExecute: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace,
        LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS grant_entry
        WHERE namespace.nspname = 'jobs' AND procedure.proname = 'purge_expired_moderation_cases'
          AND grant_entry.grantee = 0 AND grant_entry.privilege_type = 'EXECUTE') AS "publicExecute"
    `;
    expect(grants?.publicExecute).toBe(false);
  });
});
