import type { AccessTokenVerifier, IdTokenVerifier } from "@ai-job-apply/auth";
import type { EntitlementReadService } from "@ai-job-apply/billing-service";
import type { DocumentStore } from "@ai-job-apply/documents-service";
import type {
  JobCatalogReader,
  JobContributions,
  JobModeration,
  JobReports,
} from "@ai-job-apply/jobs-service";
import type { MatchAssessments, SavedJobs } from "@ai-job-apply/matching-service";
import {
  type ProfileStore,
  type UgcContributionConsentStore,
  UgcContributionConsentUnavailableError,
} from "@ai-job-apply/profile-service";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  AppModule,
  applyRequestContext,
  type CandidateDataExportDownloadSigner,
} from "./app.module.js";

export interface GatewayApplicationOptions {
  store: ProfileStore;
  catalog: JobCatalogReader;
  jobReports: JobReports;
  jobContributions: JobContributions;
  ugcContributionConsents?: UgcContributionConsentStore;
  ugcContributionPolicyVersion?: string;
  moderation: JobModeration;
  savedJobs: SavedJobs;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
  documents: DocumentStore;
  candidateDataExportDownloads?: CandidateDataExportDownloadSigner;
  verifier: AccessTokenVerifier;
  idTokenVerifier?: IdTokenVerifier;
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
      jobReports: options.jobReports,
      jobContributions: options.jobContributions,
      ugcContributionConsents:
        options.ugcContributionConsents ??
        ({
          async grant() {
            throw new UgcContributionConsentUnavailableError();
          },
          async revoke() {
            throw new UgcContributionConsentUnavailableError();
          },
          async supersede() {
            throw new UgcContributionConsentUnavailableError();
          },
          async verify() {
            return { reason: "unavailable", valid: false } as const;
          },
        } satisfies UgcContributionConsentStore),
      ...(options.ugcContributionPolicyVersion
        ? { ugcContributionPolicyVersion: options.ugcContributionPolicyVersion }
        : {}),
      moderation: options.moderation,
      savedJobs: options.savedJobs,
      matchAssessments: options.matchAssessments,
      entitlements: options.entitlements,
      documents: options.documents,
      ...(options.candidateDataExportDownloads
        ? { candidateDataExportDownloads: options.candidateDataExportDownloads }
        : {}),
      verifier: options.verifier,
      ...(options.idTokenVerifier ? { idTokenVerifier: options.idTokenVerifier } : {}),
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
