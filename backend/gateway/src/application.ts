import {
  type ApplicationsApi,
  ApplicationsUnavailableError,
} from "@ai-job-apply/applications-service";
import type { AccessTokenVerifier, IdTokenVerifier } from "@ai-job-apply/auth";
import type { EntitlementReadService } from "@ai-job-apply/billing-service";
import type { DocumentStore } from "@ai-job-apply/documents-service";
import type {
  ContributionCapabilityPolicySource,
  JobCatalogReader,
  JobContributions,
  JobModeration,
  JobReports,
} from "@ai-job-apply/jobs-service";
import {
  type MatchAssessments,
  PrivateCaptureUnavailableError,
  type PrivateSavedPageCaptures,
  type SavedJobs,
} from "@ai-job-apply/matching-service";
import {
  type ProfileStore,
  type ProfileSectionStore,
  type RestrictedAnswerVaultStore,
  type UgcContributionConsentStore,
  UgcContributionConsentUnavailableError,
} from "@ai-job-apply/profile-service";
import type { PrivilegedModerationAuditWriter } from "@ai-job-apply/profile-service/privileged-moderation-audit";
import { TrustApplicationService } from "@ai-job-apply/trust-service";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  AppModule,
  applyRequestContext,
  type CandidateDataExportDownloadSigner,
  type NotificationsApi,
} from "./app.module.js";
import type { NativeMaterialWithdrawalApi } from "./native-owner-material-cleanup.js";
import { type StripeBillingGateway, installStripeWebhookRawBody } from "./stripe-billing.js";
import { installTemporaryMaterialResponseGuards } from "./temporary-material-http.js";
import {
  OidcTrustReviewerAuthority,
  type TrustReviewerAssignment,
} from "./trust-reviewer-authority.js";

export interface GatewayApplicationOptions {
  store: ProfileStore;
  restrictedAnswerVault?: RestrictedAnswerVaultStore;
  profileSections?: ProfileSectionStore;
  catalog: JobCatalogReader;
  jobReports: JobReports;
  jobContributions: JobContributions;
  contributionCapabilityPolicy?: ContributionCapabilityPolicySource;
  ugcContributionConsents?: UgcContributionConsentStore;
  ugcContributionPolicyVersion?: string;
  moderation: JobModeration;
  privilegedModerationAudit?: PrivilegedModerationAuditWriter;
  savedJobs: SavedJobs;
  applications?: ApplicationsApi;
  nativeMaterialWithdrawals?: NativeMaterialWithdrawalApi;
  privateSavedPageCaptures?: PrivateSavedPageCaptures;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
  stripeBilling?: StripeBillingGateway;
  notifications?: NotificationsApi;
  documents: DocumentStore;
  trust?: TrustApplicationService;
  trustReviewerAssignments?: readonly TrustReviewerAssignment[];
  candidateDataExportDownloads?: CandidateDataExportDownloadSigner;
  verifier: AccessTokenVerifier;
  idTokenVerifier?: IdTokenVerifier;
  releaseSha: string;
  clock?: () => Date;
  adapter?: FastifyAdapter;
}

/** Applications stay default-off: without a wired store every route fails closed with 503. */
function unavailableApplications(): ApplicationsApi {
  const fail = async (): Promise<never> => {
    throw new ApplicationsUnavailableError();
  };
  return {
    create: fail,
    search: fail,
    get: fail,
    resumePreview: fail,
    resumeFile: fail,
    prepareCoverLetter: fail,
    preparation: fail,
    coverLetterPreview: fail,
    coverLetterFile: fail,
    history: fail,
    preparePacket: fail,
    approve: fail,
    reopen: fail,
    cancel: fail,
    startSubmission: fail,
    startManualSubmission: fail,
    dispatchAttempt: fail,
    recordResult: fail,
    reconcile: fail,
  };
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
      ...(options.restrictedAnswerVault
        ? { restrictedAnswerVault: options.restrictedAnswerVault }
        : {}),
      ...(options.profileSections ? { profileSections: options.profileSections } : {}),
      catalog: options.catalog,
      jobReports: options.jobReports,
      jobContributions: options.jobContributions,
      ...(options.contributionCapabilityPolicy
        ? { contributionCapabilityPolicy: options.contributionCapabilityPolicy }
        : {}),
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
      ...(options.privilegedModerationAudit
        ? { privilegedModerationAudit: options.privilegedModerationAudit }
        : {}),
      savedJobs: options.savedJobs,
      applications: options.applications ?? unavailableApplications(),
      ...(options.nativeMaterialWithdrawals
        ? { nativeMaterialWithdrawals: options.nativeMaterialWithdrawals }
        : {}),
      privateSavedPageCaptures:
        options.privateSavedPageCaptures ??
        ({
          async create() {
            throw new PrivateCaptureUnavailableError();
          },
          async get() {
            throw new PrivateCaptureUnavailableError();
          },
          async delete() {
            throw new PrivateCaptureUnavailableError();
          },
        } satisfies PrivateSavedPageCaptures),
      matchAssessments: options.matchAssessments,
      entitlements: options.entitlements,
      ...(options.stripeBilling ? { stripeBilling: options.stripeBilling } : {}),
      ...(options.notifications ? { notifications: options.notifications } : {}),
      documents: options.documents,
      trust: options.trust ?? new TrustApplicationService(),
      trustReviewerAuthority: new OidcTrustReviewerAuthority(
        options.trustReviewerAssignments ?? [],
      ),
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
  installTemporaryMaterialResponseGuards(app.getHttpAdapter().getInstance());
  installStripeWebhookRawBody(app.getHttpAdapter().getInstance());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
