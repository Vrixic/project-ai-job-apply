import { loadWorkerConfig } from "@ai-job-apply/config";
import { createLogger, shutdownTelemetry } from "@ai-job-apply/observability";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { createProfileReadinessActivities } from "./activities.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";

const config = loadWorkerConfig();
const logger = createLogger({
  service: "workflow-worker",
  level: config.LOG_LEVEL,
  releaseSha: config.RELEASE_SHA,
});
const database = createDatabase(config.DATABASE_URL);
const store = new PostgresProfileStore(database);
const temporalConnectionOptions = {
  address: config.TEMPORAL_ADDRESS,
  tls: config.TEMPORAL_TLS,
  ...(config.TEMPORAL_API_KEY ? { apiKey: config.TEMPORAL_API_KEY } : {}),
};
const clientConnection = await Connection.connect(temporalConnectionOptions);
const workerConnection = await NativeConnection.connect(temporalConnectionOptions);
const temporal = new Client({
  connection: clientConnection,
  namespace: config.TEMPORAL_NAMESPACE,
});
const workflowsPath = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./workflows.ts" : "./workflows.js", import.meta.url),
);
const worker = await Worker.create({
  connection: workerConnection,
  namespace: config.TEMPORAL_NAMESPACE,
  taskQueue: config.TEMPORAL_TASK_QUEUE,
  workflowsPath,
  activities: createProfileReadinessActivities(store),
});
const dispatcher = new OutboxDispatcher(store, temporal, config.TEMPORAL_TASK_QUEUE, logger);

const shutdown = async () => {
  dispatcher.stop();
  worker.shutdown();
  await store.close();
  await clientConnection.close();
  await workerConnection.close();
  await shutdownTelemetry();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

dispatcher.start();
logger.info({ task_queue: config.TEMPORAL_TASK_QUEUE }, "workflow worker started");
await worker.run();
