import { legacyReceiptReplayFromEnvironment } from "@ai-job-apply/applications-service/legacy-receipt-runtime";
import { nativeMaterialAvailabilityFromEnvironment } from "./native-material-availability.js";
import { nativeMaterialDisposalFromEnvironment } from "./native-material-disposal-runtime.js";
import "reflect-metadata";
import {
  ApplicationEventOutbox,
  createApplicationsDatabase,
  defaultFieldDefinitions,
} from "@ai-job-apply/applications-service";
import { restrictedPacketWriterFromEnvironment } from "@ai-job-apply/applications-service/restricted-packet-runtime";
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
  NotificationsService,
  PostgresDeliveryStore,
  PostgresNotificationsStore,
} from "@ai-job-apply/notifications-service";
import {
  createLogger,
  shutdownTelemetry,
  startLogDeliveryHeartbeat,
} from "@ai-job-apply/observability";
import {
  createDatabase,
  createProfileSectionStore,
  loadCandidateRightsPolicyIfConfigured,
  PostgresProfileStore,
  PostgresRestrictedAnswerVaultStore,
  PostgresUgcContributionConsentStore,
} from "@ai-job-apply/profile-service";
import { createPrivilegedModerationAuditRuntime } from "@ai-job-apply/profile-service/privileged-moderation-audit";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createGatewayApplication } from "./application.js";
import { createApplicationsRuntime } from "./applications-runtime.js";
import { S3CandidateDataExportDownloadSigner } from "./candidate-data-export-download-signer.js";
import { S3CandidateDeletionConfirmationJournal } from "./candidate-deletion-confirmation-journal.js";
import {
  configuredUgcContributionPolicyVersion,
  ProfileJobContributionConsentRevoker,
  ProfileJobContributionConsentVerifier,
} from "./job-contribution-consent-verifier.js";
import { deriveJobSearchCursorKeys, deriveModerationCursorKey } from "./job-search-cursor-key.js";
import {
  nativeMaterialLocationsFromEnvironment,
  nativeResumeLocationsFromEnvironment,
} from "./native-material-location-runtime.js";
import { withApplicationEventFeed } from "./notifications-feed.js";
import { LambdaOriginalResumeClient } from "./original-resume-client.js";
import { PostgresProfilePrivateCaptureAccountStatus } from "./private-capture-account-status.js";
import { KmsRestrictedAnswerCipher } from "./restricted-answer-kms-cipher.js";
import { resumeLimitsFromEntitlements } from "./resume-limits.js";
import { LambdaResumeTailoringClient } from "./resume-tailoring-client.js";
import { JobCatalogSavedJobResolver } from "./saved-job-catalog-resolver.js";
import { createStripeBillingGateway } from "./stripe-billing.js";

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
const restrictedAnswerVaultKmsKeyArn = process.env.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN;
const restrictedAnswerVault = new PostgresRestrictedAnswerVaultStore(
  database.client,
  restrictedAnswerVaultKmsKeyArn
    ? new KmsRestrictedAnswerCipher(restrictedAnswerVaultKmsKeyArn)
    : undefined,
);
const profileSections = createProfileSectionStore(database.client);
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
const billingStore = new PostgresBillingStore(database.client);
const entitlements = new BillingEntitlementService(
  billingStore,
  new EntitlementCache({ capacity: 1_000, freshTtlMs: 5_000 }),
);
const stripeBilling = createStripeBillingGateway({
  env: process.env,
  reader: billingStore,
  writer: entitlements,
});
const notificationsService =
  process.env.NOTIFICATIONS_ENABLED === "true"
    ? new NotificationsService(new PostgresNotificationsStore(database.client), {
        delivery: new PostgresDeliveryStore(database.client),
        ...(process.env.NOTIFICATIONS_PUSH_PUBLIC_KEY
          ? { pushPublicKey: process.env.NOTIFICATIONS_PUSH_PUBLIC_KEY }
          : {}),
      })
    : undefined;
const notifications = notificationsService
  ? withApplicationEventFeed({
      notifications: notificationsService,
      events: new ApplicationEventOutbox(database.client),
    })
  : undefined;
