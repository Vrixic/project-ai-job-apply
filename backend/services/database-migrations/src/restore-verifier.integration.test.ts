import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCurrentRestoreManifest, verifyRestoreDatabase } from "./restore-verifier.js";
import { createRestoreClient, type PostgresRestoreClient } from "./restore-verifier-runtime.js";

const requested = process.env.RESTORE_VERIFIER_INTEGRATION === "1";
const sourceUrl = process.env.DATABASE_URL;
const restoredUrl = process.env.RESTORE_DATABASE_URL;
const fixtureOwnerId = process.env.RESTORE_VERIFIER_SYNTHETIC_OWNER_ID;
if (
  requested &&
  (!sourceUrl ||
    !restoredUrl ||
    !fixtureOwnerId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(fixtureOwnerId))
) {
  throw new Error("Restore integration requires two databases and an exact synthetic fixture ID");
}

async function assertWriteRefusal(client: PostgresRestoreClient): Promise<void> {
  await client.begin("read only isolation level repeatable read", async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '15s'");
    await transaction.unsafe("SET LOCAL lock_timeout = '2s'");
    await transaction.unsafe("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const boundary = await transaction.unsafe<{
      transaction_read_only: string;
      statement_timeout_ms: string;
      lock_timeout_ms: string;
      idle_timeout_ms: string;
    }>(`
      SELECT
        current_setting('transaction_read_only') AS transaction_read_only,
        (EXTRACT(epoch FROM current_setting('statement_timeout')::interval) * 1000)::int::text
          AS statement_timeout_ms,
        (EXTRACT(epoch FROM current_setting('lock_timeout')::interval) * 1000)::int::text
          AS lock_timeout_ms,
        (
          EXTRACT(epoch FROM current_setting('idle_in_transaction_session_timeout')::interval) * 1000
        )::int::text AS idle_timeout_ms
    `);
    expect(boundary).toEqual([
      {
        transaction_read_only: "on",
        statement_timeout_ms: "15000",
        lock_timeout_ms: "2000",
        idle_timeout_ms: "30000",
      },
    ]);
  });
  await expect(
    client.begin("read only isolation level repeatable read", (transaction) =>
      transaction.unsafe(
        "INSERT INTO platform.schema_migrations (version, checksum) VALUES ('restore_write_probe', repeat('0', 64))",
      ),
    ),
  ).rejects.toMatchObject({ code: "25006" });
}

