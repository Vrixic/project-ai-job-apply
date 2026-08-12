import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PutJobPreferencesRequest } from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, PostgresProfileStore, ProfileFactVersionConflictError } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresProfileStore", () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const store = new PostgresProfileStore(database);
  const principal: AuthPrincipal = {
    issuer: "https://integration-issuer.invalid/",
    subject: "candidate-1",
    audience: ["ai-job-apply-api"],
    scopes: ["profile:read", "profile:write"],
    email: "candidate@example.test",
  };

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const migrationEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
    };
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: migrationEnvironment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: migrationEnvironment,
    });

    expect(first.stdout.trim()).toBe(
      "Database migrations through 0004_profile_fact_versions applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Database migrations through 0004_profile_fact_versions applied and verified.",
    );
    expect(
      await database.client`
        SELECT version
        FROM platform.schema_migrations
        WHERE version = '0001_foundation'
      `,
    ).toHaveLength(1);
    expect(
      await database.client`
        SELECT version
        FROM platform.schema_migrations
        WHERE version IN (
          '0002_serverless_outbox',
          '0003_retire_legacy_dispatch',
          '0004_profile_fact_versions'
        )
      `,
    ).toHaveLength(3);
  });

  afterAll(async () => {
    await store.close();
  });

  it("commits preferences, operation, audit, and identifier-only outbox data idempotently", async () => {
    const runId = crypto.randomUUID();
    const user = await store.resolveUser(
      { ...principal, subject: `candidate-${runId}` },
      "integration-trace",
    );
    const input: PutJobPreferencesRequest = {
      targetRoles: ["Software Engineer"],
      locations: ["New York, NY"],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const first = await store.putPreferences(
      user.id,
      input,
      `integration-key-${runId}`,
      "integration-trace",
      traceparent,
    );
    const replay = await store.putPreferences(
      user.id,
      input,
      `integration-key-${runId}`,
      "integration-trace",
    );

    expect(replay).toEqual(first);
    expect(await store.getPreferences(user.id)).toEqual(first.preferences);
    const otherUser = await store.resolveUser(
      { ...principal, subject: `candidate-without-preferences-${runId}` },
      "integration-trace",
    );
    expect(await store.getPreferences(otherUser.id)).toBe(null);
    expect(await store.getOperation(user.id, first.operationId)).toMatchObject({
      kind: "profile_readiness",
    });
    expect(
      await store.getOperation("019b4e12-7ea3-7c36-9357-aea35ab542cc", first.operationId),
    ).toBe(null);

    const [event] = await database.client<
      Array<{ data: Record<string, unknown>; traceparent: string | null }>
    >`
      SELECT data, traceparent
      FROM platform.outbox_events
      WHERE type = 'profile.preferences.updated.v1'
        AND data ->> 'operationId' = ${first.operationId}
    `;
    expect(event?.data).toEqual({
      preferenceSetId: first.preferences.id,
      version: 1,
      operationId: first.operationId,
    });
    expect(event?.traceparent).toBe(traceparent);
    expect(JSON.stringify(event)).not.toContain("Software Engineer");
    expect(JSON.stringify(event)).not.toContain("New York");

    await store.markOperationRunning(first.operationId, first.preferences.id);
    await store.markOperationRunning(first.operationId, first.preferences.id);
    const readiness: Parameters<PostgresProfileStore["completeReadinessOperation"]>[2] = {
      completionPercent: 100,
      missingFields: [],
      calculatedAt: "2026-08-02T20:00:00.000Z",
    };
    await store.completeReadinessOperation(first.operationId, first.preferences.id, readiness);
    await store.completeReadinessOperation(first.operationId, first.preferences.id, readiness);
    await store.markOperationRunning(first.operationId, first.preferences.id);
    await store.failReadinessOperation(
      first.operationId,
      first.preferences.id,
      "SyntheticLateFailure",
    );
    const completedOperation = await store.getOperation(user.id, first.operationId);
    expect(completedOperation).toMatchObject({ state: "succeeded" });
    expect(completedOperation).not.toHaveProperty("errorCode");
    const [completionEvents] = await database.client<
      Array<{ count: number; pending: number; allAcknowledged: boolean }>
    >`
      SELECT
        count(*)::integer AS count,
        count(*) FILTER (WHERE published_at IS NULL)::integer AS pending,
        bool_and(published_at IS NOT NULL) AS "allAcknowledged"
      FROM platform.outbox_events
      WHERE type = 'profile.readiness.calculated.v1'
        AND data ->> 'operationId' = ${first.operationId}
    `;
    expect(completionEvents).toEqual({ count: 1, pending: 0, allAcknowledged: true });
  });

  it("keeps profile facts owner-scoped, versioned, idempotent, and immutable in place", async () => {
    const runId = crypto.randomUUID();
    const owner = await store.resolveUser(
      { ...principal, subject: `fact-owner-${runId}` },
      "integration-trace",
    );
    const other = await store.resolveUser(
      { ...principal, subject: `fact-other-${runId}` },
      "integration-trace",
    );
    let factId: string | undefined;
    try {
      const input = {
        kind: "skill" as const,
        key: "programming_language",
        value: "TypeScript",
        sensitivity: "standard" as const,
      };
      const first = await store.createProfileFact(
        owner.id,
        input,
        `fact-create-${runId}`,
        "integration-trace",
      );
      factId = first.id;
      const replay = await store.createProfileFact(
        owner.id,
        input,
        `fact-create-${runId}`,
        "integration-trace",
      );
      expect(replay).toEqual(first);
      expect(await store.listProfileFacts(owner.id)).toMatchObject({
        facts: [{ id: first.id, value: "TypeScript", version: 1 }],
        confirmedCount: 1,
        proposedCount: 0,
      });
      expect(await store.listProfileFacts(other.id)).toEqual({
        facts: [],
        confirmedCount: 0,
        proposedCount: 0,
      });
      expect(
        await store.updateProfileFact(
          other.id,
          first.id,
          { expectedVersion: 1, value: "Unauthorized" },
          `fact-other-update-${runId}`,
          "integration-trace",
        ),
      ).toBe(null);

      const corrected = await store.updateProfileFact(
        owner.id,
        first.id,
        { expectedVersion: 1, value: "TypeScript and JavaScript" },
        `fact-update-${runId}`,
        "integration-trace",
      );
      expect(corrected).toMatchObject({
        id: first.id,
        value: "TypeScript and JavaScript",
        version: 2,
      });
      await expect(
        store.updateProfileFact(
          owner.id,
          first.id,
          { expectedVersion: 1, verification: "rejected" },
          `fact-stale-${runId}`,
          "integration-trace",
        ),
      ).rejects.toBeInstanceOf(ProfileFactVersionConflictError);

      const concurrent = await Promise.allSettled([
        store.updateProfileFact(
          owner.id,
          first.id,
          { expectedVersion: 2, value: "TypeScript, JavaScript, and SQL" },
          `fact-concurrent-a-${runId}`,
          "integration-trace",
        ),
        store.updateProfileFact(
          owner.id,
          first.id,
          { expectedVersion: 2, value: "TypeScript, JavaScript, and Python" },
          `fact-concurrent-b-${runId}`,
          "integration-trace",
        ),
      ]);
      expect(concurrent.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = concurrent.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ProfileFactVersionConflictError);

      let invalidValueCode: string | undefined;
      try {
        await database.client`
          INSERT INTO profile.profile_fact_versions (
            fact_id,
            version,
            kind,
            fact_key,
            fact_value,
            verification,
            sensitivity,
            source_type,
            source_reference
          ) VALUES (
            ${first.id},
            4,
            'skill',
            'programming_language',
            ${JSON.stringify(["valid", 42])}::jsonb,
            'confirmed',
            'standard',
            'user',
            'direct-entry'
          )
        `;
      } catch (error) {
        invalidValueCode = (error as { code?: string }).code;
      }
      expect(invalidValueCode).toBe("23514");

      let mutationCode: string | undefined;
      try {
        await database.client`
          UPDATE profile.profile_fact_versions
          SET fact_key = 'mutated'
          WHERE fact_id = ${first.id} AND version = 1
        `;
      } catch (error) {
        mutationCode = (error as { code?: string }).code;
      }
      expect(mutationCode).toBe("55000");

      const versions = await database.client<Array<{ version: number }>>`
        SELECT version
        FROM profile.profile_fact_versions
        WHERE fact_id = ${first.id}
        ORDER BY version
      `;
      expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    } finally {
      if (factId) {
        await database.client`
          DELETE FROM platform.audit_events WHERE resource_id = ${factId}
        `;
      }
      await database.client`
        DELETE FROM identity.users WHERE id IN (${owner.id}, ${other.id})
      `;
    }
  });

  it("keeps committed work recoverable when the post-commit SQS nudge fails", async () => {
    const runId = crypto.randomUUID();
    let operationId: string | undefined;
    const failingStore = new PostgresProfileStore(database, {
      dispatchTarget: "lambda_durable",
      nudgePublisher: {
        publish: async () => {
          throw new Error("SyntheticSqsFailure");
        },
      },
      nudgeRetryDelaySeconds: 60,
    });
    const user = await failingStore.resolveUser(
      { ...principal, subject: `serverless-candidate-${runId}` },
      "integration-trace",
    );

    try {
      const saved = await failingStore.putPreferences(
        user.id,
        {
          targetRoles: ["Platform Engineer"],
          locations: ["Columbus, OH"],
          workModes: ["hybrid"],
          employmentTypes: ["full_time"],
        },
        `serverless-integration-key-${runId}`,
        "integration-trace",
        traceparent,
      );
      operationId = saved.operationId;

      expect(await failingStore.getOperation(user.id, saved.operationId)).toMatchObject({
        state: "queued",
      });
      const [row] = await database.client<
        Array<{
          eventId: string;
          dispatchTarget: string;
          nudgeAttempts: number;
          nudgeLastErrorCode: string;
          publishedAt: Date | null;
        }>
      >`
      SELECT
        id AS "eventId",
        dispatch_target AS "dispatchTarget",
        nudge_attempts AS "nudgeAttempts",
        nudge_last_error_code AS "nudgeLastErrorCode",
        published_at AS "publishedAt"
      FROM platform.outbox_events
      WHERE data ->> 'operationId' = ${saved.operationId}
      `;
      if (!row) {
        throw new Error("Synthetic serverless outbox row was not created");
      }
      expect(row).toMatchObject({
        dispatchTarget: "lambda_durable",
        nudgeAttempts: 1,
        nudgeLastErrorCode: "Error",
        publishedAt: null,
      });
      expect(JSON.stringify(row)).not.toContain("Columbus");
      const executionName = `outbox-${row.eventId}`;
      await database.client`
        UPDATE platform.outbox_events
        SET durable_execution_name = ${executionName}
        WHERE id = ${row.eventId}
      `;
      await failingStore.failDurableReadinessOperation(executionName, "WorkflowStopped");
      await failingStore.failDurableReadinessOperation(executionName, "WorkflowStopped");
      expect(await failingStore.getOperation(user.id, saved.operationId)).toMatchObject({
        state: "failed",
        errorCode: "WorkflowStopped",
      });
    } finally {
      if (operationId) {
        await database.client`
          DELETE FROM platform.outbox_events
          WHERE data ->> 'operationId' = ${operationId}
            AND dispatch_target = 'lambda_durable'
        `;
      }
    }
  });

  it("claims serverless outbox pages without overlap and advances past the oldest page", async () => {
    const source = `urn:ai-job-apply:integration:${crypto.randomUUID()}`;
    const eventIds = Array.from({ length: 26 }, () => crypto.randomUUID());
    try {
      for (const [index, eventId] of eventIds.entries()) {
        await database.client`
          INSERT INTO platform.outbox_events (
            id,
            type,
            source,
            subject,
            data_schema,
            data,
            dispatch_target,
            created_at
          ) VALUES (
            ${eventId},
            ${"profile.preferences.updated.v1"},
            ${source},
            ${`preference-set/${crypto.randomUUID()}`},
            ${"https://schemas.ai-job-apply.internal/events/profile.preferences.updated.v1.json"},
            ${JSON.stringify({
              preferenceSetId: crypto.randomUUID(),
              version: 1,
              operationId: crypto.randomUUID(),
            })}::jsonb,
            ${"lambda_durable"},
            ${new Date(index).toISOString()}::timestamptz
          )
        `;
      }

      const first = await store.claimOutboxNudges(25, new Date(0));
      const second = await store.claimOutboxNudges(25, new Date(0));
      const claimedForSource = [...first, ...second].filter((event) => event.source === source);
      expect(first).toHaveLength(25);
      expect(first.every((event) => event.source === source)).toBe(true);
      expect(claimedForSource).toHaveLength(26);
      expect(new Set(claimedForSource.map((event) => event.id)).size).toBe(26);
      expect(JSON.stringify(claimedForSource)).not.toContain("targetRoles");
    } finally {
      await database.client`
        DELETE FROM platform.outbox_events
        WHERE source = ${source}
      `;
    }
  });
});
