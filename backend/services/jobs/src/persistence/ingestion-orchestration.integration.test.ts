import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJobCatalogDatabase } from "./catalog.js";
import {
  durableIngestionExecutionName,
  PostgresIngestionOrchestrationStore,
} from "./ingestion-orchestration.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresIngestionOrchestrationStore", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 3,
  });
  const store = new PostgresIngestionOrchestrationStore(client);
  const scheduledFor = "2026-08-15T15:00:00.000Z";
  const executionId = createHash("sha256")
    .update(`1\nsynthetic-foundation-v1\nsynthetic-ingestion-v1\n${scheduledFor}\n`, "utf8")
    .digest("hex");
  const recoveryScheduledFor = "2026-08-15T16:00:00.000Z";
  const recoveryExecutionId = createHash("sha256")
    .update(`1\nsynthetic-foundation-v1\nsynthetic-ingestion-v1\n${recoveryScheduledFor}\n`, "utf8")
    .digest("hex");
  const nextRecoveryScheduledFor = "2026-08-15T17:00:00.000Z";
  const nextRecoveryExecutionId = createHash("sha256")
    .update(
      `1\nsynthetic-foundation-v1\nsynthetic-ingestion-v1\n${nextRecoveryScheduledFor}\n`,
      "utf8",
    )
    .digest("hex");
  const deliveryScheduledFor = "2026-08-15T18:00:00.000Z";
  const deliveryExecutionId = createHash("sha256")
    .update(`1\nsynthetic-foundation-v1\nsynthetic-ingestion-v1\n${deliveryScheduledFor}\n`, "utf8")
    .digest("hex");
  const firstDispatchId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d";
  const durableFunctionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:7";
  const activityFunctionArn =
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:9";
  const adapterConfigSha256 = "c".repeat(64);

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(
      new URL("../../dist/src/migrate.js", import.meta.url),
    );
    await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(async () => {
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      for (const ownedExecutionId of [
        executionId,
        recoveryExecutionId,
        nextRecoveryExecutionId,
        deliveryExecutionId,
      ]) {
        await transaction.unsafe("DELETE FROM jobs.ingestion_dispatches WHERE execution_id = $1", [
          ownedExecutionId,
        ]);
        await transaction.unsafe("DELETE FROM jobs.ingestion_run_events WHERE execution_id = $1", [
          ownedExecutionId,
        ]);
        await transaction.unsafe("DELETE FROM jobs.ingestion_checkpoints WHERE execution_id = $1", [
          ownedExecutionId,
        ]);
      }
    });
    await client.end();
  });

  it("persists exact replay, revision fencing, append-only history, and recovery dispatch", async () => {
    const checkpoint = {
      schemaVersion: 1,
      executionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor,
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    } as const;
    const dispatch = {
      id: firstDispatchId,
      executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: durableIngestionExecutionName(executionId, 1),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    };
    const created = await store.ensureScheduledOccurrence(checkpoint, dispatch);
    const replay = await store.ensureScheduledOccurrence(checkpoint, dispatch);
    expect(created.created).toBe(true);
    expect(replay.created).toBe(false);
    await expect(
      client.begin(async (transaction) => {
        const isolatedExecutionId = "e".repeat(64);
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_checkpoints (
             execution_id, schema_version, source_id, adapter_version, scheduled_for,
             state, revision, attempt, withdrawal_inferred
           ) VALUES ($1, 1, 'synthetic-foundation-v1', 'synthetic-ingestion-v1', $2,
             'pending', 0, 1, false)`,
          [isolatedExecutionId, scheduledFor],
        );
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_dispatches (
             id, execution_id, generation, checkpoint_revision, durable_execution_name,
             durable_function_arn, activity_function_arn, adapter_config_sha256, state,
             last_error_code, next_attempt_at
           ) VALUES ($1, $2, 1, 0, $3, $4, $5, $6, 'pending', 'CandidateValue', $7)`,
          [
            "018f47a6-7b2c-7ee1-8c09-3ea174e80e38",
            isolatedExecutionId,
            durableIngestionExecutionName(isolatedExecutionId, 1),
            durableFunctionArn,
            activityFunctionArn,
            adapterConfigSha256,
            scheduledFor,
          ],
        );
      }),
    ).rejects.toThrow();
    await expect(
      client.begin(async (transaction) => {
        const futureExecutionId = "d".repeat(64);
        const futureScheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_checkpoints (
             execution_id, schema_version, source_id, adapter_version, scheduled_for,
             state, revision, attempt, withdrawal_inferred
           ) VALUES ($1, 1, 'synthetic-foundation-v1', 'synthetic-ingestion-v1', $2,
             'pending', 0, 1, false)`,
          [futureExecutionId, futureScheduledFor],
        );
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_dispatches (
           id, execution_id, generation, checkpoint_revision, durable_execution_name,
             durable_function_arn, activity_function_arn, adapter_config_sha256, state,
             next_attempt_at
           ) VALUES ($1, $2, 1, 0, $3, $4, $5, $6, 'pending', $7)`,
          [
            "018f47a6-7b2c-7ee1-8c09-3ea174e80e36",
            futureExecutionId,
            durableIngestionExecutionName(futureExecutionId, 1),
            durableFunctionArn,
            activityFunctionArn,
            adapterConfigSha256,
            futureScheduledFor,
          ],
        );
      }),
    ).rejects.toThrow();
    for (const [invalidSourceId, invalidAdapterVersion] of [
      [`synthetic-${"a".repeat(55)}`, "synthetic-ingestion-v1"],
      ["synthetic-foundation-v1", `a${"_".repeat(100)}`],
    ] as const) {
      await expect(
        client.unsafe(
          `INSERT INTO jobs.ingestion_checkpoints (
             execution_id, schema_version, source_id, adapter_version, scheduled_for,
             state, revision, attempt, withdrawal_inferred
           ) VALUES ($1, 1, $2, $3, $4, 'pending', 0, 1, false)`,
          [
            createHash("sha256")
              .update(`${invalidSourceId}:${invalidAdapterVersion}`, "utf8")
              .digest("hex"),
            invalidSourceId,
            invalidAdapterVersion,
            scheduledFor,
          ],
        ),
      ).rejects.toThrow();
    }
    await expect(
      client.begin(async (transaction) => {
        const invalidFunctionExecutionId = "8".repeat(64);
        const invalidFunctionName = "a".repeat(65);
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_checkpoints (
             execution_id, schema_version, source_id, adapter_version, scheduled_for,
             state, revision, attempt, withdrawal_inferred
           ) VALUES ($1, 1, 'synthetic-foundation-v1', 'synthetic-ingestion-v1', $2,
             'pending', 0, 1, false)`,
          [invalidFunctionExecutionId, scheduledFor],
        );
        await transaction.unsafe(
          `INSERT INTO jobs.ingestion_dispatches (
             id, execution_id, generation, checkpoint_revision, durable_execution_name,
             durable_function_arn, activity_function_arn, adapter_config_sha256, state,
             next_attempt_at
           ) VALUES ($1, $2, 1, 0, $3, $4, $5, $6, 'pending', $7)`,
          [
            "018f47a6-7b2c-7ee1-8c09-3ea174e80e35",
            invalidFunctionExecutionId,
            durableIngestionExecutionName(invalidFunctionExecutionId, 1),
            `arn:aws:lambda:us-east-2:123456789012:function:${invalidFunctionName}:1`,
            activityFunctionArn,
            adapterConfigSha256,
            scheduledFor,
          ],
        );
      }),
    ).rejects.toThrow();
    await expect(
      client.unsafe(`UPDATE jobs.ingestion_dispatches SET publish_attempts=5 WHERE id=$1`, [
        firstDispatchId,
      ]),
    ).rejects.toThrow();
    await expect(
      client.unsafe(
        `INSERT INTO jobs.ingestion_checkpoints (
           execution_id, schema_version, source_id, adapter_version, scheduled_for,
           state, revision, attempt, withdrawal_inferred, created_at, updated_at
         ) VALUES ($1, 1, 'synthetic-foundation-v1', 'synthetic-ingestion-v1', $2,
           'pending', 0, 1, false, clock_timestamp()+interval '1 hour',
           clock_timestamp()+interval '1 hour')`,
        ["9".repeat(64), scheduledFor],
      ),
    ).rejects.toThrow();
    await expect(
      client.unsafe(
        `INSERT INTO jobs.ingestion_dispatches (
           id, execution_id, generation, checkpoint_revision, durable_execution_name,
           durable_function_arn, activity_function_arn, adapter_config_sha256, state
         ) VALUES ($1, $2, 3, 0, $3, $4, $5, $6, 'pending')`,
        [
          "018f47a6-7b2c-7ee1-8c09-3ea174e80e37",
          executionId,
          durableIngestionExecutionName(executionId, 3),
          durableFunctionArn,
          activityFunctionArn,
          adapterConfigSha256,
        ],
      ),
    ).rejects.toThrow();
    await expect(
      client.unsafe("UPDATE jobs.ingestion_dispatches SET activity_function_arn=$2 WHERE id=$1", [
        firstDispatchId,
        "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:10",
      ]),
    ).rejects.toThrow();
    await expect(
      client.unsafe(
        `INSERT INTO jobs.ingestion_checkpoints (
           execution_id, schema_version, source_id, adapter_version, scheduled_for,
           state, revision, attempt, withdrawal_inferred, lease_id, leased_at, lease_expires_at,
           prior_progress_unknown
         ) VALUES ($1, 1, 'synthetic-foundation-v1', 'synthetic-ingestion-v1', $2,
           'claimed', 1, 1, false, $3, $2, $2::timestamptz + interval '1 minute', false)`,
        ["f".repeat(64), scheduledFor, "018f47a6-7b2c-7ee1-8c09-3ea174e80e39"],
      ),
    ).rejects.toThrow();
    await expect(
      client.unsafe(
        `INSERT INTO jobs.ingestion_dispatches (
           id, execution_id, generation, checkpoint_revision, durable_execution_name,
           durable_function_arn, activity_function_arn, adapter_config_sha256, state,
           publish_attempts, durable_execution_arn, durable_execution_id
         ) VALUES ($1, $2, 9, 0, $3, $4, $5, $6, 'started', 0, $7, 'opaqueExecution09')`,
        [
          "018f47a6-7b2c-7ee1-8c09-3ea174e80e38",
          executionId,
          "e".repeat(64),
          durableFunctionArn,
          activityFunctionArn,
          adapterConfigSha256,
          `${durableFunctionArn}/durable-execution/${"e".repeat(64)}/opaqueExecution09`,
        ],
      ),
    ).rejects.toThrow();

    const claimId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e2e";
    const [claimedDispatch] = await store.claimDispatches(1, claimId);
    expect(claimedDispatch?.id).toBe(firstDispatchId);
    expect(
      (claimedDispatch?.claimExpiresAt?.getTime() ?? 0) -
        (claimedDispatch?.claimedAt?.getTime() ?? 0),
    ).toBe(60_000);
    await store.recordDispatchNudged(firstDispatchId, claimId);

    const claimed = await store.transitionCheckpoint(executionId, 0, (current, now) => ({
      ...current,
      state: "claimed",
      revision: 1,
      leaseId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2f",
      leasedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
      priorProgressUnknown: false,
    }));
    expect(claimed.checkpoint.state).toBe("claimed");
    await expect(
      store.ensureScheduledOccurrence(checkpoint, {
        ...dispatch,
        id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e3a",
        durableFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:10",
        activityFunctionArn:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:11",
        adapterConfigSha256: "e".repeat(64),
      }),
    ).resolves.toMatchObject({
      created: false,
      checkpoint: { state: "claimed", revision: 1 },
      dispatch: {
        id: firstDispatchId,
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      },
    });
    await expect(
      store.ensureScheduledOccurrence(checkpoint, {
        ...dispatch,
        durableFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:other-ingestion:7",
      }),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(
      store.ensureScheduledOccurrence(
        { ...checkpoint, adapterVersion: "synthetic-ingestion-v2" },
        dispatch,
      ),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(
      store.ensureScheduledOccurrence({ ...checkpoint, sourceId: "synthetic-other-v1" }, dispatch),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(
      store.ensureScheduledOccurrence(
        { ...checkpoint, scheduledFor: "2026-08-15T15:00:01.000Z" },
        dispatch,
      ),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(store.transitionCheckpoint(executionId, 0, (current) => current)).rejects.toThrow(
      "revision is stale",
    );
    await expect(
      client.unsafe("DELETE FROM jobs.ingestion_run_events WHERE execution_id = $1", [executionId]),
    ).rejects.toThrow();
    const shapeChecks = await client.unsafe<{ valid: boolean }[]>(
      "SELECT jobs.valid_ingestion_checkpoint_event($1::jsonb, 'pending') AS valid",
      [JSON.stringify({ ...checkpoint, raw: "forbidden" })],
    );
    expect(shapeChecks).toEqual([{ valid: false }]);
    await expect(
      client.unsafe(
        `INSERT INTO jobs.ingestion_run_events
           (execution_id, revision, state, attempt, occurred_at, checkpoint)
         VALUES ($1, 99, 'pending', 1, clock_timestamp(), $2::jsonb)`,
        [executionId, JSON.stringify({ ...checkpoint, revision: 99, raw: "forbidden" })],
      ),
    ).rejects.toThrow();
    await expect(
      client.unsafe(
        `
        UPDATE jobs.ingestion_checkpoints SET
          state='succeeded', revision=2, lease_id=NULL, leased_at=NULL, lease_expires_at=NULL,
          prior_progress_unknown=NULL, settled_attempt=1,
          settled_lease_id='018f47a6-7b2c-7ee1-8c09-3ea174e80e31',
          settled_at=clock_timestamp(), settlement_key=$2, progress_known=true,
          observation_count=0, created_count=0, updated_count=0, updated_at=clock_timestamp()
        WHERE execution_id=$1
      `,
        [executionId, "c".repeat(64)],
      ),
    ).rejects.toThrow();

    const durableArn = `${durableFunctionArn}/durable-execution/${dispatch.durableExecutionName}/opaqueExecution01`;
    const wrongFunctionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:8";
    await expect(
      store.recordDurableTerminal(
        dispatch.durableExecutionName,
        "FAILED",
        `${wrongFunctionArn}/durable-execution/${dispatch.durableExecutionName}/opaqueExecution01`,
        wrongFunctionArn,
      ),
    ).rejects.toThrow("terminal transition is stale");
    await store.recordDurableTerminal(
      dispatch.durableExecutionName,
      "FAILED",
      durableArn,
      durableFunctionArn,
    );
    await expect(
      store.recordDurableTerminal(
        dispatch.durableExecutionName,
        "FAILED",
        durableArn,
        durableFunctionArn,
      ),
    ).resolves.toMatchObject({ terminalStatus: "FAILED" });
    await expect(
      store.ensureRecoveryDispatch(
        executionId,
        1,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e35",
        durableFunctionArn,
        activityFunctionArn,
        "f".repeat(64),
      ),
    ).rejects.toThrow();
    await expect(
      store.ensureRecoveryDispatch(
        executionId,
        1,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e36",
        "arn:aws:lambda:us-east-2:123456789012:function:other-ingestion:7",
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).rejects.toThrow();
    const recovered = await store.ensureRecoveryDispatch(
      executionId,
      1,
      "018f47a6-7b2c-7ee1-8c09-3ea174e80e30",
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    );
    const recoveredReplay = await store.ensureRecoveryDispatch(
      executionId,
      1,
      "018f47a6-7b2c-7ee1-8c09-3ea174e80e31",
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    );
    expect(recovered).toMatchObject({
      generation: 2,
      checkpointRevision: 1,
      durableFunctionArn,
      activityFunctionArn,
      state: "pending",
    });
    expect(recoveredReplay?.id).toBe(recovered?.id);

    const secondClaimId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e32";
    const [secondClaim] = await store.claimDispatches(1, secondClaimId);
    if (!secondClaim) throw new Error("Expected the recovery dispatch claim");
    await store.recordDispatchNudged(secondClaim.id, secondClaimId);
    const secondExecutionArn = `${durableFunctionArn}/durable-execution/${secondClaim.durableExecutionName}/opaqueExecution02`;
    await store.recordDurableStart(secondClaim.id, secondExecutionArn);
    await expect(
      store.recordDurableTerminal(
        secondClaim.durableExecutionName,
        "SUCCEEDED",
        `${durableFunctionArn}/durable-execution/${secondClaim.durableExecutionName}/opaqueExecution03`,
        durableFunctionArn,
      ),
    ).rejects.toThrow("terminal transition is stale");
    await store.recordDurableTerminal(
      secondClaim.durableExecutionName,
      "SUCCEEDED",
      secondExecutionArn,
      durableFunctionArn,
    );
    await store.transitionCheckpoint(executionId, 1, (current, now) => {
      if (current.state !== "claimed") throw new Error("Expected a claimed checkpoint");
      const {
        leaseId,
        leasedAt: _leasedAt,
        leaseExpiresAt: _leaseExpiresAt,
        priorProgressUnknown: _prior,
        ...base
      } = current;
      if (!leaseId) throw new Error("Expected an exact checkpoint lease");
      return {
        ...base,
        state: "paused",
        revision: 2,
        settledAttempt: current.attempt,
        settledLeaseId: leaseId,
        settledAt: now.toISOString(),
        settlementKey: "d".repeat(64),
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
        pauseReason: "attempt_aborted",
      };
    });
    await expect(
      store.ensurePausedResumeDispatches(
        "synthetic-foundation-v1",
        ["018f47a6-7b2c-7ee1-8c09-3ea174e80e33"],
        "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:10",
        "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:11",
        "e".repeat(64),
      ),
    ).rejects.toThrow();
    const resumed = await store.ensurePausedResumeDispatches(
      "synthetic-foundation-v1",
      ["018f47a6-7b2c-7ee1-8c09-3ea174e80e34"],
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:10",
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:11",
      adapterConfigSha256,
    );
    expect(resumed).toMatchObject([
      {
        generation: 3,
        checkpointRevision: 2,
        durableFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:10",
        activityFunctionArn:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:11",
        adapterConfigSha256,
      },
    ]);
    await expect(
      store.ensurePausedResumeDispatches(
        "synthetic-foundation-v1",
        ["018f47a6-7b2c-7ee1-8c09-3ea174e80e35"],
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).resolves.toEqual([]);

    const counts = await client<
      Array<{ checkpointCount: number; eventCount: number; dispatchCount: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM jobs.ingestion_checkpoints WHERE execution_id=${executionId}) AS "checkpointCount",
        (SELECT count(*)::int FROM jobs.ingestion_run_events WHERE execution_id=${executionId}) AS "eventCount",
        (SELECT count(*)::int FROM jobs.ingestion_dispatches WHERE execution_id=${executionId}) AS "dispatchCount"
    `;
    expect(counts[0]).toEqual({
      checkpointCount: 1,
      eventCount: 3,
      dispatchCount: 3,
    });
  });

  it("retries the same aged nudge, reconciles terminal metadata, and exhausts generation twenty", async () => {
    const checkpoint = {
      schemaVersion: 1,
      executionId: recoveryExecutionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: recoveryScheduledFor,
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    } as const;
    const initialId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e40";
    await store.ensureScheduledOccurrence(checkpoint, {
      id: initialId,
      executionId: recoveryExecutionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: durableIngestionExecutionName(recoveryExecutionId, 1),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe(
        `UPDATE jobs.ingestion_dispatches SET state='nudged', publish_attempts=1,
           last_error_code=NULL, created_at=clock_timestamp()-interval '3 hours',
           updated_at=clock_timestamp()-interval '2 hours'
         WHERE id=$1`,
        [initialId],
      );
    });
    const publishRecovered = await store.recoverTransportDispatches("synthetic-foundation-v1");
    expect(publishRecovered).toEqual({ retried: 1, exhausted: 0 });
    await expect(
      client.unsafe(
        "UPDATE jobs.ingestion_dispatches SET updated_at=clock_timestamp() WHERE id=$1",
        [initialId],
      ),
    ).rejects.toThrow();

    const second = await store.getDispatch(initialId);
    if (!second) throw new Error("Expected publish-failed recovery");
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe(
        `UPDATE jobs.ingestion_dispatches SET state='nudged', publish_attempts=5,
           last_error_code=NULL, updated_at=clock_timestamp()-interval '2 hours'
         WHERE id=$1`,
        [second.id],
      );
    });
    const dlqRecovered = await store.recoverTransportDispatches("synthetic-foundation-v1");
    expect(dlqRecovered).toEqual({ retried: 0, exhausted: 1 });
    await expect(store.recoverTransportDispatches("synthetic-foundation-v1")).resolves.toEqual({
      retried: 0,
      exhausted: 1,
    });

    const lateSecondArn = `${durableFunctionArn}/durable-execution/${durableIngestionExecutionName(recoveryExecutionId, 1)}/lateExecution02`;
    await expect(
      store.recordDurableTerminal(
        durableIngestionExecutionName(recoveryExecutionId, 1),
        "FAILED",
        lateSecondArn,
        durableFunctionArn,
      ),
    ).resolves.toMatchObject({
      generation: 1,
      state: "terminal",
      durableExecutionId: "lateExecution02",
    });
    await expect(
      store.ensureRecoveryDispatch(
        recoveryExecutionId,
        1,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e49",
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).resolves.toMatchObject({ generation: 2 });

    const twentieth = await store.getDispatch("018f47a6-7b2c-7ee1-8c09-3ea174e80e49");
    if (!twentieth) throw new Error("Expected DLQ-aged recovery");
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe(
        `UPDATE jobs.ingestion_dispatches SET state='started', publish_attempts=1,
           durable_execution_arn=durable_function_arn || '/durable-execution/' || durable_execution_name || '/missingTerminal03',
           durable_execution_id='missingTerminal03', created_at=clock_timestamp()-interval '4 hours',
           updated_at=clock_timestamp()-interval '3 hours'
         WHERE id=$1`,
        [twentieth.id],
      );
    });
    await expect(
      store.listStartedDispatchesForReconciliation("synthetic-foundation-v1", 25),
    ).resolves.toMatchObject([{ id: twentieth.id, state: "started" }]);
    const reconciled = await store.recordDurableTerminal(
      durableIngestionExecutionName(recoveryExecutionId, 2),
      "TIMED_OUT",
      `${durableFunctionArn}/durable-execution/${durableIngestionExecutionName(recoveryExecutionId, 2)}/missingTerminal03`,
      durableFunctionArn,
    );
    expect(reconciled).toMatchObject({ generation: 2, state: "terminal" });
    const terminalRecovered = await store.ensureRecoveryDispatch(
      recoveryExecutionId,
      2,
      "018f47a6-7b2c-7ee1-8c09-3ea174e80e43",
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    );
    expect(terminalRecovered).toMatchObject({ generation: 3, state: "pending" });
    await expect(store.getDispatch(twentieth.id)).resolves.toMatchObject({
      generation: 2,
      state: "terminal",
      durableExecutionId: "missingTerminal03",
    });
    await expect(
      store.recordDurableTerminal(
        durableIngestionExecutionName(recoveryExecutionId, 2),
        "TIMED_OUT",
        `${durableFunctionArn}/durable-execution/${durableIngestionExecutionName(recoveryExecutionId, 2)}/missingTerminal03`,
        durableFunctionArn,
      ),
    ).resolves.toMatchObject({ generation: 2, state: "terminal" });

    const twentiethGeneration = terminalRecovered;
    if (!twentiethGeneration) throw new Error("Expected missing-terminal recovery");
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe(
        `UPDATE jobs.ingestion_dispatches SET generation=20, durable_execution_name=$2,
           state='terminal', publish_attempts=5, last_error_code=NULL,
           durable_execution_arn=durable_function_arn || '/durable-execution/' || $2 || '/generationTwenty',
           durable_execution_id='generationTwenty', terminal_status='FAILED'
         WHERE id=$1`,
        [twentiethGeneration.id, durableIngestionExecutionName(recoveryExecutionId, 20)],
      );
    });
    await expect(
      store.ensureRecoveryDispatch(
        recoveryExecutionId,
        20,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e44",
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).resolves.toBeUndefined();
    await expect(store.getDispatch(twentiethGeneration.id)).resolves.toMatchObject({
      generation: 20,
      state: "recovery_exhausted",
      lastErrorCode: "RecoveryGenerationLimit",
    });
    const exhaustedCheckpoint = {
      schemaVersion: 1,
      executionId: recoveryExecutionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: recoveryScheduledFor,
      state: "dead_lettered",
      revision: 1,
      attempt: 1,
      withdrawalInferred: false,
      failureCode: "recovery_generation_exhausted",
      exhaustedDispatchId: twentiethGeneration.id,
    } as const;
    await expect(store.getCheckpoint(recoveryExecutionId)).resolves.toEqual(exhaustedCheckpoint);
    const [exhaustedEvent] = await client.unsafe<{ checkpoint: unknown }[]>(
      `SELECT checkpoint FROM jobs.ingestion_run_events
       WHERE execution_id=$1 AND revision=1`,
      [recoveryExecutionId],
    );
    expect(exhaustedEvent?.checkpoint).toEqual(exhaustedCheckpoint);
    await expect(store.recoverTransportDispatches("synthetic-foundation-v1")).resolves.toEqual({
      retried: 0,
      exhausted: 0,
    });
    const generationTwentyName = durableIngestionExecutionName(recoveryExecutionId, 20);
    const generationTwentyArn = `${durableFunctionArn}/durable-execution/${generationTwentyName}/generationTwenty`;
    await expect(
      store.recordDurableTerminal(
        generationTwentyName,
        "FAILED",
        generationTwentyArn,
        durableFunctionArn,
      ),
    ).resolves.toMatchObject({ state: "recovery_exhausted", terminalStatus: "FAILED" });
    await expect(
      store.ensureRecoveryDispatch(
        recoveryExecutionId,
        20,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e45",
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.ensureScheduledOccurrence(checkpoint, {
        id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e46",
        executionId: recoveryExecutionId,
        generation: 1,
        checkpointRevision: 0,
        durableExecutionName: durableIngestionExecutionName(recoveryExecutionId, 1),
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      }),
    ).rejects.toThrow("exhausted durable recovery generations");
    await expect(
      store.ensureScheduledOccurrence(
        {
          ...checkpoint,
          executionId: nextRecoveryExecutionId,
          scheduledFor: nextRecoveryScheduledFor,
        },
        {
          id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e47",
          executionId: nextRecoveryExecutionId,
          generation: 1,
          checkpointRevision: 0,
          durableExecutionName: durableIngestionExecutionName(nextRecoveryExecutionId, 1),
          durableFunctionArn,
          activityFunctionArn,
          adapterConfigSha256,
        },
      ),
    ).resolves.toMatchObject({ created: true });
    await expect(
      store.recordDurableTerminal(
        generationTwentyName,
        "SUCCEEDED",
        generationTwentyArn,
        durableFunctionArn,
      ),
    ).rejects.toThrow("terminal transition is stale");
  });

  it("uses an authenticated delivered message to close every send-to-database race", async () => {
    const deliveryDispatchId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e70";
    const checkpoint = {
      schemaVersion: 1,
      executionId: deliveryExecutionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: deliveryScheduledFor,
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    } as const;
    await store.ensureScheduledOccurrence(checkpoint, {
      id: deliveryDispatchId,
      executionId: deliveryExecutionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: durableIngestionExecutionName(deliveryExecutionId, 1),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    const delivery = {
      dispatchId: deliveryDispatchId,
      executionId: deliveryExecutionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    } as const;
    const boundary = { durableFunctionArn, activityFunctionArn };
    const claimId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e71";
    const deliveryClaims = await store.claimDispatches(25, claimId);
    expect(deliveryClaims.some((dispatch) => dispatch.id === deliveryDispatchId)).toBe(true);
    await expect(
      store.confirmDispatchDelivery(delivery, {
        ...boundary,
        durableFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:other-ingestion:7",
      }),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(store.getDispatch(deliveryDispatchId)).resolves.toMatchObject({
      state: "claimed",
    });
    await expect(store.confirmDispatchDelivery(delivery, boundary)).resolves.toMatchObject({
      state: "nudged",
      publishAttempts: 1,
    });
    await expect(store.recordDispatchNudged(deliveryDispatchId, claimId)).resolves.toBeUndefined();

    for (const state of ["pending", "publish_failed", "recovery_exhausted"] as const) {
      await client.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL session_replication_role = replica");
        await transaction.unsafe(
          `UPDATE jobs.ingestion_dispatches SET state=$2, publish_attempts=$3,
             last_error_code=$4, updated_at=clock_timestamp()
           WHERE id=$1`,
          [
            deliveryDispatchId,
            state,
            state === "pending" ? 1 : 5,
            state === "pending"
              ? "TimeoutError"
              : state === "publish_failed"
                ? "IngestionDispatchFailure"
                : "TransportRecoveryExhausted",
          ],
        );
      });
      const confirmed = await store.confirmDispatchDelivery(delivery, boundary);
      expect(confirmed).toMatchObject({
        state: "nudged",
        publishAttempts: state === "pending" ? 1 : 5,
      });
      expect(confirmed.lastErrorCode).toBeUndefined();
    }
    const executionArn = `${durableFunctionArn}/durable-execution/${durableIngestionExecutionName(deliveryExecutionId, 1)}/deliveredExecution01`;
    await store.recordDurableStart(deliveryDispatchId, executionArn);
    await expect(store.confirmDispatchDelivery(delivery, boundary)).resolves.toMatchObject({
      state: "started",
      durableExecutionId: "deliveredExecution01",
    });
    await expect(
      store.confirmDispatchDelivery({ ...delivery, checkpointRevision: 1 }, boundary),
    ).rejects.toThrow("conflicts with persisted truth");
    await expect(store.getDispatch(deliveryDispatchId)).resolves.toMatchObject({
      state: "started",
      durableExecutionId: "deliveredExecution01",
    });
  });
});