const documents =
  config.DOCUMENT_UPLOAD_BUCKET && config.DOCUMENT_UPLOAD_KMS_KEY_ARN
    ? new PostgresDocumentStore(
        database.client,
        new S3ResumeUploadSigner({
          bucket: config.DOCUMENT_UPLOAD_BUCKET,
          kmsKeyArn: config.DOCUMENT_UPLOAD_KMS_KEY_ARN,
        }),
        resumeLimitsFromEntitlements(entitlements),
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
// have the Applications migration applied.
const privilegedModerationAudit =
  process.env.PRIVILEGED_MODERATION_AUDIT_ENABLED === "true"
    ? createPrivilegedModerationAuditRuntime(
        config.DATABASE_URL,
        () => process.env.PRIVILEGED_MODERATION_AUDIT_ENABLED === "true",
      )
    : undefined;
const packetProtection = restrictedPacketWriterFromEnvironment(process.env);
const legacyReceipts = legacyReceiptReplayFromEnvironment(
  process.env,
  () => packetProtection?.enabled() === true,
);
const nativeMaterialLocations = nativeMaterialLocationsFromEnvironment(
  config.DATABASE_URL,
  process.env,
  () => packetProtection?.enabled() === true,
);
const nativeResumeLocations = nativeResumeLocationsFromEnvironment(
  config.DATABASE_URL,
  process.env,
  () => packetProtection?.enabled() === true,
);
const nativeMaterialDisposal = nativeMaterialDisposalFromEnvironment(
  config.DATABASE_URL,
  process.env,
);
const applications =
  process.env.APPLICATIONS_ENABLED === "true"
    ? createApplicationsRuntime({
        client: createApplicationsDatabase(config.DATABASE_URL, { maxConnections: 2 }),
        profile: profileSections,
        ...(packetProtection ? { restrictedPackets: packetProtection } : {}),
        ...(legacyReceipts ? { legacyReceipts } : {}),
        ...(nativeMaterialLocations ? { nativeMaterialLocations } : {}),
        ...(nativeResumeLocations ? { nativeResumeLocations } : {}),
        temporaryMaterials: nativeMaterialAvailabilityFromEnvironment(
          process.env,
          () => packetProtection?.enabled() === true,
          nativeMaterialLocations,
          nativeResumeLocations,
          (failure) => logger.warn({ event: "native_material_availability_failed", ...failure }),
        ),
        ...(nativeMaterialDisposal ? { nativeMaterialDisposal } : {}),
        nativeCoverLetterPreparationEnabled: () =>
          process.env.NATIVE_COVER_LETTER_PREPARATION_ENABLED === "true" &&
          process.env.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED === "true" &&
          process.env.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED === "true" &&
          nativeMaterialLocations !== undefined &&
          packetProtection?.enabled() === true,
        nativeResumePreparationEnabled: () =>
          process.env.NATIVE_RESUME_PREPARATION_ENABLED === "true" &&
          packetProtection?.enabled() === true,
        nativeReadAuthorizationsEnabled: () =>
          process.env.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED === "true" &&
          packetProtection?.enabled() === true,
        restrictedAnswerReuseEnabled: process.env.RESTRICTED_ANSWER_REUSE_ENABLED === "true",
        restrictedAnswers: Object.freeze({
          lockCurrentReferences:
            restrictedAnswerVault.lockCurrentReferences.bind(restrictedAnswerVault),
          readSelectedValue: restrictedAnswerVault.readSelectedValue.bind(restrictedAnswerVault),
          readCurrentReference:
            restrictedAnswerVault.readCurrentReference.bind(restrictedAnswerVault),
        }),
        ...(process.env.DOCUMENT_TAILORING_FUNCTION_ARN
          ? {
              tailoring: new LambdaResumeTailoringClient(
                process.env.DOCUMENT_TAILORING_FUNCTION_ARN,
              ),
              // Default off: attaching the candidate's own original file is a separate release gate.
              ...(process.env.UPLOADED_RESUME_ATTACHMENT_ENABLED === "true"
                ? {
                    uploadedResumes: new LambdaOriginalResumeClient(
                      process.env.DOCUMENT_TAILORING_FUNCTION_ARN,
                    ),
                  }
                : {}),
            }
          : {}),
        catalog,
        definitions: defaultFieldDefinitions(),
      })
    : undefined;

const app = await createGatewayApplication({
  store,
  restrictedAnswerVault,
  profileSections,
  catalog,
  jobReports,
  jobContributions,
  ...(contributionCapabilityPolicy ? { contributionCapabilityPolicy } : {}),
  ugcContributionConsents,
  ...(ugcContributionPolicyVersion ? { ugcContributionPolicyVersion } : {}),
  moderation,
  ...(privilegedModerationAudit
    ? { privilegedModerationAudit: privilegedModerationAudit.writer }
    : {}),
  savedJobs,
  ...(applications ? { applications } : {}),
  ...(nativeMaterialDisposal
    ? { nativeMaterialWithdrawals: nativeMaterialDisposal.ownerRequests }
    : {}),
  privateSavedPageCaptures,
  matchAssessments,
  entitlements,
  ...(stripeBilling ? { stripeBilling } : {}),
  ...(notifications ? { notifications } : {}),
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
