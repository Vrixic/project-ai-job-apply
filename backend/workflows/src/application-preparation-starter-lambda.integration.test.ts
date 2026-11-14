import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ApplicationStoreOptions,
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createApplicationPreparationStarterLambda,
  createApplicationPreparationStarterRuntime,
} from "./application-preparation-starter-lambda.js";

const { createSyntheticPacketProtection } = await import(
  new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const packetProtection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  destroy(): void;
};

const requested = process.env.PRIVATE_PREPARATION_STARTER_INTEGRATION === "1";
const url = process.env.PRIVATE_PREPARATION_STARTER_TEST_DATABASE_URL ?? "postgres://invalid";
if (requested) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/private_preparation_starter_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("PrivatePreparationStarterIntegrationTargetRejected");
}
const execute = promisify(execFile);
describe.skipIf(!requested)("native SQS starter through owning Applications ledger", () => {
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
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    packetProtection.destroy();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await sql.end();
  });
  it.each([
    "normal",
    "drain_bound",
    "drain_unbound",
    "invoke_ack",
    "mark_ack",
    "retained",
    "unretained",
    "inactive",
    "sdk_retry_config",
  ] as const)("preserves original accepted binding: %s", async (fault) => {
    let now = new Date();
    const store = new PostgresApplicationStore(sql, () => now, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
    });
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
          disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
        },
      },
      packet: { jobRevision: "a".repeat(64), form: null, fields: [], artifactHashes: {} },
    });
    const [event] = await sql<
      Array<{ id: string }>
    >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${queued.preparation.id}`;
    if (!event) throw Error("SyntheticMissingPreparationEvent");
    const durable = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:7";
    const older = durable.replace(":7", ":6");
    if (fault === "retained" || fault === "unretained" || fault === "drain_bound") {
      expect(
        (await store.claimPreparationDispatch(event.id, older, queued.preparation.id)).kind,
      ).toBe("claimed");
      now = new Date(now.getTime() + 60001);
    }
    if (fault === "inactive")
      await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
    if (fault === "mark_ack") {
      const original = PostgresApplicationStore.prototype.markPreparationStarted;
      let lost = false;
      vi.spyOn(PostgresApplicationStore.prototype, "markPreparationStarted").mockImplementation(
        async function (this: PostgresApplicationStore, ...args: Parameters<typeof original>) {
          const result = await original.apply(this, args);
          if (!lost) {
            lost = true;
            throw Error("SyntheticCommittedSQLAckLost");
          }
          return result;
        },
      );
    }
    const lambda = new LambdaClient({
      region: "us-east-2",
      maxAttempts: fault === "sdk_retry_config" ? 2 : 1,
      ignoreConfiguredEndpointUrls: true,
    });
    const executions = new Map<string, string>();
    const wires: string[] = [];
    const send = vi.spyOn(lambda, "send").mockImplementation(async (command: unknown) => {
      if (!(command instanceof InvokeCommand)) throw Error("SyntheticUnexpectedCommand");
      expect(command.input.InvocationType).toBe("Event");
      expect(command.input.FunctionName).toBe(
        fault === "retained" || fault === "drain_bound" ? older : durable,
      );
      expect(command.input.LogType).toBeUndefined();
      const body = new TextDecoder().decode(command.input.Payload as Uint8Array);
      wires.push(body);
      expect(body).not.toContain(owner);
      expect(JSON.parse(body)).toEqual({
        schemaVersion: 1,
        eventId: event.id,
        eventType: "application.packet-preparation.requested.v1",
        data: { preparationId: queued.preparation.id },
      });
      const name = command.input.DurableExecutionName;
      if (!name) throw Error("SyntheticMissingExecutionName");
      const arn =
        executions.get(name) ??
        `${command.input.FunctionName}/durable-execution/${name}/synthetic-execution`;
      executions.set(name, arn);
      if (fault === "invoke_ack" && send.mock.calls.length === 1)
        throw Error("SyntheticAcceptedInvokeAckLost");
      return { StatusCode: 202, DurableExecutionArn: arn } as never;
    });
    const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-starter:9";
    const queue = "arn:aws:sqs:us-east-2:123456789012:synthetic-preparation";
    const env = {
      APPLICATION_PREPARATION_STARTER_ENABLED: "true",
      APPLICATION_PREPARATION_INTAKE_ENABLED: fault.startsWith("drain_") ? "false" : "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-starter",
      AWS_LAMBDA_FUNCTION_VERSION: "9",
      AWS_SESSION_TOKEN: "synthetic-token",
      DATABASE_SECRET_ID:
        "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
      APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN: durable,
      APPLICATION_PREPARATION_QUEUE_ARN: queue,
      ...(fault === "retained" || fault === "drain_bound"
        ? { APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS: JSON.stringify([older, durable]) }
        : {}),
    };
    const secret = vi.fn(async () => url);
    const handler = createApplicationPreparationStarterLambda({
      environment: () => env,
      resolveDatabaseUrl: secret,
      createRuntime: (databaseUrl, config, enabled) => {
        const runtime = createApplicationPreparationStarterRuntime(databaseUrl, config, enabled, {
          client: lambda,
          clock: () => now,
        });
        runtimes.push({
          close: async () => {
            await runtime.close();
            lambda.destroy();
          },
        });
        return runtime;
      },
    });
    const payload = {
      schemaVersion: 1,
      eventId: event.id,
      eventType: "application.packet-preparation.requested.v1",
      data: { preparationId: queued.preparation.id },
    };
    const batch = {
      Records: [
        {
          messageId: "synthetic-1",
          eventSource: "aws:sqs",
          eventSourceARN: queue,
          body: JSON.stringify(payload),
        },
      ],
    };
    const result = await handler(batch, { invokedFunctionArn: target });
    const refused = ["inactive", "unretained", "sdk_retry_config", "drain_unbound"].includes(fault);
    expect(result.batchItemFailures).toHaveLength(
      refused || fault === "invoke_ack" || fault === "mark_ack" ? 1 : 0,
    );
    if (fault === "invoke_ack") {
      expect((await handler(batch, { invokedFunctionArn: target })).batchItemFailures).toHaveLength(
        1,
      );
      expect(send).toHaveBeenCalledTimes(1);
      now = new Date(now.getTime() + 60001);
    }
    expect((await handler(batch, { invokedFunctionArn: target })).batchItemFailures).toHaveLength(
      refused ? 1 : 0,
    );
    expect(send).toHaveBeenCalledTimes(refused ? 0 : fault === "invoke_ack" ? 2 : 1);
    expect(executions.size).toBe(refused ? 0 : 1);
    expect(new Set(wires).size).toBe(refused ? 0 : 1);
    expect(secret).toHaveBeenCalledTimes(1);
    const binding = await store.getPreparationDispatch(event.id);
    expect(binding?.functionArn).toBe(
      fault === "retained" || fault === "unretained" || fault === "drain_bound"
        ? older
        : fault === "inactive" || fault === "drain_unbound"
          ? undefined
          : durable,
    );
    if (!refused) expect(binding?.executionArn).toBe([...executions.values()][0]);
    const preparation = await store.getPreparation(
      owner,
      created.view.application.id,
      queued.preparation.id,
    );
    expect(preparation.approvedAt).toEqual(queued.preparation.approvedAt);
    expect(preparation.expiresAt).toEqual(queued.preparation.expiresAt);
  });
});
