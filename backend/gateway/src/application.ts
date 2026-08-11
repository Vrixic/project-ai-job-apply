import type { AccessTokenVerifier } from "@ai-job-apply/auth";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule, applyRequestContext } from "./app.module.js";

export interface GatewayApplicationOptions {
  store: ProfileStore;
  catalog: JobCatalogReader;
  verifier: AccessTokenVerifier;
  releaseSha: string;
  adapter?: FastifyAdapter;
}

/**
 * Creates the single gateway application used by the local HTTP server and Lambda adapter.
 * Keeping transport startup outside this factory prevents the two runtimes from drifting.
 */
export async function createGatewayApplication(
  options: GatewayApplicationOptions,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({
      store: options.store,
      catalog: options.catalog,
      verifier: options.verifier,
      releaseSha: options.releaseSha,
    }),
    options.adapter ?? new FastifyAdapter(),
    { bufferLogs: false },
  );
  app.enableCors({
    origin: false,
    methods: ["GET", "PUT"],
  });
  app.getHttpAdapter().getInstance().addHook("onRequest", applyRequestContext);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
