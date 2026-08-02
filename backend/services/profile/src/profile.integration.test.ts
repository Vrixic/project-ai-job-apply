import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PutJobPreferencesRequest } from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, PostgresProfileStore } from "./index.js";

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
      "Database migrations through 0002_serverless_outbox applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Database migrations through 0002_serverless_outbox applied and verified.",
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
        WHERE version = '0002_serverless_outbox'
      `,
    ).toHaveLength(1);
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

    const events = await store.getPendingOutboxEvents(10);
    const event = events.find(
      (candidate) => (candidate.data as { operationId?: string }).operationId === first.operationId,
    );
    expect(event?.data).toEqual({
      preferenceSetId: first.preferences.id,
      version: 1,
      operationId: first.operationId,
    });
    expect(event?.traceparent).toBe(traceparent);
    expect(JSON.stringify(event)).not.toContain("Software Engineer");
    expect(JSON.stringify(event)).not.toContain("New York");
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
          dispatchTarget: string;
          nudgeAttempts: number;
          nudgeLastErrorCode: string;
          publishedAt: Date | null;
        }>
      >`
        SELECT
          dispatch_target AS "dispatchTarget",
          nudge_attempts AS "nudgeAttempts",
          nudge_last_error_code AS "nudgeLastErrorCode",
          published_at AS "publishedAt"
        FROM platform.outbox_events
        WHERE data ->> 'operationId' = ${saved.operationId}
      `;
      expect(row).toMatchObject({
        dispatchTarget: "lambda_durable",
        nudgeAttempts: 1,
        nudgeLastErrorCode: "Error",
        publishedAt: null,
      });
      expect(JSON.stringify(row)).not.toContain("Columbus");
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
            ${new Date(Date.now() + index).toISOString()}::timestamptz
          )
        `;
      }

      const first = await store.claimOutboxNudges(25, new Date(0));
      const second = await store.claimOutboxNudges(25, new Date(0));
      expect(first).toHaveLength(25);
      expect(second).toHaveLength(1);
      expect(new Set([...first, ...second].map((event) => event.id)).size).toBe(26);
      expect(JSON.stringify([...first, ...second])).not.toContain("targetRoles");
    } finally {
      await database.client`
        DELETE FROM platform.outbox_events
        WHERE source = ${source}
      `;
    }
  });
});
