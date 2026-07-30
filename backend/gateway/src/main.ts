import "reflect-metadata";
import { createOidcVerifier } from "@ai-job-apply/auth";
import { loadBackendConfig } from "@ai-job-apply/config";
import {
  createLogger,
  shutdownTelemetry,
  startLogDeliveryHeartbeat,
} from "@ai-job-apply/observability";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule, applyRequestContext } from "./app.module.js";

const config = loadBackendConfig();
const logger = createLogger({
  service: "gateway",
  level: config.LOG_LEVEL,
  releaseSha: config.RELEASE_SHA,
});
const database = createDatabase(config.DATABASE_URL);
const store = new PostgresProfileStore(database);
const verifier = createOidcVerifier({
  issuer: config.OIDC_ISSUER,
  audience: config.OIDC_AUDIENCE,
});

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule.register({ store, verifier, releaseSha: config.RELEASE_SHA }),
  new FastifyAdapter({ loggerInstance: logger }),
  { bufferLogs: false },
);
app.enableCors({
  origin: false,
  methods: ["GET", "PUT"],
});
app.getHttpAdapter().getInstance().addHook("onRequest", applyRequestContext);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info({ port: config.PORT }, "gateway started");
const stopLogDeliveryHeartbeat = startLogDeliveryHeartbeat(logger);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopLogDeliveryHeartbeat();
  await app.close();
  await store.close();
  await shutdownTelemetry();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
