import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";
import {
  PostgresJobModerationStore,
  PostgresJobReportRetentionStore,
  PostgresJobReportStore,
} from "./reporting.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("Jobs report retention on actual PostgreSQL", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 4,
  });
  const catalog = new PostgresJobCatalog(client, {
    searchCursorKeys: { active: { id: "retention-test", key: Buffer.alloc(32, 9) } },
  });
  const reports = new PostgresJobReportStore(client);
  const moderation = new PostgresJobModerationStore(client);
  const retention = new PostgresJobReportRetentionStore(client);
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

  async function createReport(suffix: string) {
    const job = await catalog.recordObservation({
      provider: "other",
      provenance: "authorized_fixture",
      companyName: `Synthetic Retention ${runId}`,
      title: "Synthetic Retention Engineer",
      locations: ["Remote - US"],
      description: "Synthetic catalog fixture for report retention acceptance.",
      sourceUrl: `https://jobs.example.test/${runId}/${suffix}`,
      observedAt: new Date(),
      atsTenant: `retention-${runId}`,
      externalJobId: suffix,
      employerRequisitionId: `retention-${runId}-${suffix}`,
      verifiedCompanyDomain: `${runId}.example.test`,
      adapterVersion: "synthetic-retention-v1",
    });
    const command = {
      ownerUserId: uuidv7(),
      requestedJobId: job.job.id,
      reason: "job_inaccurate" as const,
      idempotencyKey: `synthetic-retention-${runId}-${suffix}`,
    };
    return { command, report: await reports.create(command), jobId: job.job.id };
  }

  async function ageReport(reportId: string, days: number) {
    // Only generated test rows in the disposable local database are clock-aged. The original
    // immutable-report guard is restored atomically; all cleanup runs with every guard enabled.
    await client.begin(async (transaction) => {
      await transaction.unsafe("ALTER TABLE jobs.job_reports DISABLE TRIGGER job_reports_guard");
      await transaction`UPDATE jobs.job_reports SET created_at = clock_timestamp() - ${days} * interval '1 day' WHERE id = ${reportId}`;
      await transaction.unsafe("ALTER TABLE jobs.job_reports ENABLE TRIGGER job_reports_guard");
    });
  }

  async function openHistoricalCase(jobId: string, days: number) {
    const caseId = uuidv7();
    await client`
      INSERT INTO jobs.moderation_cases(id, target_kind, job_id, status, version, opened_by, open_reason_code, opened_at)
      VALUES (${caseId}, 'job', ${jobId}, 'open', 0, 'operator:synthetic-retention', 'candidate_reports',
        clock_timestamp() - ${days} * interval '1 day')
    `;
    return caseId;
  }

  async function closeHistoricalCase(caseId: string, days: number) {
    await client`
      UPDATE jobs.moderation_cases SET status = 'resolved', version = 1, resolution = 'no_action',
        resolved_by = 'operator:synthetic-retention', resolution_reason_code = 'insufficient_evidence',
        resolved_at = clock_timestamp() - ${days} * interval '1 day' WHERE id = ${caseId}
    `;
  }

  async function exists(reportId: string) {
    const [row] = await client<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM jobs.job_reports WHERE id = ${reportId}) AS present`;
    return row?.present;
  }

  it("removes the complete owner/idempotency/request linkage after 90 days and preserves aggregate catalog evidence", async () => {
    const fixture = await createReport("unlinked");
    await ageReport(fixture.report.id, 91);
    expect(await retention.purgeExpired()).toBe(1);
    expect(await exists(fixture.report.id)).toBe(false);
    const [exported] = await client<{ data: { jobs: { reports: unknown[] } } }[]>`
      SELECT jobs.export_candidate_data(${fixture.command.ownerUserId}::uuid) AS data
    `;
    expect(exported?.data.jobs.reports).toEqual([]);
    const summary = await moderation.summarizeReports(fixture.jobId);
    expect(summary.total).toBe(1);
    expect(summary.counts.job_inaccurate).toBe(1);
    const [state] = await client<{ status: string; cases: string }[]>`
      SELECT status, (SELECT count(*)::text FROM jobs.moderation_cases WHERE job_id = ${fixture.jobId}) AS cases
      FROM jobs.canonical_jobs WHERE id = ${fixture.jobId}
    `;
    expect(state).toEqual({ status: "active", cases: "0" });
    const next = await reports.create(fixture.command);
    expect(next.id).not.toBe(fixture.report.id);
    expect(await reports.create(fixture.command)).toEqual(next);
    expect((await moderation.summarizeReports(fixture.jobId)).total).toBe(2);
  });

  it("refuses premature ordinary deletion, immutable evidence edits, and caller-selected invalid bounds", async () => {
    const fixture = await createReport("fresh");
    await expect(
      client`DELETE FROM jobs.job_reports WHERE id = ${fixture.report.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`UPDATE jobs.job_reports SET reason = 'job_closed' WHERE id = ${fixture.report.id}`,
    ).rejects.toThrow();
    for (const bound of [0, -1, 1001, 1.5, NaN])
      await expect(retention.purgeExpired(bound)).rejects.toThrow();
    await expect(client`SELECT jobs.purge_expired_job_reports(NULL)`).rejects.toMatchObject({
      code: "22023",
    });
    expect(await retention.purgeExpired()).toBe(0);
    expect(await exists(fixture.report.id)).toBe(true);
  });

  it("links reports on either side of explicit case opening and preserves open-case evidence beyond 90 days", async () => {
    const before = await createReport("open-before");
    const caseId = await openHistoricalCase(before.jobId, 20);
    const after = await reports.create({
      ...before.command,
      ownerUserId: uuidv7(),
      idempotencyKey: `synthetic-after-${runId}`,
    });
    const links = await client<{ reportId: string; caseId: string }[]>`
      SELECT report_id AS "reportId", case_id AS "caseId" FROM jobs.job_report_case_links
      WHERE report_id IN (${before.report.id}, ${after.id}) ORDER BY report_id
    `;
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.caseId === caseId)).toBe(true);
    await ageReport(before.report.id, 100);
    await ageReport(after.id, 100);
    expect(await retention.purgeExpired()).toBe(0);
    await expect(
      client`DELETE FROM jobs.job_report_case_links WHERE report_id = ${before.report.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`UPDATE jobs.job_report_case_links SET case_id = ${caseId} WHERE report_id = ${before.report.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    expect(await exists(before.report.id)).toBe(true);
  });

  it("keeps a 100-day-old report for 30 days after its linked case closes", async () => {
    const fixture = await createReport("recent-close");
    const caseId = await openHistoricalCase(fixture.jobId, 80);
    await ageReport(fixture.report.id, 100);
    await closeHistoricalCase(caseId, 29);
    expect(await retention.purgeExpired()).toBe(0);
    expect(await exists(fixture.report.id)).toBe(true);
  });

  it("uses the later of receipt+90 and closure+30 and never reassigns old evidence to a reopened case", async () => {
    const fixture = await createReport("old-close");
    const caseId = await openHistoricalCase(fixture.jobId, 80);
    await ageReport(fixture.report.id, 100);
    await closeHistoricalCase(caseId, 31);
    await moderation.openCase({
      target: { kind: "job", jobId: fixture.jobId },
      operatorId: "operator:synthetic-retention",
      reasonCode: "candidate_reports",
    });
    expect(await retention.purgeExpired()).toBe(1);
    expect(await exists(fixture.report.id)).toBe(false);
    const [link] = await client<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM jobs.job_report_case_links WHERE report_id = ${fixture.report.id}`;
    expect(link?.count).toBe("0");
    expect((await moderation.summarizeReports(fixture.jobId)).total).toBe(1);
  });

  it("does not shorten receipt retention for an earlier closure", async () => {
    const fixture = await createReport("receipt-wins");
    const caseId = await openHistoricalCase(fixture.jobId, 80);
    await ageReport(fixture.report.id, 89);
    await closeHistoricalCase(caseId, 40);
    expect(await retention.purgeExpired()).toBe(0);
    expect(await exists(fixture.report.id)).toBe(true);
  });

  it("honors bounded batches and concurrent retries without double-counting", async () => {
    const first = await createReport("batch-first");
    const second = await createReport("batch-second");
    await ageReport(first.report.id, 95);
    await ageReport(second.report.id, 94);
    const results = await Promise.all([retention.purgeExpired(1), retention.purgeExpired(1)]);
    expect(results.reduce((total, count) => total + count, 0)).toBeGreaterThanOrEqual(1);
    await retention.purgeExpired(1);
    expect(await retention.purgeExpired()).toBe(0);
    expect(await exists(first.report.id)).toBe(false);
    expect(await exists(second.report.id)).toBe(false);
    expect((await moderation.summarizeReports(first.jobId)).total).toBe(1);
    expect((await moderation.summarizeReports(second.jobId)).total).toBe(1);
  });

  it("keeps the maintenance function unavailable through PUBLIC and exact safety guards enabled", async () => {
    const [row] = await client<{ publicExecute: boolean; guards: string }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace,
          LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS grant_entry
        WHERE namespace.nspname = 'jobs' AND procedure.proname = 'purge_expired_job_reports'
          AND grant_entry.grantee = 0 AND grant_entry.privilege_type = 'EXECUTE'
      ) AS "publicExecute", (SELECT count(*)::text FROM pg_trigger
        WHERE tgrelid = 'jobs.job_reports'::regclass AND NOT tgisinternal AND tgenabled = 'O') AS guards
    `;
    expect(row).toEqual({ publicExecute: false, guards: "4" });
  });

  it("lets confirmed candidate deletion immediately erase linked reports without retaining a new aggregate", async () => {
    const fixture = await createReport("candidate-delete");
    await moderation.openCase({
      target: { kind: "job", jobId: fixture.jobId },
      operatorId: "operator:synthetic-retention",
      reasonCode: "candidate_reports",
    });
    const owner = fixture.command.ownerUserId;
    const operationId = uuidv7();
    const requestId = uuidv7();
    const confirmedAt = new Date(Date.now() - 1_000);
    const backupExpiresAt = new Date(confirmedAt.getTime() + 35 * 86_400_000);
    await client`INSERT INTO identity.users(id) VALUES (${owner})`;
    await client`INSERT INTO platform.operations(id, user_id, kind, state)
      VALUES (${operationId}, ${owner}, 'account_deletion', 'queued')`;
    await client`INSERT INTO profile.account_deletion_requests (
      id, user_id, operation_id, policy_version, state, version,
      requested_at, updated_at, confirmed_at, backup_expires_at
    ) VALUES (${requestId}, ${owner}, ${operationId}, 'synthetic-report-retention-v1',
      'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt})`;
    await client`INSERT INTO privacy.account_deletion_ledger (
      request_id, subject_digest, policy_version, policy_sha256, state,
      owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
    ) VALUES (${requestId}, ${"1".repeat(64)}, 'synthetic-report-retention-v1', ${"2".repeat(64)},
      'quarantined', ${client.json({ jobs: "pending" })}, ${client.json({})},
      ${confirmedAt}, ${backupExpiresAt}, ${confirmedAt})`;
    try {
      const [deleted] = await client<{ result: { reportsDeleted: number } }[]>`
        SELECT jobs.delete_candidate_data(${owner}::uuid, ${requestId}::uuid) AS result
      `;
      expect(deleted?.result.reportsDeleted).toBe(1);
      expect(await exists(fixture.report.id)).toBe(false);
      expect((await moderation.summarizeReports(fixture.jobId)).total).toBe(0);
      const [links] = await client<{ count: string }[]>`
        SELECT count(*)::text AS count FROM jobs.job_report_case_links WHERE report_id = ${fixture.report.id}
      `;
      expect(links?.count).toBe("0");
    } finally {
      await client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
      await client`DELETE FROM identity.users WHERE id = ${owner}`;
    }
  });
});
