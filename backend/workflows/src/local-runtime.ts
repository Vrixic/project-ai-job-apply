import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import type { OutboxNudgeV1 } from "@ai-job-apply/event-contracts";
import { createLogger, shutdownTelemetry } from "@ai-job-apply/observability";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { createProfileReadinessDurableHandler } from "./profile-readiness-durable.js";
import { createProfileReadinessActivityHandler } from "./profile-readiness-lambda.js";
import {
  type DurableExecutionClient,
  type DurableExecutionPayloadV1,
  ServerlessOutboxReconciler,
  ServerlessOutboxStarter,
} from "./serverless-outbox.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the local durable runtime");
}

const localActivityArn =
  "arn:aws:lambda:us-east-2:000000000000:function:local-profile-readiness-activity:1";
const logger = createLogger({
  service: "local-durable-runtime",
  level: process.env.LOG_LEVEL ?? "info",
  releaseSha: process.env.RELEASE_SHA ?? "local",
});
const store = new PostgresProfileStore(createDatabase(databaseUrl), {
  dispatchTarget: "lambda_durable",
});

await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

const durable: DurableExecutionClient = {
  async start(input: {
    executionName: string;
    payload: DurableExecutionPayloadV1;
  }): Promise<{ executionArn?: string }> {
    const runner = new LocalDurableTestRunner({
      handlerFunction: createProfileReadinessDurableHandler(localActivityArn),
    });
    runner.registerFunction(localActivityArn, createProfileReadinessActivityHandler(store));
    const result = await runner.run({ payload: input.payload });
    if (result.getStatus() !== ExecutionStatus.SUCCEEDED) {
      throw new Error("LocalDurableExecutionFailed");
    }
    logger.info({ execution_name: input.executionName }, "local durable execution completed");
    return {};
  },
};

const starter = new ServerlessOutboxStarter(store, durable, logger);
const reconciler = new ServerlessOutboxReconciler(
  store,
  {
    publish: async (nudge: OutboxNudgeV1) => starter.process(nudge),
  },
  logger,
  { retryDelaySeconds: 1 },
);

let reconciliation: Promise<void> | undefined;
const reconcile = (): Promise<void> => {
  if (reconciliation) {
    return reconciliation;
  }
  const current = reconciler
    .reconcileOnce()
    .then(() => undefined)
    .finally(() => {
      if (reconciliation === current) {
        reconciliation = undefined;
      }
    });
  reconciliation = current;
  return current;
};
const triggerReconciliation = () => {
  void reconcile().catch(() => {
    logger.warn("local durable outbox reconciliation will retry");
  });
};

const timer = setInterval(triggerReconciliation, 500);
timer.unref();
triggerReconciliation();
logger.info("local Lambda durable outbox runtime started");

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearInterval(timer);
  await reconciliation?.catch(() => undefined);
  await store.close();
  await LocalDurableTestRunner.teardownTestEnvironment();
  await shutdownTelemetry();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
