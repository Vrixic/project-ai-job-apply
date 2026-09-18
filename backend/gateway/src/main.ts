import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { createOidcIdTokenVerifier, createOidcVerifier } from "@ai-job-apply/auth";
import {
  BillingEntitlementService,
  EntitlementCache,
  PostgresBillingStore,
} from "@ai-job-apply/billing-service";
import { loadBackendConfig } from "@ai-job-apply/config";
import {
  PostgresDocumentStore,
  S3ResumeUploadSigner,
  UnavailableDocumentStore,
} from "@ai-job-apply/documents-service";
import {
  contributionCapabilityPolicySourceFromEnvironment,
  contributionCapabilitySourceFromEnvironment,
  isDevelopmentContributionCapabilitySource,
  JobContributionService,
  JobModerationService,
  JobReportingService,
  PostgresJobCatalog,
  PostgresJobContributionStore,
  PostgresJobModerationStore,
  PostgresJobReportStore,
} from "@ai-job-apply/jobs-service";
import {
  deriveSavedJobCursorKeys,
  MatchAssessmentService,
  PostgresPrivateSavedPageCaptureStore,
  PostgresSavedJobStore,
  PrivateSavedPageCapturesService,
  SavedJobsService,
} from "@ai-job-apply/matching-service";
import {
  createLogger,
  shutdownTelemetry,
  startLogDeliveryHeartbeat,
} from "@ai-job-apply/observability";
import {
  createDatabase,
  loadCandidateRightsPolicyIfConfigured,
  PostgresProfileStore,
  PostgresUgcContributionConsentStore,
} from "@ai-job-apply/profile-service";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createGatewayApplication } from "./application.js";
import { createApplicationsRuntime, loadFieldDefinitions } from "./applications-runtime.js";
import { S3CandidateDataExportDownloadSigner } from "./candidate-data-export-download-signer.js";
import { S3CandidateDeletionConfirmationJournal } from "./candidate-deletion-confirmation-journal.js";
import {
  configuredUgcContributionPolicyVersion,
  ProfileJobContributionConsentRevoker,
  ProfileJobContributionConsentVerifier,
} from "./job-contribution-consent-verifier.js";
import { deriveJobSearchCursorKeys, deriveModerationCursorKey } from "./job-search-cursor-key.js";
import { PostgresProfilePrivateCaptureAccountStatus } from "./private-capture-account-status.js";
import { JobCatalogSavedJobResolver } from "./saved-job-catalog-resolver.js";

const config = loadBackendConfig();
const logger = createLogger({
  service: "gateway",
  level: config.LOG_LEVEL,
  releaseSha: config.RELEASE_SHA,
});
const database = createDatabase(config.DATABASE_URL);
const candidateRightsPolicy = loadCandidateRightsPolicyIfConfigured(process.env);
const idTokenAudience = config.OIDC_ID_TOKEN_AUDIENCE;
if (candidateRightsPolicy && !idTokenAudience) {
  throw new Error("CandidateRightsIdTokenVerifierConfigurationInvalid");
}
const recoveryBucket = process.env.CANDIDATE_DELETION_RECOVERY_BUCKET;
const recoveryKmsKeyArn = process.env.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN;
if (candidateRightsPolicy && (!recoveryBucket || !recoveryKmsKeyArn)) {
  throw new Error("CandidateDeletionConfirmationJournalConfigurationInvalid");
}
const store = new PostgresProfileStore(database, {
  dispatchTarget: "lambda_durable",
  ...(candidateRightsPolicy ? { candidateRightsPolicy } : {}),
  ...(candidateRightsPolicy && recoveryBucket && recoveryKmsKeyArn
    ? {
        candidateDeletionConfirmationJournal: new S3CandidateDeletionConfirmationJournal(
          recoveryBucket,
          recoveryKmsKeyArn,
        ),
      }
    : {}),
});
const catalog = new PostgresJobCatalog(database.client, {
  searchCursorKeys: deriveJobSearchCursorKeys(config.DATABASE_URL),
});
const jobReports = new JobReportingService(new PostgresJobReportStore(database.client));
const ugcContributionConsents = new PostgresUgcContributionConsentStore(database.client);
const ugcContributionPolicyVersion = configuredUgcContributionPolicyVersion(
  process.env.UGC_CONTRIBUTION_POLICY_VERSION,
);
const contributionCapability = contributionCapabilitySourceFromEnvironment(
  process.env,
  () => new Date(),
);
const contributionCapabilityPolicy =
  contributionCapability && isDevelopmentContributionCapabilitySource(contributionCapability)
    ? null
    : contributionCapabilityPolicySourceFromEnvironment(process.env, () => new Date());
