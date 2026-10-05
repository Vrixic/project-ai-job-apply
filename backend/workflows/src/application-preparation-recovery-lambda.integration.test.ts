import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createApplicationsDatabase,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { GetDurableExecutionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApplicationPreparationRecoveryLambda,
  createApplicationPreparationRecoveryRuntime,
} from "./application-preparation-recovery-lambda.js";

const requested = process.env.PRIVATE_PREPARATION_RECOVERY_INTEGRATION === "1";
const url = process.env.PRIVATE_PREPARATION_RECOVERY_TEST_DATABASE_URL ?? "postgres://invalid";
if (requested) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/private_preparation_recovery_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("PrivatePreparationRecoveryIntegrationTargetRejected");
}
const execute = promisify(execFile);
describe.skipIf(!requested)("native recovery through owning Applications ledger", () => {
  const sql = createApplicationsDatabase(url, { maxConnections: 1 });
  const runtimes: Array<{ close: () => Promise<void> }> = [];
  beforeAll(async () => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const relative of [
      "../../services/profile/dist/src/migrate.js",
      "../../services/applications/dist/src/migrate.js",
    ]) {
      const path = fileURLToPath(new URL(relative, import.meta.url));
      const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url } };
      const first = await execute(process.execPath, [path], options);
      expect((await execute(process.execPath, [path], options)).stdout).toBe(first.stdout);
    }
  }, 90000);
  beforeEach(async () => {
    await sql`TRUNCATE applications.applications CASCADE`;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await sql.end();
  });
  it.each([
    "terminal",
    "lost_start_ack",
    "settle_ack",
    "retained",
    "unretained",
    "mismatched_metadata",
    "scheduled_terminal",
    "scheduled_running",
    "nudge",
    "nudge_withdrawal",
    "sdk_retry_config",
    "nudge_sdk_retry",
  ] as const)("recovers original owning work: %s", async (fault) => {
    let now = new Date();
    const store = new PostgresApplicationStore(sql, () => now);
    const owner = uuidv7();
    await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
    const created = await store.createApplication({
      ownerUserId: owner,
      canonicalJobId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    const queued = await store.queuePreparation({
      ownerUserId: owner,
      applicationId: created.view.application.id,
      idempotencyKey: uuidv7(),
      context: { jobContextHash: "a".repeat(64), confirmedFactsHash: "b".repeat(64) },
      request: {
        expectedRevision: 1,
        coverLetter: {
          disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
        },
      },
      packet: { jobRevision: "a".repeat(64), form: null, fields: [], artifactHashes: {} },
    });
    const [event] = await sql<
      Array<{ id: string }>
    >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${queued.preparation.id}`;
    if (!event) throw Error("SyntheticMissingPreparationEvent");
    const durable = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:7";
    const original =
      fault === "retained" || fault === "unretained" ? durable.replace(":7", ":6") : durable;
    const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-recovery:9";
    const rule = "arn:aws:events:us-east-2:123456789012:rule/synthetic-recovery";
    const queue = "https://sqs.us-east-2.amazonaws.com/123456789012/synthetic-preparation";
    const name = `preparation-${event.id}`;
    const execution = `${original}/durable-execution/${name}/synthetic-execution`;
    const nudging =
      fault === "nudge" || fault === "nudge_withdrawal" || fault === "nudge_sdk_retry";
    if (!nudging) {
      const claim = await store.claimPreparationDispatch(event.id, original, queued.preparation.id);
      if (claim.kind !== "claimed" || !claim.dispatch.leaseId) throw Error("SyntheticClaimMissing");
      if (fault !== "lost_start_ack")
        await store.markPreparationStarted(event.id, claim.dispatch.leaseId, execution);
    }
    const start = new Date(now);
    now = new Date(now.getTime() + 60001);
    const end = new Date(now);
    const scheduled = fault.startsWith("scheduled") || nudging;
    const mode = scheduled ? "reconcile" : "terminal";
    const env: Record<string, string | undefined> = {
      APPLICATION_PREPARATION_RECOVERY_ENABLED: "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-recovery",
      AWS_LAMBDA_FUNCTION_VERSION: "9",
      AWS_SESSION_TOKEN: "synthetic-token",
      DATABASE_SECRET_ID:
        "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
      APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN: durable,
      ...(scheduled
        ? {
            APPLICATION_PREPARATION_RECOVERY_RULE_ARN: rule,
            APPLICATION_PREPARATION_QUEUE_URL: queue,
          }
        : {}),
      ...(nudging ? { APPLICATION_PREPARATION_NUDGES_ENABLED: "true" } : {}),
      ...(fault === "retained"
        ? { APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS: JSON.stringify([original, durable]) }
        : {}),
    };
    const lambda = new LambdaClient({
      region: "us-east-2",
      maxAttempts: fault === "sdk_retry_config" ? 2 : 1,
      ignoreConfiguredEndpointUrls: true,
    });
    const sqs = new SQSClient({
      region: "us-east-2",
      maxAttempts: fault === "nudge_sdk_retry" ? 2 : 1,
      ignoreConfiguredEndpointUrls: true,
    });
    const read = vi.spyOn(lambda, "send").mockImplementation(async (command: unknown) => {
      if (!(command instanceof GetDurableExecutionCommand))
        throw Error("SyntheticUnexpectedCommand");
      expect(command.input).toEqual({
        DurableExecutionArn: execution,
        IncludeExecutionData: false,
      });
      return {
        ExecutionDataIncluded: false,
        DurableExecutionArn: execution,
        DurableExecutionName: name,
        FunctionArn: original.slice(0, original.lastIndexOf(":")),
        Version: original.slice(original.lastIndexOf(":") + 1),
        StartTimestamp: start,
        ...(fault === "scheduled_running"
          ? { Status: "RUNNING" }
          : { Status: "SUCCEEDED", EndTimestamp: end }),
        ...(fault === "mismatched_metadata" ? { Result: "synthetic-injected-text" } : {}),
      };
    });
    const send = vi.spyOn(sqs, "send").mockImplementation(async (command: unknown) => {
      if (!(command instanceof SendMessageCommand)) throw Error("SyntheticUnexpectedCommand");
      expect(command.input.QueueUrl).toBe(queue);
      expect(JSON.parse(command.input.MessageBody ?? "null")).toEqual({
        schemaVersion: 1,
        eventId: event.id,
        eventType: "application.packet-preparation.requested.v1",
        data: { preparationId: queued.preparation.id },
      });
      expect(command.input.MessageBody).not.toContain(owner);
      return { MessageId: "synthetic-message" };
    });
    if (fault === "settle_ack") {
      const originalSettle = PostgresApplicationStore.prototype.settlePreparationExecution;
      let lost = false;
      vi.spyOn(PostgresApplicationStore.prototype, "settlePreparationExecution").mockImplementation(
        async function (
          this: PostgresApplicationStore,
          ...args: Parameters<typeof originalSettle>
        ) {
          const result = await originalSettle.apply(this, args);
          if (!lost) {
            lost = true;
            throw Error("SyntheticCommittedSQLAckLost");
          }
          return result;
        },
      );
    }
    if (fault === "nudge_withdrawal") {
      const originalClaim = PostgresApplicationStore.prototype.claimPreparationNudges;
      vi.spyOn(PostgresApplicationStore.prototype, "claimPreparationNudges").mockImplementation(
        async function (this: PostgresApplicationStore, ...args: Parameters<typeof originalClaim>) {
          const result = await originalClaim.apply(this, args);
          delete env.APPLICATION_PREPARATION_NUDGES_ENABLED;
          return result;
        },
      );
    }
    const secret = vi.fn().mockResolvedValue(url);
    const handler = createApplicationPreparationRecoveryLambda(mode, {
      environment: () => env,
      resolveDatabaseUrl: secret,
      clock: () => now,
      createRuntime: (database, config, runtimeMode, enabled, nudges) => {
        const runtime = createApplicationPreparationRecoveryRuntime(
          database,
          config,
          runtimeMode,
          enabled,
          nudges,
          { lambda, sqs, clock: () => now },
        );
        runtimes.push({
          close: async () => {
            await runtime.close();
            lambda.destroy();
            sqs.destroy();
          },
        });
        return runtime;
      },
    });
    const value = {
      version: "0",
      id: uuidv7(),
      "detail-type": scheduled ? "Scheduled Event" : "Durable Execution Status Change",
      source: scheduled ? "aws.events" : "aws.lambda",
      account: "123456789012",
      time: end.toISOString(),
      region: "us-east-2",
      resources: scheduled ? [rule] : [],
      detail: scheduled
        ? {}
        : {
            durableExecutionArn: execution,
            durableExecutionName: name,
            functionArn: original,
            status: "SUCCEEDED",
            startTimestamp: start.toISOString(),
            endTimestamp: end.toISOString(),
          },
    };
    const refused = ["unretained", "mismatched_metadata", "sdk_retry_config"].includes(fault);
    if (refused || fault === "settle_ack")
      await expect(handler(value, { invokedFunctionArn: target })).rejects.toThrow();
    else if (scheduled)
      expect(await handler(value, { invokedFunctionArn: target })).toEqual({
        inspected: nudging ? 0 : 1,
        settled: fault === "scheduled_terminal" ? 1 : 0,
        sent: fault === "nudge" ? 1 : 0,
        failed: fault === "nudge_withdrawal" || fault === "nudge_sdk_retry" ? 1 : 0,
      });
    else expect(await handler(value, { invokedFunctionArn: target })).toEqual({ handled: true });
    if (fault === "settle_ack")
      expect(await handler(value, { invokedFunctionArn: target })).toEqual({ handled: true });
    const binding = await store.getPreparationDispatch(event.id);
    expect(binding?.functionArn).toBe(nudging ? undefined : original);
    const settled = !refused && !nudging && fault !== "scheduled_running";
    expect(binding?.terminalStatus ?? null).toBe(settled ? "SUCCEEDED" : null);
    const preparation = await store.getPreparation(
      owner,
      created.view.application.id,
      queued.preparation.id,
    );
    expect(preparation.approvedAt).toEqual(queued.preparation.approvedAt);
    expect(preparation.expiresAt).toEqual(queued.preparation.expiresAt);
    expect(preparation.state).toBe(settled ? "failed" : "queued");
    expect(send).toHaveBeenCalledTimes(fault === "nudge" ? 1 : 0);
    expect(read).toHaveBeenCalledTimes(
      nudging || fault === "unretained" || fault === "sdk_retry_config"
        ? 0
        : fault === "settle_ack"
          ? 2
          : 1,
    );
    expect(secret).toHaveBeenCalledTimes(fault === "unretained" ? 0 : 1);
  });
});
