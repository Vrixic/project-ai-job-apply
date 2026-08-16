import type { AccessTokenVerifier } from "@ai-job-apply/auth";
import type { EntitlementReadService } from "@ai-job-apply/billing-service";
import type { DocumentStore } from "@ai-job-apply/documents-service";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import type { MatchAssessments, SavedJobs } from "@ai-job-apply/matching-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule, applyRequestContext } from "./app.module.js";

export interface GatewayApplicationOptions {
  store: ProfileStore;
  catalog: JobCatalogReader;
  savedJobs: SavedJobs;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
  documents: DocumentStore;
  verifier: AccessTokenVerifier;
  releaseSha: string;
  clock?: () => Date;
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
      savedJobs: options.savedJobs,
      matchAssessments: options.matchAssessments,
      entitlements: options.entitlements,
      documents: options.documents,
      verifier: options.verifier,
      releaseSha: options.releaseSha,
      ...(options.clock ? { clock: options.clock } : {}),
    }),
    options.adapter ?? new FastifyAdapter(),
    { bufferLogs: false },
  );
  app.enableCors({
    origin: false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  });
  app.getHttpAdapter().getInstance().addHook("onRequest", applyRequestContext);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