const jobContributions = new JobContributionService(
  new PostgresJobContributionStore(database.client),
  new ProfileJobContributionConsentVerifier(ugcContributionConsents, ugcContributionPolicyVersion),
  contributionCapability ?? undefined,
  undefined,
  new ProfileJobContributionConsentRevoker(ugcContributionConsents),
);
const moderation = new JobModerationService(
  new PostgresJobModerationStore(database.client, deriveModerationCursorKey(config.DATABASE_URL)),
);
const savedJobs = new SavedJobsService(
  new PostgresSavedJobStore(database.client),
  new JobCatalogSavedJobResolver(catalog),
  deriveSavedJobCursorKeys(config.DATABASE_URL),
);
const privateSavedPageCaptures = new PrivateSavedPageCapturesService(
  new PostgresPrivateSavedPageCaptureStore(database.client),
  new PostgresProfilePrivateCaptureAccountStatus(database.client),
);
const matchAssessments = new MatchAssessmentService(store, catalog);
const entitlements = new BillingEntitlementService(
  new PostgresBillingStore(database.client),
  new EntitlementCache({ capacity: 1_000, freshTtlMs: 5_000 }),
);
const documents =
  config.DOCUMENT_UPLOAD_BUCKET && config.DOCUMENT_UPLOAD_KMS_KEY_ARN
    ? new PostgresDocumentStore(
        database.client,
        new S3ResumeUploadSigner({
          bucket: config.DOCUMENT_UPLOAD_BUCKET,
          kmsKeyArn: config.DOCUMENT_UPLOAD_KMS_KEY_ARN,
        }),
      )
    : new UnavailableDocumentStore();
const verifier = createOidcVerifier({
  issuer: config.OIDC_ISSUER,
  audience: config.OIDC_AUDIENCE,
});
const idTokenVerifier =
  candidateRightsPolicy && idTokenAudience
    ? createOidcIdTokenVerifier({
        issuer: config.OIDC_ISSUER,
        audience: idTokenAudience,
      })
    : undefined;
const candidateDataExportDownloads =
  candidateRightsPolicy && process.env.CANDIDATE_DATA_EXPORT_BUCKET
    ? new S3CandidateDataExportDownloadSigner(
        process.env.CANDIDATE_DATA_EXPORT_BUCKET,
        candidateRightsPolicy.downloadGrantLifetimeSeconds,
      )
    : undefined;

// Applications stay dark unless explicitly enabled for local development. The database must already
// have the Applications migration applied, and the taxonomy path must be given explicitly.
const applicationsTaxonomyPath = process.env.APPLICATION_FIELD_TAXONOMY_PATH;
if (process.env.APPLICATIONS_ENABLED === "true" && !applicationsTaxonomyPath) {
  throw new Error("APPLICATION_FIELD_TAXONOMY_PATH is required when APPLICATIONS_ENABLED=true");
}
const applications =
  process.env.APPLICATIONS_ENABLED === "true" && applicationsTaxonomyPath
    ? createApplicationsRuntime({
        client: database.client,
        profile: store,
        documents,
        catalog,
        definitions: loadFieldDefinitions(
          JSON.parse(await readFile(applicationsTaxonomyPath, "utf8")),
        ),
      })
    : undefined;

const app = await createGatewayApplication({
  store,
  catalog,
  jobReports,
  jobContributions,
  ...(contributionCapabilityPolicy ? { contributionCapabilityPolicy } : {}),
  ugcContributionConsents,
  ...(ugcContributionPolicyVersion ? { ugcContributionPolicyVersion } : {}),
  moderation,
  savedJobs,
  ...(applications ? { applications } : {}),
  privateSavedPageCaptures,
  matchAssessments,
  entitlements,
  documents,
  ...(candidateDataExportDownloads ? { candidateDataExportDownloads } : {}),
  verifier,
  ...(idTokenVerifier ? { idTokenVerifier } : {}),
  releaseSha: config.RELEASE_SHA,
  adapter: new FastifyAdapter({ loggerInstance: logger }),
});

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
  await documents.close();
  await shutdownTelemetry();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
