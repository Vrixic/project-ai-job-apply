import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PostgresPrivilegedModerationAuditStore,
  privilegedModerationActions,
} from "./privileged-moderation-audit.js";
import {
  createPrivilegedModerationAuditRetentionLambda,
  createPrivilegedModerationAuditRetentionRuntime,
} from "./privileged-moderation-audit-retention-lambda.js";

const requested = process.env.PRIVILEGED_MODERATION_AUDIT_INTEGRATION === "1";
const url = process.env.PRIVILEGED_MODERATION_AUDIT_TEST_DATABASE_URL;
if (requested) {
  const parsed = new URL(url ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/profile_moderation_audit" ||
    parsed.search ||
    parsed.hash
  )
    throw Error("SyntheticAuditDatabaseRejected");
}
describe.runIf(requested)("owning audit capture/365-day expiry with real PostgreSQL", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
  const store = new PostgresPrivilegedModerationAuditStore(sql, () => true);
  const operatorId = `oidc:${"a".repeat(64)}`;
  const input = () => ({ action: privilegedModerationActions[0], operatorId, resourceId: null });
  beforeAll(async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (let replay = 0; replay < 2; replay++)
      await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
        { env: { ...env, DATABASE_URL: url } },
      );
  }, 60_000);
  beforeEach(async () => {
    await sql`DELETE FROM platform.audit_events`;
  });
  afterAll(async () => {
    await sql.end();
  });
  it("records only bounded pseudonymous access/attempt metadata at database time", async () => {
    for (const action of privilegedModerationActions)
      await store.record({ ...input(), action, resourceId: uuidv7() });
    const rows =
      await sql`SELECT user_id,action,resource_type,metadata,trace_id=id::text AS own_trace,
      occurred_at > clock_timestamp()-interval '1 minute' AS fresh FROM platform.audit_events`;
    expect(rows).toHaveLength(4);
    for (const row of rows)
      expect(row).toMatchObject({
        user_id: null,
        resource_type: "job_moderation",
        metadata: { schemaVersion: 1, operatorId },
        own_trace: true,
        fresh: true,
      });
  });
  it("expires only the exact owned old format while retaining recent/foreign/malformed records", async () => {
    await store.record(input());
    await sql`UPDATE platform.audit_events SET occurred_at=clock_timestamp()-interval '366 days'`;
    await store.record(input());
    for (const extra of [
      { action: "profile.fact.confirmed", metadata: { schemaVersion: 1, operatorId } },
      { action: input().action, metadata: { schemaVersion: 1, operatorId, extra: "synthetic" } },
    ]) {
      const id = uuidv7();
      await sql`INSERT INTO platform.audit_events(id,action,resource_type,trace_id,metadata,occurred_at)
        VALUES (${id},${extra.action},'job_moderation',${id},${sql.json(extra.metadata)}::jsonb,clock_timestamp()-interval '366 days')`;
    }
    expect(await store.expire()).toBe(1);
    expect(await store.expire()).toBe(0);
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(3);
  });
  it("keeps records within 365 days and validates disabled/malformed requests without writes", async () => {
    await store.record(input());
    await sql`UPDATE platform.audit_events SET occurred_at=clock_timestamp()-interval '364 days'`;
    expect(await store.expire()).toBe(0);
    await expect(new PostgresPrivilegedModerationAuditStore(sql).record(input())).rejects.toThrow(
      "PrivilegedModerationAuditUnavailable",
    );
    await expect(
      store.record({ ...input(), operatorId: "synthetic-raw-subject" }),
    ).rejects.toThrow();
    await expect(store.expire(1001)).rejects.toThrow();
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(1);
  });
  it("does not export unrelated operator metadata with a candidate", async () => {
    const userId = uuidv7();
    await sql`INSERT INTO identity.users(id) VALUES (${userId})`;
    await store.record(input());
    const [row] = await sql`SELECT profile.export_candidate_data(${userId}::uuid) AS data`;
    expect(JSON.stringify(row?.data)).not.toContain(operatorId);
    await sql`DELETE FROM identity.users WHERE id=${userId}`;
  });
  it("rolls back capture and expiry when the flag is withdrawn during their SQL operation", async () => {
    let checks = 0;
    await expect(
      new PostgresPrivilegedModerationAuditStore(sql, () => ++checks === 1).record(input()),
    ).rejects.toThrow();
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(0);
    await store.record(input());
    await sql`UPDATE platform.audit_events SET occurred_at=clock_timestamp()-interval '366 days'`;
    checks = 0;
    await expect(
      new PostgresPrivilegedModerationAuditStore(sql, () => ++checks === 1).expire(),
    ).rejects.toThrow();
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(1);
  });
  it("bounds simultaneous batches and retains no deleted actor rows", async () => {
    for (let index = 0; index < 5; index++) await store.record(input());
    await sql`UPDATE platform.audit_events SET occurred_at=clock_timestamp()-interval '366 days'`;
    const counts = await Promise.all([store.expire(3), store.expire(3)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts.every((n) => n <= 3)).toBe(true);
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(0);
  });
  it("composes the private Lambda with real bounded owner expiry and withdrawal rollback", async () => {
    for (let index = 0; index < 3; index++) await store.record(input());
    await sql`UPDATE platform.audit_events SET occurred_at=clock_timestamp()-interval '366 days'`;
    const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-audit-expiry:9";
    const env = {
      PRIVILEGED_MODERATION_AUDIT_RETENTION_ENABLED: "true",
      PRIVILEGED_MODERATION_AUDIT_RETENTION_BATCH_LIMIT: "2",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-audit-expiry",
      AWS_LAMBDA_FUNCTION_VERSION: "9",
      AWS_SESSION_TOKEN: "synthetic-session",
      DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-audit-db",
    };
    const request = { schemaVersion: 1, action: "expire" },
      context = { invokedFunctionArn: target };
    const options = {
      environment: () => env,
      resolveDatabaseUrl: async () => {
        if (!url) throw Error("SyntheticAuditDatabaseUnavailable");
        return url;
      },
    };
    const run = createPrivilegedModerationAuditRetentionLambda(options);
    expect(await run(request, context)).toEqual({
      schemaVersion: 1,
      owner: "profile",
      privilegedModerationAuditExpired: 2,
    });
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(1);
    let checks = 0;
    const withdrawn = createPrivilegedModerationAuditRetentionLambda({
      ...options,
      createRuntime: (connection, enabled) =>
        createPrivilegedModerationAuditRetentionRuntime(
          connection,
          () => enabled() && ++checks === 1,
        ),
    });
    await expect(withdrawn(request, context)).rejects.toThrow(
      "PrivilegedModerationAuditRetentionUnavailable",
    );
    expect(await sql`SELECT id FROM platform.audit_events`).toHaveLength(1);
    expect(await run(request, context)).toMatchObject({ privilegedModerationAuditExpired: 1 });
    expect(await run(request, context)).toMatchObject({ privilegedModerationAuditExpired: 0 });
  });
});