describe.skipIf(!requested)("restored PostgreSQL aggregate verification", () => {
  let source: PostgresRestoreClient;
  let restored: PostgresRestoreClient;

  beforeAll(() => {
    source = createRestoreClient(sourceUrl as string);
    restored = createRestoreClient(restoredUrl as string);
  });

  afterAll(async () => {
    await Promise.all([source.end(), restored.end()]);
  });

  it("requires distinct databases containing the exact restored synthetic fixture", async () => {
    const [sourceIdentity] = await source.unsafe<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    const [targetIdentity] = await restored.unsafe<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(sourceIdentity?.database_name).toBeTruthy();
    expect(targetIdentity?.database_name).toBeTruthy();
    expect(targetIdentity?.database_name).not.toBe(sourceIdentity?.database_name);

    for (const client of [source, restored]) {
      const fixture = await client.unsafe<{ fixture_count: number }>(`
        SELECT count(*)::int AS fixture_count
        FROM matching.saved_job_list_state
        WHERE owner_user_id = '${fixtureOwnerId}'::uuid AND revision = 1
      `);
      expect(fixture).toEqual([{ fixture_count: 1 }]);
      const billingFixture = await client.unsafe<{ fixture_count: number }>(`
        SELECT count(*)::int AS fixture_count
        FROM billing.entitlement_accounts
        WHERE user_id = '${fixtureOwnerId}'::uuid AND version = 1 AND plan = 'free'
      `);
      expect(billingFixture).toEqual([{ fixture_count: 1 }]);
      const ingestionFixture = await client.unsafe<{
        checkpoint_count: number;
        dispatch_count: number;
        event_count: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM jobs.ingestion_checkpoints
             WHERE source_id='synthetic-foundation-v1') AS checkpoint_count,
          (SELECT count(*)::int FROM jobs.ingestion_dispatches AS dispatch
             JOIN jobs.ingestion_checkpoints AS checkpoint USING (execution_id)
             WHERE checkpoint.source_id='synthetic-foundation-v1') AS dispatch_count,
          (SELECT count(*)::int FROM jobs.ingestion_run_events AS event
             JOIN jobs.ingestion_checkpoints AS checkpoint USING (execution_id)
             WHERE checkpoint.source_id='synthetic-foundation-v1') AS event_count
      `);
      expect(ingestionFixture).toEqual([
        { checkpoint_count: 1, dispatch_count: 1, event_count: 1 },
      ]);
    }
  });

  it("matches the exact read-only source and restored snapshots", async () => {
    const sourceResult = await verifyRestoreDatabase(source);
    const restoredResult = await verifyRestoreDatabase(restored);

    expect(restoredResult).toEqual(sourceResult);
  });

  it("enforces the read-only transaction and timeout boundary on both databases", async () => {
    await assertWriteRefusal(source);
    await assertWriteRefusal(restored);
  });

  it("rejects target count, relation, and migration-ledger divergence", async () => {
    const ingestionMismatchExecutionId = createHash("sha256")
      .update(`restore-ingestion-${randomUUID()}`, "utf8")
      .digest("hex");
    const ingestionMismatchDispatchId = `019d09f8-65ab-7b65-8b90-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      await restored.unsafe(
        `INSERT INTO jobs.ingestion_checkpoints (
           execution_id, schema_version, source_id, adapter_version, scheduled_for,
           state, revision, attempt, withdrawal_inferred
           ) VALUES ('${ingestionMismatchExecutionId}', 1,
           'synthetic-foundation-v1', 'synthetic-ingestion-v1',
           '2026-08-15T12:00:00.000Z', 'pending', 0, 1, false)`,
      );
      await restored.unsafe(
        `INSERT INTO jobs.ingestion_dispatches (
           id, execution_id, generation, checkpoint_revision, durable_execution_name,
           durable_function_arn, activity_function_arn, adapter_config_sha256, state,
           next_attempt_at
         ) VALUES ('${ingestionMismatchDispatchId}', '${ingestionMismatchExecutionId}',
           1, 0, '${ingestionMismatchExecutionId}',
           'arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:7',
           'arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:9',
           repeat('c', 64), 'pending', '2026-08-15T12:00:00.000Z')`,
      );
      expect((await verifyRestoreDatabase(restored)).aggregateDigest).not.toBe(
        (await verifyRestoreDatabase(source)).aggregateDigest,
      );
    } finally {
      await restored.unsafe(`DO $cleanup$
        BEGIN
          PERFORM set_config('session_replication_role', 'replica', true);
          DELETE FROM jobs.ingestion_dispatches WHERE execution_id='${ingestionMismatchExecutionId}';
          DELETE FROM jobs.ingestion_run_events WHERE execution_id='${ingestionMismatchExecutionId}';
          DELETE FROM jobs.ingestion_checkpoints WHERE execution_id='${ingestionMismatchExecutionId}';
        END
        $cleanup$`);
    }
    const matchingMismatchOwnerId = randomUUID();
    try {
      await restored.unsafe(`
        INSERT INTO matching.saved_job_list_state (owner_user_id, revision)
        VALUES ('${matchingMismatchOwnerId}'::uuid, 1)
      `);
      expect((await verifyRestoreDatabase(restored)).aggregateDigest).not.toBe(
        (await verifyRestoreDatabase(source)).aggregateDigest,
      );
    } finally {
      await restored.unsafe(`
        DELETE FROM matching.saved_job_list_state
        WHERE owner_user_id = '${matchingMismatchOwnerId}'::uuid
      `);
    }

    const mismatchOwnerId = randomUUID();
    const mismatchAccountId = randomUUID();
    try {
      await restored.unsafe(`
        INSERT INTO billing.entitlement_accounts (
          id, user_id, version, plan, effective_at, updated_at
        ) VALUES (
          '${mismatchAccountId}'::uuid, '${mismatchOwnerId}'::uuid, 1, 'free',
          '2026-08-15T12:00:00.000Z'::timestamptz,
          '2026-08-15T12:00:00.000Z'::timestamptz
        )
      `);
      expect((await verifyRestoreDatabase(restored)).aggregateDigest).not.toBe(
        (await verifyRestoreDatabase(source)).aggregateDigest,
      );
    } finally {
      await restored.unsafe(`
        DELETE FROM billing.entitlement_accounts
        WHERE id = '${mismatchAccountId}'::uuid AND user_id = '${mismatchOwnerId}'::uuid
      `);
    }

    try {
      await restored.unsafe("CREATE TABLE matching.restore_verifier_unreviewed_probe (id integer)");
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore relation boundary mismatch",
      );
    } finally {
      await restored.unsafe("DROP TABLE IF EXISTS matching.restore_verifier_unreviewed_probe");
    }

    try {
      await restored.unsafe("CREATE TABLE billing.restore_verifier_unreviewed_probe (id integer)");
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore relation boundary mismatch",
      );
    } finally {
      await restored.unsafe("DROP TABLE IF EXISTS billing.restore_verifier_unreviewed_probe");
    }

    try {
      await restored.unsafe("CREATE TABLE jobs.restore_verifier_unreviewed_probe (id integer)");
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore relation boundary mismatch",
      );
    } finally {
      await restored.unsafe("DROP TABLE IF EXISTS jobs.restore_verifier_unreviewed_probe");
    }

    const expectedMatchingChecksum = loadCurrentRestoreManifest()
      .manifest.contributors.find((contributor) => contributor.owner === "matching")
      ?.migrations.find((migration) => migration.version === "0001_saved_jobs")?.checksum;
    expect(expectedMatchingChecksum).toMatch(/^[a-f0-9]{64}$/);
    try {
      await restored.unsafe(`
        UPDATE matching.schema_migrations
        SET checksum = repeat('f', 64)
        WHERE version = '0001_saved_jobs'
      `);
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore migration boundary mismatch for matching",
      );
    } finally {
      await restored.unsafe(`
        UPDATE matching.schema_migrations
        SET checksum = '${expectedMatchingChecksum}'
        WHERE version = '0001_saved_jobs'
      `);
    }

    const expectedBillingChecksum = loadCurrentRestoreManifest()
      .manifest.contributors.find((contributor) => contributor.owner === "billing")
      ?.migrations.find(
        (migration) => migration.version === "0001_entitlement_projection",
      )?.checksum;
    expect(expectedBillingChecksum).toMatch(/^[a-f0-9]{64}$/);
    try {
      await restored.unsafe(`
        UPDATE billing.schema_migrations
        SET checksum = repeat('f', 64)
        WHERE version = '0001_entitlement_projection'
      `);
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore migration boundary mismatch for billing",
      );
    } finally {
      await restored.unsafe(`
        UPDATE billing.schema_migrations
        SET checksum = '${expectedBillingChecksum}'
        WHERE version = '0001_entitlement_projection'
      `);
    }
    const expectedIngestionChecksum = loadCurrentRestoreManifest()
      .manifest.contributors.find((contributor) => contributor.owner === "jobs")
      ?.migrations.find(
        (migration) => migration.version === "0005_ingestion_orchestration",
      )?.checksum;
    expect(expectedIngestionChecksum).toMatch(/^[a-f0-9]{64}$/);
    try {
      await restored.unsafe(`
        UPDATE jobs.schema_migrations SET checksum=repeat('f', 64)
        WHERE version='0005_ingestion_orchestration'
      `);
      await expect(verifyRestoreDatabase(restored)).rejects.toThrow(
        "Restore migration boundary mismatch for jobs",
      );
    } finally {
      await restored.unsafe(`
        UPDATE jobs.schema_migrations SET checksum='${expectedIngestionChecksum}'
        WHERE version='0005_ingestion_orchestration'
      `);
    }
    expect(await verifyRestoreDatabase(restored)).toEqual(await verifyRestoreDatabase(source));
  });
});
