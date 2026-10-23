import { createHash } from "node:crypto";
import type {
  AccountDeletionRequest,
  AddNotificationPushSubscriptionRequest,
  Application,
  ApplicationAttempt,
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
  ApplicationHistoryPage,
  ApplicationPacketPreparation,
  ApplicationPage,
  ApplicationResumeFile,
  ApplicationResumePreview,
  ApplicationRevisionRequest,
  ApplicationSearchRequest,
  ApplicationSubmissionResultRequest,
  ApplicationSubmissionStart,
  ApplicationTemporaryMaterialAuthorization,
  ApplicationTemporaryMaterialLocation,
  ApplicationUploadedResumeFile,
  ApproveApplicationPacketRequest,
  CandidateDataExport,
  CandidateDataExportAccess,
  CandidateDataExportDownloadGrant,
  CanonicalJobDetail,
  ConfirmAccountDeletionRequest,
  ConfirmNotificationEmailRequest,
  ConfirmNotificationEmailResult,
  CreateAccountDeletionRequest,
  CreateApplicationRequest,
  CreateCandidateDataExportRequest,
  CreateJobContributionRequest,
  CreateJobReportRequest,
  CreatePrivateSavedPageCaptureRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CreateSavedJobRequest,
  CurrentUser,
  DecideTrustCaseRequest,
  EntitlementSummary,
  FileTrustAppealRequest,
  GrantUgcContributionConsentRequest,
  JobContribution,
  JobContributionHistory,
  JobReport,
  JobReportSummary,
  JobSearchPage,
  JobSearchRequest,
  MatchAssessment,
  ModerationCase,
  ModerationCasePage,
  ModerationCaseSearchRequest,
  NotificationDeliveryStatus as NotificationDeliveryStatusResponse,
  NotificationInboxPage as NotificationInboxPageResponse,
  NotificationItem as NotificationItemResponse,
  NotificationPreferences as NotificationPreferencesResponse,
  NotificationPushSubscriptionCreated,
  NotificationTestSent,
  OpenModerationCaseRequest,
  OpenTrustCaseRequest,
  Operation,
  OwnerTrustCase,
  PrepareApplicationPacketRequest,
  PrivateSavedPageCapture as PrivateSavedPageCaptureResponse,
  ProblemDetails,
  ProfileEntryReference,
  ProfileImportDraft,
  ProfilePersonal,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ReconcileApplicationAttemptRequest,
  RequestNotificationEmailRequest,
  ResolveModerationCaseRequest,
  ResolveTrustAppealRequest,
  RestrictedAnswer,
  RestrictedAnswerCollection,
  ResumeDocumentCollection,
  ReviewerTrustCase,
  ReviewerTrustCasePage,
  ReviewerTrustCaseQueueRequest,
  ReviewerTrustEvidence,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  SaveRestrictedAnswerRequest,
  SignedContributionCapabilityPolicy,
  StartApplicationSubmissionRequest,
  StartManualApplicationSubmissionRequest,
  TakeDownTrustCaseRequest,
  UgcContributionConsentGrant,
  UpdateNotificationPreferencesRequest,
  WithdrawTrustContributionRequest,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator, formatValidationErrors } from "@ai-job-apply/api-contracts";
import {
  type ApplicationsApi,
  ApplicationsUnavailableError,
} from "@ai-job-apply/applications-service";
import {
  type AccessTokenVerifier,
  AuthenticationError,
  type AuthPrincipal,
  bearerToken,
  type IdTokenVerifier,
} from "@ai-job-apply/auth";
import {
  type EntitlementReadService,
  EntitlementUnavailableError,
  StripeAlreadySubscribedError,
  StripeApiError,
  StripeNoBillingAccountError,
  StripeSignatureError,
  StripeWebhookPayloadError,
} from "@ai-job-apply/billing-service";
import {
  DocumentIdempotencyConflictError,
  DocumentIntakeUnavailableError,
  type DocumentStore,
  ResumeDocumentLimitError,
  ResumeNotDeletableError,
  ResumeUploadInProgressError,
} from "@ai-job-apply/documents-service";
import {
  type ContributionCapabilityPolicySource,
  ContributionCapabilityPolicySourceUnavailableError,
  InvalidJobSearchError,
  InvalidModerationCursorError,
  JobAlreadyReportedError,
  type JobCatalogReader,
  JobContributionCancellationConflictError,
  JobContributionConsentRequiredError,
  JobContributionIdempotencyConflictError,
  type JobContributions,
  JobContributionUnavailableError,
  type JobModeration,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  JobReportServiceUnavailableError,
  type JobReports,
  JobReportTargetUnavailableError,
  JobSearchCatalogChangedError,
  JobSearchServiceUnavailableError,
  ModerationConflictError,
  ModerationServiceUnavailableError,
  ModerationTargetUnavailableError,
} from "@ai-job-apply/jobs-service";
import {
  InvalidSavedJobCursorError,
  MatchAssessmentServiceUnavailableError,
  type MatchAssessments,
  MatchAssessmentTargetUnavailableError,
  MatchAssessmentUnavailableError,
  MatchPreferencesRequiredError,
  PrivateCaptureAccountInactiveError,
  PrivateCaptureAlreadySavedError,
  PrivateCaptureIdempotencyConflictError,
  PrivateCaptureIdempotencyLimitError,
  PrivateCaptureLimitError,
  PrivateCaptureReplayDeletedError,
  PrivateCaptureUnavailableError,
  type PrivateSavedPageCapture,
  type PrivateSavedPageCaptures,
  SavedJobCollectionChangedError,
  SavedJobIdempotencyConflictError,
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
  type SavedJobs,
  SavedJobTargetUnavailableError,
} from "@ai-job-apply/matching-service";
import {
  type InboxItem,
  type InboxState,
  type NotificationPreferences as NotificationPreferencesValue,
  NotificationsError,
  type NotificationsService,
} from "@ai-job-apply/notifications-service";
import { activeTraceparent, correlationId } from "@ai-job-apply/observability";
import {
  AccountQuarantinedError,
  type CandidateDataExportRecord,
  CandidateRightsAuthenticationError,
  CandidateRightsMfaError,
  CandidateRightsPolicyError,
  CandidateRightsTransitionError,
  IdempotencyConflictError,
  type ProfileEntryRecord,
  type ProfileEntrySection,
  ProfileSectionDuplicateError,
  ProfileSectionIdempotencyConflictError,
  ProfileSectionInputError,
  ProfileSectionLimitError,
  ProfileSectionNotFoundError,
  ProfileSectionOrderError,
  ProfileSectionRestrictedQuestionError,
  type ProfileSectionStore,
  ProfileSectionVersionConflictError,
  type ProfileStore,
  RestrictedAnswerVaultConfigurationError,
  RestrictedAnswerVaultConflictError,
  RestrictedAnswerVaultIdempotencyConflictError,
  RestrictedAnswerVaultInputError,
  RestrictedAnswerVaultNotFoundError,
  type RestrictedAnswerVaultStore,
  UgcContributionConsentConflictError,
  type UgcContributionConsentStore,
  UgcContributionConsentUnavailableError,
} from "@ai-job-apply/profile-service";
import type { PrivilegedModerationAuditWriter } from "@ai-job-apply/profile-service/privileged-moderation-audit";
import {
  TrustApplicationError,
  type TrustApplicationService,
  type TrustCase,
  type TrustReviewerRole,
} from "@ai-job-apply/trust-service";
import {
  type ArgumentsHost,
  Catch,
  Controller,
  Delete,
  type DynamicModule,
  type ExceptionFilter,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  type ApplicationsFailure,
  parseGeneratedResumeFormatQuery,
  parseHistoryQuery,
  parseResumeFormatQuery,
  projectApplicationsFailure,
} from "./applications-http.js";
import { withNativeMaterialCredential } from "./native-material-availability.js";
import type { NativeMaterialWithdrawalApi } from "./native-owner-material-cleanup.js";
import type { RawBodyRequest, StripeBillingGateway } from "./stripe-billing.js";
import { temporaryMaterialRequestSignal } from "./temporary-material-http.js";
import {
  type OidcTrustReviewerAuthority,
  TrustReviewerAccessDeniedError,
} from "./trust-reviewer-authority.js";

const PROFILE_STORE = Symbol("PROFILE_STORE");
const RESTRICTED_ANSWER_VAULT = Symbol("RESTRICTED_ANSWER_VAULT");
const PROFILE_SECTIONS = Symbol("PROFILE_SECTIONS");
const JOB_CATALOG = Symbol("JOB_CATALOG");
const JOB_REPORTS = Symbol("JOB_REPORTS");
const JOB_CONTRIBUTIONS = Symbol("JOB_CONTRIBUTIONS");
const CONTRIBUTION_CAPABILITY_POLICY = Symbol("CONTRIBUTION_CAPABILITY_POLICY");
const UGC_CONTRIBUTION_CONSENTS = Symbol("UGC_CONTRIBUTION_CONSENTS");
const UGC_CONTRIBUTION_POLICY_VERSION = Symbol("UGC_CONTRIBUTION_POLICY_VERSION");
const JOB_MODERATION = Symbol("JOB_MODERATION");
const PRIVILEGED_MODERATION_AUDIT = Symbol("PRIVILEGED_MODERATION_AUDIT");
const SAVED_JOBS = Symbol("SAVED_JOBS");
const APPLICATIONS = Symbol("APPLICATIONS");
const NATIVE_MATERIAL_WITHDRAWALS = Symbol("NATIVE_MATERIAL_WITHDRAWALS");
const PRIVATE_SAVED_PAGE_CAPTURES = Symbol("PRIVATE_SAVED_PAGE_CAPTURES");
const MATCH_ASSESSMENTS = Symbol("MATCH_ASSESSMENTS");
const ENTITLEMENTS = Symbol("ENTITLEMENTS");
const STRIPE_BILLING = Symbol("STRIPE_BILLING");
const NOTIFICATIONS = Symbol("NOTIFICATIONS");
const DOCUMENT_STORE = Symbol("DOCUMENT_STORE");
const CANDIDATE_DATA_EXPORT_DOWNLOADS = Symbol("CANDIDATE_DATA_EXPORT_DOWNLOADS");
const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
const ID_TOKEN_VERIFIER = Symbol("ID_TOKEN_VERIFIER");
const RELEASE_SHA = Symbol("RELEASE_SHA");
const CLOCK = Symbol("CLOCK");
const TRUST_APPLICATION = Symbol("TRUST_APPLICATION");
const TRUST_REVIEWER_AUTHORITY = Symbol("TRUST_REVIEWER_AUTHORITY");
export const CANDIDATE_REAUTHENTICATION_HEADER = "x-ai-job-apply-reauthentication";
const MAXIMUM_REAUTHENTICATION_HEADER_BYTES = 16_384;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export async function bindCandidateReauthenticationProof(
  principal: AuthPrincipal,
  header: string | string[] | undefined,
  verifier: IdTokenVerifier | null,
): Promise<AuthPrincipal> {
  if (!verifier) {
    throw new CandidateRightsPolicyError();
  }
  if (
    typeof header !== "string" ||
    Buffer.byteLength(header, "utf8") < 32 ||
    Buffer.byteLength(header, "utf8") > MAXIMUM_REAUTHENTICATION_HEADER_BYTES ||
    !COMPACT_JWT.test(header)
  ) {
    throw new AuthenticationError("A bounded reauthentication proof is required");
  }
  const proof = await verifier.verify(header);
  if (proof.issuer !== principal.issuer || proof.subject !== principal.subject) {
    throw new AuthenticationError("The reauthentication proof identity does not match");
  }
  return {
    ...principal,
    authenticatedAt: proof.authenticatedAt,
    authenticationMethods: proof.authenticationMethods,
  };
}

interface AuthenticatedRequest extends FastifyRequest {
  traceId?: string;
}

export interface CandidateDataExportDownloadSigner {
  createGrant(input: {
    objectKey: string;
    objectVersion: string;
    artifactExpiresAt: Date;
    now: Date;
  }): Promise<CandidateDataExportDownloadGrant>;
}

const SAFE_ERROR_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_ERROR_CODE = /^[A-Z0-9_]{2,32}$/;
const SAFE_CONTRIBUTION_CAUSE_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "COPY_IN_PROGRESS",
  "ERR_BUFFER_TOO_LARGE",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
  "ERR_OUT_OF_RANGE",
  "ERR_STRING_TOO_LONG",
  "MAX_PARAMETERS_EXCEEDED",
  "MESSAGE_NOT_SUPPORTED",
  "NOT_TAGGED_CALL",
  "SASL_SIGNATURE_MISMATCH",
  "UNDEFINED_VALUE",
  "UNSAFE_TRANSACTION",
]);
const SAFE_CONTRIBUTION_CAUSE_TYPES = new Set([
  "Error",
  "PostgresError",
  "RangeError",
  "ReferenceError",
  "TypeError",
]);
const SAFE_ROUTE_TEMPLATES = new Set([
  "/health/live",
  "/health/ready",
  "/v1/me",
  "/v1/me/job-preferences",
  "/v1/me/data-exports",
  "/v1/me/data-exports/:dataExportId",
  "/v1/me/account-deletion-requests",
  "/v1/me/account-deletion-requests/:deletionRequestId",
  "/v1/me/account-deletion-requests/:deletionRequestId/confirm",
  "/v1/profile/personal",
  "/v1/profile/import-drafts",
  "/v1/profile/import-drafts/:draftId",
  "/v1/profile/import-drafts/:draftId/save",
  "/v1/profile/education-entries",
  "/v1/profile/education-entries/reorder",
  "/v1/profile/education-entries/:entryId",
  "/v1/profile/work-experience-entries",
  "/v1/profile/work-experience-entries/reorder",
  "/v1/profile/work-experience-entries/:entryId",
  "/v1/profile/skill-entries",
  "/v1/profile/skill-entries/reorder",
  "/v1/profile/skill-entries/:entryId",
  "/v1/profile/application-answers",
  "/v1/profile/application-answers/:answerId",
  "/v1/resumes",
  "/v1/resumes/uploads",
  "/v1/jobs/search",
  "/v1/jobs/:jobId",
  "/v1/jobs/:jobId/match-assessment",
  "/v1/jobs/:jobId/reports",
  "/v1/jobs/contributions",
  "/v1/jobs/contributions/:contributionId",
  "/v1/jobs/contributions/:contributionId/cancel",
  "/v1/extension/contribution-capability-policy",
  "/v1/trust/contributions/:contributionId",
  "/v1/trust/contributions/:contributionId/withdraw",
  "/v1/trust/contributions/:contributionId/appeals",
  "/v1/admin/trust/cases",
  "/v1/admin/trust/cases/:caseId",
  "/v1/admin/trust/cases/:caseId/evidence",
  "/v1/admin/trust/cases/:caseId/decision",
  "/v1/admin/trust/cases/:caseId/takedown",
  "/v1/admin/trust/cases/:caseId/appeal-resolution",
  "/v1/profile/ugc-contribution-consents",
  "/v1/profile/ugc-contribution-consents/:consentId/revoke",
  "/v1/admin/moderation/cases",
  "/v1/admin/moderation/cases/search",
  "/v1/admin/moderation/cases/:caseId/resolve",
  "/v1/admin/moderation/jobs/:jobId/report-summary",
  "/v1/saved-jobs",
  "/v1/saved-jobs/search",
  "/v1/saved-jobs/:savedJobId",
  "/v1/saved-job-captures",
  "/v1/saved-job-captures/:captureId",
  "/v1/entitlements",
  "/v1/material-withdrawals/:requestId",
  "/v1/applications",
  "/v1/applications/search",
  "/v1/applications/:applicationId",
  "/v1/applications/:applicationId/history",
  "/v1/applications/:applicationId/resume",
  "/v1/applications/:applicationId/resume/file",
  "/v1/applications/:applicationId/resume/uploaded",
  "/v1/applications/:applicationId/packets",
  "/v1/applications/:applicationId/approval",
  "/v1/applications/:applicationId/reopen",
  "/v1/applications/:applicationId/cancel",
  "/v1/applications/:applicationId/submissions",
  "/v1/applications/:applicationId/attempts/:attemptId/dispatch",
  "/v1/applications/:applicationId/attempts/:attemptId/result",
  "/v1/applications/:applicationId/attempts/:attemptId/reconciliation",
  "/v1/operations/:operationId",
]);

export function privacySafeRequestFailure(exception: unknown, routeTemplate: string | undefined) {
  const candidate = exception as { cause?: unknown; code?: unknown; name?: unknown };
  const errorType =
    typeof candidate?.name === "string" && SAFE_ERROR_IDENTIFIER.test(candidate.name)
      ? candidate.name
      : "UnknownError";
  const errorCode =
    typeof candidate?.code === "string" && SAFE_ERROR_CODE.test(candidate.code)
      ? candidate.code
      : "UNKNOWN";
  const directCause = candidate?.cause as
    | { cause?: unknown; code?: unknown; name?: unknown }
    | undefined;
  const cause =
    directCause?.name === "JobContributionStoreStageError" &&
    typeof directCause.code === "string" &&
    /^JOB_STORE_(?:IDENTITY_READ|INSERT|LOCK|OUTBOX|PAYLOAD|QUEUE|REPLAY_READ|RESULT|TRANSACTION)$/u.test(
      directCause.code,
    )
      ? (directCause.cause as { code?: unknown; name?: unknown } | undefined)
      : directCause;
  // A PostgreSQL SQLSTATE is a fixed five-character class code, never data, so it is safe to log for the
  // persistence failures whose stage alone has not been enough to diagnose them.
  const postgresCauseCode =
    ((errorType === "JobContributionUnavailableError" &&
      routeTemplate === "/v1/jobs/contributions") ||
      (errorType === "ResumeUploadRegistrationError" && routeTemplate === "/v1/resumes/uploads")) &&
    typeof cause?.code === "string" &&
    /^(?:08|0A|22|23|25|2D|3D|3F|40|42|53|54|55|57|58|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(cause.code)
      ? cause.code
      : undefined;
  // Driver and runtime errors (for example ERR_INVALID_ARG_TYPE) carry a fixed upper-case code and no data. A
  // SQLSTATE alone missed the D3-024 upload failure, which was a driver error rather than a database error.
  const driverCauseCode =
    !postgresCauseCode &&
    errorType === "ResumeUploadRegistrationError" &&
    routeTemplate === "/v1/resumes/uploads" &&
    typeof cause?.code === "string" &&
    /^[A-Z][A-Z0-9_]{2,63}$/u.test(cause.code)
      ? cause.code
      : undefined;
  const contributionCauseCode =
    errorType === "JobContributionUnavailableError" &&
    routeTemplate === "/v1/jobs/contributions" &&
    typeof cause?.code === "string" &&
    SAFE_CONTRIBUTION_CAUSE_CODES.has(cause.code)
      ? cause.code
      : undefined;
  const contributionCauseType =
    !postgresCauseCode &&
    errorType === "JobContributionUnavailableError" &&
    routeTemplate === "/v1/jobs/contributions" &&
    typeof cause?.name === "string" &&
    SAFE_CONTRIBUTION_CAUSE_TYPES.has(cause.name)
      ? cause.name
      : undefined;
  return {
    event: "unhandled_request_failure",
    route:
      typeof routeTemplate === "string" && SAFE_ROUTE_TEMPLATES.has(routeTemplate)
        ? routeTemplate
        : "unknown",
    error_type: errorType,
    error_code: errorCode,
    ...(postgresCauseCode ? { postgres_cause_code: postgresCauseCode } : {}),
    ...(driverCauseCode ? { driver_cause_code: driverCauseCode } : {}),
    ...(contributionCauseCode ? { contribution_cause_code: contributionCauseCode } : {}),
    ...(contributionCauseType ? { contribution_cause_type: contributionCauseType } : {}),
  } as const;
}

@Injectable()
class RequestIdentity {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(ID_TOKEN_VERIFIER) private readonly idTokenVerifier: IdTokenVerifier | null,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
  ) {}

  async authorize(
    request: AuthenticatedRequest,
    requiredScope:
      | "applications:read"
      | "applications:write"
      | "documents:read"
      | "documents:write"
      | "jobs:read"
      | "jobs:contribute"
      | "jobs:moderate"
      | "jobs:write"
      | "profile:read"
      | "profile:write"
      | "trust:review",
  ) {
    const token = bearerToken(request.headers.authorization);
    const principal = await this.verifier.verify(token);
    if (!principal.scopes.includes(requiredScope)) {
      throw new HttpException("Required permission is missing", HttpStatus.FORBIDDEN);
    }
    return principal;
  }

  async resolve(
    request: AuthenticatedRequest,
    requiredScope:
      | "applications:read"
      | "applications:write"
      | "documents:read"
      | "documents:write"
      | "jobs:read"
      | "jobs:contribute"
      | "jobs:moderate"
      | "jobs:write"
      | "profile:read"
      | "profile:write",
  ): Promise<CurrentUser> {
    const principal = await this.authorize(request, requiredScope);
    return this.store.resolveUser(principal, request.traceId ?? correlationId(undefined));
  }

  async resolveWithPrincipal(
    request: AuthenticatedRequest,
    requiredScope: "profile:read" | "profile:write",
    allowQuarantined = false,
  ) {
    const principal = await this.authorize(request, requiredScope);
    const user = await this.store.resolveUser(
      principal,
      request.traceId ?? correlationId(undefined),
      { allowQuarantined },
    );
    return { principal, user };
  }

  async resolveWithReauthenticationProof(
    request: AuthenticatedRequest,
    requiredScope: "profile:write",
    allowQuarantined = false,
  ) {
    const principal = await this.authorize(request, requiredScope);
    const reauthenticatedPrincipal = await bindCandidateReauthenticationProof(
      principal,
      request.headers[CANDIDATE_REAUTHENTICATION_HEADER],
      this.idTokenVerifier,
    );
    const user = await this.store.resolveUser(
      reauthenticatedPrincipal,
      request.traceId ?? correlationId(undefined),
      { allowQuarantined },
    );
    return { principal: reauthenticatedPrincipal, user };
  }

  async operator(request: AuthenticatedRequest): Promise<string> {
    const principal = await this.authorize(request, "jobs:moderate");
    const digest = createHash("sha256")
      .update("ai-job-apply/moderation-operator/v1\0")
      .update(principal.issuer)
      .update("\0")
      .update(principal.subject)
      .digest("hex");
    return `oidc:${digest}`;
  }
}

@Catch()
class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<FastifyReply>();
    const traceId = request.traceId ?? correlationId(undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let title = "Internal server error";
    let detail: string | undefined;

    if (
      exception instanceof AuthenticationError ||
      exception instanceof CandidateRightsAuthenticationError ||
      exception instanceof CandidateRightsMfaError
    ) {
      status = HttpStatus.UNAUTHORIZED;
      code = "authentication_required";
      title = "Authentication required";
      detail = exception.message;
    } else if (exception instanceof AccountQuarantinedError) {
      status = HttpStatus.FORBIDDEN;
      code = "account_quarantined";
      title = "Account deletion is in progress";
      detail = exception.message;
    } else if (exception instanceof CandidateRightsPolicyError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "candidate_rights_unavailable";
      title = "Candidate rights service unavailable";
      detail = exception.message;
    } else if (exception instanceof CandidateRightsTransitionError) {
      status = HttpStatus.CONFLICT;
      code = "candidate_rights_state_conflict";
      title = "Candidate rights state changed";
      detail = exception.message;
    } else if (exception instanceof IdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionVersionConflictError) {
      status = HttpStatus.CONFLICT;
      code = "version_conflict";
      title = "Profile record version conflict";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      code = "profile_record_not_found";
      title = "Profile record was not found";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionLimitError) {
      status = HttpStatus.CONFLICT;
      code = "profile_section_limit";
      title = "Profile section is full";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionDuplicateError) {
      status = HttpStatus.CONFLICT;
      code = "profile_record_duplicate";
      title = "Profile record already exists";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionOrderError) {
      status = HttpStatus.CONFLICT;
      code = "profile_order_conflict";
      title = "Profile order changed";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionRestrictedQuestionError) {
      status = HttpStatus.BAD_REQUEST;
      code = "restricted_question";
      title = "Restricted question";
      detail = exception.message;
    } else if (exception instanceof ProfileSectionInputError) {
      status = HttpStatus.BAD_REQUEST;
      code = "invalid_profile_record";
      title = "Profile record is invalid";
      detail = exception.message;
    } else if (exception instanceof DocumentIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof ResumeDocumentLimitError) {
      status = HttpStatus.CONFLICT;
      code = "resume_document_limit";
      title = "Resume limit reached";
      detail = exception.message;
    } else if (exception instanceof ResumeUploadInProgressError) {
      status = HttpStatus.CONFLICT;
      code = "resume_upload_in_progress";
      title = "A resume is still being processed";
      detail = exception.message;
    } else if (exception instanceof ResumeNotDeletableError) {
      status = HttpStatus.CONFLICT;
      code = "resume_not_deletable";
      title = "A resume is still being processed";
      detail = exception.message;
    } else if (exception instanceof RestrictedAnswerVaultConflictError) {
      status = HttpStatus.CONFLICT;
      code = "restricted_answer_version_conflict";
      title = "Restricted answer changed";
      detail = exception.message;
    } else if (exception instanceof RestrictedAnswerVaultIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof RestrictedAnswerVaultNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      code = "restricted_answer_not_found";
      title = "Restricted answer was not found";
      detail = exception.message;
    } else if (exception instanceof RestrictedAnswerVaultInputError) {
      status = HttpStatus.BAD_REQUEST;
      code = "invalid_restricted_answer";
      title = "Restricted answer request is invalid";
      detail = exception.message;
    } else if (exception instanceof RestrictedAnswerVaultConfigurationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "restricted_answer_vault_unavailable";
      title = "The restricted answer vault is unavailable";
      detail = exception.message;
    } else if (projectApplicationsFailure(exception) !== null) {
      ({ status, code, title, detail } = projectApplicationsFailure(
        exception,
      ) as ApplicationsFailure);
    } else if (exception instanceof DocumentIntakeUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "document_intake_unavailable";
      title = "Resume intake is unavailable";
      detail = exception.message;
    } else if (exception instanceof InvalidJobSearchError) {
      status = HttpStatus.BAD_REQUEST;
      code = "invalid_job_search";
      title = "Invalid job search";
      detail = exception.message;
    } else if (exception instanceof JobSearchCatalogChangedError) {
      status = HttpStatus.CONFLICT;
      code = "job_search_catalog_changed";
      title = "Job catalog changed";
      detail = exception.message;
    } else if (exception instanceof JobSearchServiceUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "job_search_unavailable";
      title = "Job search is unavailable";
      detail = exception.message;
    } else if (exception instanceof JobReportTargetUnavailableError) {
      status = HttpStatus.NOT_FOUND;
      code = "job_report_target_unavailable";
      title = "Job is unavailable";
      detail = "The requested active job is unavailable for reporting";
    } else if (exception instanceof JobReportIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof JobAlreadyReportedError) {
      status = HttpStatus.CONFLICT;
      code = "job_already_reported";
      title = "Job already reported";
      detail = exception.message;
    } else if (exception instanceof JobReportLimitError) {
      status = HttpStatus.CONFLICT;
      code = "job_report_limit_reached";
      title = "Job-report limit reached";
      detail = exception.message;
    } else if (exception instanceof JobReportServiceUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "job_reporting_unavailable";
      title = "Job reporting unavailable";
      detail = "Job reporting is temporarily unavailable";
    } else if (exception instanceof JobContributionIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof JobContributionCancellationConflictError) {
      status = HttpStatus.CONFLICT;
      code = "job_contribution_requires_trust_withdrawal";
      title = "Trust withdrawal required";
      detail = exception.message;
    } else if (exception instanceof JobContributionConsentRequiredError) {
      status = HttpStatus.CONFLICT;
      code = "job_contribution_consent_required";
      title = "Contribution consent is required";
      detail = exception.message;
    } else if (
      exception instanceof JobContributionUnavailableError ||
      (exception instanceof Error && exception.name === "JobContributionCapabilityDisabledError")
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "job_contribution_unavailable";
      title = "Job contribution unavailable";
      detail = "Job contribution intake is temporarily unavailable";
    } else if (exception instanceof ContributionCapabilityPolicySourceUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "contribution_capability_policy_unavailable";
      title = "Contribution capability policy unavailable";
      detail = "The contribution capability policy is temporarily unavailable";
    } else if (exception instanceof UgcContributionConsentConflictError) {
      status = HttpStatus.CONFLICT;
      code = "ugc_contribution_consent_conflict";
      title = "Contribution consent conflict";
      detail = "The contribution consent command conflicts with current state";
    } else if (exception instanceof UgcContributionConsentUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "ugc_contribution_consent_unavailable";
      title = "Contribution consent unavailable";
      detail = "Contribution consent is temporarily unavailable";
    } else if (exception instanceof InvalidModerationCursorError) {
      status = HttpStatus.BAD_REQUEST;
      code = "invalid_moderation_cursor";
      title = "Invalid moderation cursor";
      detail = exception.message;
    } else if (exception instanceof ModerationConflictError) {
      status = HttpStatus.CONFLICT;
      code = "moderation_case_changed";
      title = "Moderation case changed";
      detail = exception.message;
    } else if (exception instanceof ModerationTargetUnavailableError) {
      status = HttpStatus.NOT_FOUND;
      code = "moderation_target_unavailable";
      title = "Moderation target unavailable";
      detail = exception.message;
    } else if (exception instanceof ModerationServiceUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "moderation_unavailable";
      title = "Moderation unavailable";
      detail = "Moderation is temporarily unavailable";
    } else if (exception instanceof TrustReviewerAccessDeniedError) {
      status = HttpStatus.FORBIDDEN;
      code = "trust_access_denied";
      title = "Trust access denied";
      detail = "The Trust operation is not authorized";
    } else if (exception instanceof TrustApplicationError) {
      const projected = {
        access_denied: [HttpStatus.FORBIDDEN, "trust_access_denied", "Trust access denied"],
        dependency_unavailable: [
          HttpStatus.SERVICE_UNAVAILABLE,
          "trust_unavailable",
          "Trust unavailable",
        ],
        evidence_not_verified: [
          HttpStatus.CONFLICT,
          "trust_evidence_unverified",
          "Trust evidence is not verified",
        ],
        invalid_request: [HttpStatus.BAD_REQUEST, "invalid_trust_request", "Invalid Trust request"],
        invalid_state: [HttpStatus.CONFLICT, "trust_state_conflict", "Trust state changed"],
        not_found: [HttpStatus.NOT_FOUND, "trust_case_not_found", "Trust case not found"],
        policy_unavailable: [
          HttpStatus.SERVICE_UNAVAILABLE,
          "trust_policy_unavailable",
          "Trust policy unavailable",
        ],
        version_conflict: [
          HttpStatus.CONFLICT,
          "trust_version_conflict",
          "Trust case version changed",
        ],
      } as const;
      [status, code, title] = projected[exception.code];
      detail = title;
    } else if (exception instanceof SavedJobIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof SavedJobLimitError) {
      status = HttpStatus.CONFLICT;
      code = "saved_job_limit_reached";
      title = "Saved-job limit reached";
      detail = exception.message;
    } else if (exception instanceof SavedJobIdempotencyLimitError) {
      status = HttpStatus.CONFLICT;
      code = "saved_job_command_limit_reached";
      title = "Saved-job command limit reached";
      detail = exception.message;
    } else if (exception instanceof SavedJobCollectionChangedError) {
      status = HttpStatus.CONFLICT;
      code = "saved_jobs_changed";
      title = "Saved jobs changed";
      detail = exception.message;
    } else if (exception instanceof InvalidSavedJobCursorError) {
      status = HttpStatus.BAD_REQUEST;
      code = "invalid_saved_job_cursor";
      title = "Invalid saved-job cursor";
      detail = exception.message;
    } else if (exception instanceof SavedJobTargetUnavailableError) {
      status = HttpStatus.NOT_FOUND;
      code = "saved_job_target_unavailable";
      title = "Job is unavailable";
      detail = exception.message;
    } else if (
      exception instanceof PrivateCaptureIdempotencyConflictError ||
      exception instanceof PrivateCaptureReplayDeletedError ||
      exception instanceof PrivateCaptureAlreadySavedError
    ) {
      status = HttpStatus.CONFLICT;
      code = "private_capture_conflict";
      title = "Private capture conflict";
      detail = "The private capture command conflicts with current state";
    } else if (
      exception instanceof PrivateCaptureLimitError ||
      exception instanceof PrivateCaptureIdempotencyLimitError
    ) {
      status = HttpStatus.CONFLICT;
      code = "private_capture_limit_reached";
      title = "Private capture limit reached";
      detail = exception.message;
    } else if (exception instanceof PrivateCaptureAccountInactiveError) {
      status = HttpStatus.CONFLICT;
      code = "private_capture_account_unavailable";
      title = "Private capture account unavailable";
      detail = "The account cannot accept private captures";
    } else if (exception instanceof PrivateCaptureUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "private_capture_unavailable";
      title = "Private capture unavailable";
      detail = "Private saved-page capture is temporarily unavailable";
    } else if (exception instanceof MatchAssessmentTargetUnavailableError) {
      status = HttpStatus.NOT_FOUND;
      code = "match_job_unavailable";
      title = "Job is unavailable";
      detail = "The requested active job is unavailable";
    } else if (exception instanceof MatchPreferencesRequiredError) {
      status = HttpStatus.CONFLICT;
      code = "match_preferences_required";
      title = "Job preferences are required";
      detail = exception.message;
    } else if (exception instanceof MatchAssessmentUnavailableError) {
      status = HttpStatus.CONFLICT;
      code = "match_preferences_require_review";
      title = "Job preferences require review";
      detail = "Review and save job preferences before requesting an assessment";
    } else if (exception instanceof MatchAssessmentServiceUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "match_assessment_unavailable";
      title = "Match assessment unavailable";
      detail = "The match assessment is temporarily unavailable";
    } else if (exception instanceof StripeAlreadySubscribedError) {
      status = HttpStatus.CONFLICT;
      code = "billing_already_subscribed";
      title = "Already subscribed";
      detail = "The account already has a Pro subscription";
    } else if (exception instanceof StripeNoBillingAccountError) {
      status = HttpStatus.CONFLICT;
      code = "billing_no_account";
      title = "No billing account";
      detail = "The account has no subscription to manage";
    } else if (exception instanceof StripeApiError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "billing_unavailable";
      title = "Billing unavailable";
      detail = "Billing is temporarily unavailable";
    } else if (exception instanceof NotificationsError) {
      status =
        exception.code === "not_found"
          ? HttpStatus.NOT_FOUND
          : exception.code === "version_conflict" || exception.code === "limit_reached"
            ? HttpStatus.CONFLICT
            : exception.code === "rate_limited"
              ? HttpStatus.TOO_MANY_REQUESTS
              : HttpStatus.BAD_REQUEST;
      code =
        exception.code === "version_conflict" ? "notifications_version_conflict" : exception.code;
      title =
        exception.code === "not_found"
          ? "Notification not found"
          : exception.code === "version_conflict"
            ? "Preferences changed"
            : exception.code === "rate_limited"
              ? "Too many requests"
              : exception.code === "limit_reached"
                ? "Limit reached"
                : "Invalid request";
      detail =
        exception.code === "version_conflict"
          ? "The preferences changed; reload and try again"
          : exception.code === "rate_limited"
            ? "Too many requests were made; try again later"
            : exception.code === "limit_reached"
              ? "This account already has the maximum number of subscribed browsers"
              : "The notification request is invalid";
    } else if (exception instanceof NotificationsUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "notifications_unavailable";
      title = "Notifications unavailable";
      detail = "Notifications are temporarily unavailable";
    } else if (exception instanceof EntitlementUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = "entitlement_unavailable";
      title = "Entitlement status unavailable";
      detail = "Entitlement status is temporarily unavailable";
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        status === HttpStatus.NOT_FOUND
          ? "not_found"
          : status === HttpStatus.FORBIDDEN
            ? "forbidden"
            : status === HttpStatus.BAD_REQUEST
              ? "invalid_request"
              : "request_error";
      title = HttpStatus[status] ?? "Request error";
      detail = exception.message;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      request.log.error(
        privacySafeRequestFailure(exception, request.routeOptions.url),
        "Request failed with a privacy-safe server error classification",
      );
    }

    const problem: ProblemDetails = {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId,
      ...(detail ? { detail } : {}),
    };
    void response
      .header("cache-control", "no-store")
      .status(status)
      .type("application/problem+json")
      .send(problem);
  }
}

@Controller()
@UseFilters(ProblemDetailsFilter)
class HealthController {
  constructor(
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(JOB_CATALOG) private readonly catalog: JobCatalogReader,
    @Inject(JOB_REPORTS) private readonly jobReports: JobReports,
    @Inject(JOB_CONTRIBUTIONS) private readonly jobContributions: JobContributions,
    @Inject(JOB_MODERATION) private readonly moderation: JobModeration,
    @Inject(SAVED_JOBS) private readonly savedJobs: SavedJobs,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementReadService,
    @Inject(RELEASE_SHA) private readonly releaseSha: string,
  ) {}

  @Get("/health/live")
  liveness() {
    return { status: "ok", service: "gateway", releaseSha: this.releaseSha };
  }

  @Get("/health/ready")
  async readiness() {
    try {
      await Promise.all([
        this.store.ping(),
        this.catalog.ping(),
        this.jobReports.ping(),
        this.jobContributions.ping(),
        this.moderation.ping(),
        this.savedJobs.ping(),
        this.entitlements.ping(),
      ]);
      return { status: "ok", service: "gateway", releaseSha: this.releaseSha };
    } catch {
      throw new HttpException("PostgreSQL is unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

const validateSignedContributionCapabilityPolicy = compileComponentValidator(
  "SignedContributionCapabilityPolicy",
);
const MAXIMUM_PUBLIC_CONTRIBUTION_CAPABILITY_POLICY_BYTES = 32 * 1024;

@Controller("/v1/extension")
@UseFilters(ProblemDetailsFilter)
class ExtensionContributionCapabilityPolicyController {
  constructor(
    @Inject(CONTRIBUTION_CAPABILITY_POLICY)
    private readonly source: ContributionCapabilityPolicySource,
  ) {}

  @Get("/contribution-capability-policy")
  @Header("cache-control", "no-store")
  async getPolicy(
    @Req() request: AuthenticatedRequest,
  ): Promise<SignedContributionCapabilityPolicy> {
    if (
      Object.keys((request.query ?? {}) as Record<string, unknown>).length > 0 ||
      request.body !== undefined ||
      (request.headers["content-length"] !== undefined &&
        request.headers["content-length"] !== "0") ||
      request.headers["transfer-encoding"] !== undefined
    ) {
      throw new HttpException("The policy request must not contain input", HttpStatus.BAD_REQUEST);
    }
    const envelope = await this.source.readPublicEnvelope();
    if (
      !envelope ||
      !validateSignedContributionCapabilityPolicy(envelope) ||
      Buffer.byteLength(JSON.stringify(envelope), "utf8") >
        MAXIMUM_PUBLIC_CONTRIBUTION_CAPABILITY_POLICY_BYTES
    ) {
      throw new ContributionCapabilityPolicySourceUnavailableError();
    }
    return structuredClone(envelope) as SignedContributionCapabilityPolicy;
  }
}

const validatePreferences = compileComponentValidator("PutJobPreferencesRequest");
const validateCreateCandidateDataExport = compileComponentValidator(
  "CreateCandidateDataExportRequest",
);
const validateCandidateDataExportAccess = compileComponentValidator("CandidateDataExportAccess");
const validateCreateAccountDeletionRequest = compileComponentValidator(
  "CreateAccountDeletionRequest",
);
const validateConfirmAccountDeletionRequest = compileComponentValidator(
  "ConfirmAccountDeletionRequest",
);
const validateSaveRestrictedAnswer = compileComponentValidator("SaveRestrictedAnswerRequest");
const validatePutProfilePersonal = compileComponentValidator("PutProfilePersonalRequest");
const validateReorderProfileEntries = compileComponentValidator("ReorderProfileEntriesRequest");
const validateSaveProfileImportDraft = compileComponentValidator("SaveProfileImportDraftRequest");
const validateCreateProfileEducationEntry = compileComponentValidator(
  "CreateProfileEducationEntryRequest",
);
const validateUpdateProfileEducationEntry = compileComponentValidator(
  "UpdateProfileEducationEntryRequest",
);
const validateCreateProfileWorkExperienceEntry = compileComponentValidator(
  "CreateProfileWorkExperienceEntryRequest",
);
const validateUpdateProfileWorkExperienceEntry = compileComponentValidator(
  "UpdateProfileWorkExperienceEntryRequest",
);
const validateCreateProfileSkillEntry = compileComponentValidator("CreateProfileSkillEntryRequest");
const validateUpdateProfileSkillEntry = compileComponentValidator("UpdateProfileSkillEntryRequest");
const validateCreateProfileApplicationAnswer = compileComponentValidator(
  "CreateProfileApplicationAnswerRequest",
);
const validateUpdateProfileApplicationAnswer = compileComponentValidator(
  "UpdateProfileApplicationAnswerRequest",
);
const PROFILE_SECTION_VALIDATORS: Readonly<
  Record<
    ProfileEntrySection,
    {
      create: ReturnType<typeof compileComponentValidator>;
      update: ReturnType<typeof compileComponentValidator>;
    }
  >
> = {
  education: {
    create: validateCreateProfileEducationEntry,
    update: validateUpdateProfileEducationEntry,
  },
  workExperience: {
    create: validateCreateProfileWorkExperienceEntry,
    update: validateUpdateProfileWorkExperienceEntry,
  },
  skill: { create: validateCreateProfileSkillEntry, update: validateUpdateProfileSkillEntry },
  applicationAnswer: {
    create: validateCreateProfileApplicationAnswer,
    update: validateUpdateProfileApplicationAnswer,
  },
};

function validProfileBody<T>(
  validate: ReturnType<typeof compileComponentValidator>,
  body: unknown,
): T {
  if (!validate(body)) {
    throw new HttpException(formatValidationErrors(validate.errors), HttpStatus.BAD_REQUEST);
  }
  return body as T;
}

function requireProfileRecordId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpException("Profile record identifier is invalid", HttpStatus.BAD_REQUEST);
  }
  return value;
}

/** Exactly one `expectedVersion` positive integer and nothing else. */
function parseExpectedVersionQuery(query: unknown): number {
  const entries =
    query !== null && typeof query === "object" && !Array.isArray(query)
      ? Object.entries(query as Record<string, unknown>)
      : [];
  const [name, value] = entries[0] ?? [];
  if (entries.length !== 1 || name !== "expectedVersion" || typeof value !== "string") {
    throw new HttpException("expectedVersion is required", HttpStatus.BAD_REQUEST);
  }
  if (!/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new HttpException("expectedVersion must be a positive integer", HttpStatus.BAD_REQUEST);
  }
  return Number(value);
}

function profileCollection(
  section: ProfileEntrySection,
  records: ProfileEntryRecord[],
): { entries: ProfileEntryRecord[] } | { answers: ProfileEntryRecord[] } {
  return section === "applicationAnswer" ? { answers: records } : { entries: records };
}
const RESTRICTED_ANSWER_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const RESTRICTED_ANSWER_QUERY_INVALID = Symbol("RESTRICTED_ANSWER_QUERY_INVALID");

/** Strict bounded query parsing: an absent query is fine; anything but exactly one bounded `context` is not. */
function parseRestrictedAnswerContextQuery(
  query: unknown,
): string | undefined | typeof RESTRICTED_ANSWER_QUERY_INVALID {
  if (query === undefined || query === null) return undefined;
  if (typeof query !== "object" || Array.isArray(query)) return RESTRICTED_ANSWER_QUERY_INVALID;
  const entries = Object.entries(query as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  if (entries.length !== 1) return RESTRICTED_ANSWER_QUERY_INVALID;
  const [name, value] = entries[0] as [string, unknown];
  if (name !== "context" || typeof value !== "string" || value.length < 1 || value.length > 120) {
    return RESTRICTED_ANSWER_QUERY_INVALID;
  }
  return value;
}
const validateCreateResumeUpload = compileComponentValidator("CreateResumeUploadRequest");
const validateJobSearch = compileComponentValidator("JobSearchRequest");
const validateCreateSavedJob = compileComponentValidator("CreateSavedJobRequest");
const validateCreatePrivateSavedPageCapture = compileComponentValidator(
  "CreatePrivateSavedPageCaptureRequest",
);
const validatePrivateSavedPageCapture = compileComponentValidator("PrivateSavedPageCapture");
const validateSavedJobSearch = compileComponentValidator("SavedJobSearchRequest");
const validateCreateApplication = compileComponentValidator("CreateApplicationRequest");
const validateApplicationSearch = compileComponentValidator("ApplicationSearchRequest");
const validatePrepareApplicationPacket = compileComponentValidator(
  "PrepareApplicationPacketRequest",
);
const validateApproveApplicationPacket = compileComponentValidator(
  "ApproveApplicationPacketRequest",
);
const validateApplicationRevision = compileComponentValidator("ApplicationRevisionRequest");
const validateStartApplicationSubmission = compileComponentValidator(
  "StartApplicationSubmissionRequest",
);
const validateStartManualApplicationSubmission = compileComponentValidator(
  "StartManualApplicationSubmissionRequest",
);
const validateApplicationSubmissionResult = compileComponentValidator(
  "ApplicationSubmissionResultRequest",
);
const validateReconcileApplicationAttempt = compileComponentValidator(
  "ReconcileApplicationAttemptRequest",
);
const validateMatchAssessment = compileComponentValidator("MatchAssessment");
const validateCreateJobReport = compileComponentValidator("CreateJobReportRequest");
const validateJobReport = compileComponentValidator("JobReport");
const validateCreateJobContribution = compileComponentValidator("CreateJobContributionRequest");
const validateJobContribution = compileComponentValidator("JobContribution");
const validateJobContributionHistory = compileComponentValidator("JobContributionHistory");
const validateOwnerTrustCase = compileComponentValidator("OwnerTrustCase");
const validateReviewerTrustCase = compileComponentValidator("ReviewerTrustCase");
const validateReviewerTrustQueueRequest = compileComponentValidator(
  "ReviewerTrustCaseQueueRequest",
);
const validateReviewerTrustCasePage = compileComponentValidator("ReviewerTrustCasePage");
const validateReviewerTrustEvidence = compileComponentValidator("ReviewerTrustEvidence");
const validateWithdrawTrustContribution = compileComponentValidator(
  "WithdrawTrustContributionRequest",
);
const validateFileTrustAppeal = compileComponentValidator("FileTrustAppealRequest");
const validateOpenTrustCase = compileComponentValidator("OpenTrustCaseRequest");
const validateDecideTrustCase = compileComponentValidator("DecideTrustCaseRequest");
const validateTakeDownTrustCase = compileComponentValidator("TakeDownTrustCaseRequest");
const validateResolveTrustAppeal = compileComponentValidator("ResolveTrustAppealRequest");
const validateGrantUgcContributionConsent = compileComponentValidator(
  "GrantUgcContributionConsentRequest",
);
const validateUgcContributionConsentGrant = compileComponentValidator(
  "UgcContributionConsentGrant",
);
const validateRevokeUgcContributionConsent = compileComponentValidator(
  "RevokeUgcContributionConsentRequest",
);
const validateCancelJobContribution = compileComponentValidator("CancelJobContributionRequest");
const validateOpenModerationCase = compileComponentValidator("OpenModerationCaseRequest");
const validateResolveModerationCase = compileComponentValidator("ResolveModerationCaseRequest");
const validateModerationCaseSearch = compileComponentValidator("ModerationCaseSearchRequest");
const validateModerationCase = compileComponentValidator("ModerationCase");
const validateModerationCasePage = compileComponentValidator("ModerationCasePage");
const validateJobReportSummary = compileComponentValidator("JobReportSummary");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRUST_CASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireIdempotencyKey(value: unknown): string {
  const key = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (typeof key !== "string" || key.length < 16 || key.length > 128) {
    throw new HttpException(
      "Exactly one Idempotency-Key containing 16 to 128 characters is required",
      HttpStatus.BAD_REQUEST,
    );
  }
  return key;
}

function requireExpectedVersion(value: unknown): number {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (typeof candidate !== "string" || !/^"[1-9][0-9]*"$/.test(candidate)) {
    throw new HttpException(
      "If-Match must contain one quoted positive version",
      HttpStatus.BAD_REQUEST,
    );
  }
  const version = Number(candidate.slice(1, -1));
  if (!Number.isSafeInteger(version)) {
    throw new HttpException(
      "If-Match version is outside the supported range",
      HttpStatus.BAD_REQUEST,
    );
  }
  return version;
}

function projectCandidateDataExport(record: CandidateDataExportRecord): CandidateDataExport {
  return {
    id: record.id,
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    policyVersion: record.policyVersion,
    state: record.state,
    requestedAt: record.requestedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.artifact ? { artifactExpiresAt: record.artifact.expiresAt.toISOString() } : {}),
    ...(record.failureCode ? { failureCode: record.failureCode } : {}),
  } as CandidateDataExport;
}

const ENTITLEMENT_GRANTS = [
  "profile.manage",
  "jobs.search",
  "jobs.save",
  "applications.history",
] as const;

function exactCanonicalDateTime(value: string | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function projectEntitlement(evaluation: Awaited<ReturnType<EntitlementReadService["evaluate"]>>) {
  if (
    evaluation.valid !== true ||
    typeof evaluation.version !== "number" ||
    !Number.isSafeInteger(evaluation.version) ||
    evaluation.version < 0 ||
    !exactCanonicalDateTime(evaluation.evaluatedAt) ||
    !Array.isArray(evaluation.grants) ||
    evaluation.grants.length !== ENTITLEMENT_GRANTS.length ||
    !evaluation.grants.every((grant, index) => grant === ENTITLEMENT_GRANTS[index])
  ) {
    throw new EntitlementUnavailableError();
  }
  const maxStoredResumes = evaluation.limits?.maxStoredResumes;
  if (
    typeof maxStoredResumes !== "number" ||
    !Number.isSafeInteger(maxStoredResumes) ||
    maxStoredResumes < 0 ||
    maxStoredResumes > 1000
  ) {
    throw new EntitlementUnavailableError();
  }
  const base = {
    grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
    limits: { maxStoredResumes },
    version: evaluation.version,
    evaluatedAt: evaluation.evaluatedAt,
  } satisfies Pick<EntitlementSummary, "grants" | "limits" | "version" | "evaluatedAt">;
  if (evaluation.plan === "free") {
    if (
      evaluation.accessState !== "active" ||
      evaluation.accessThrough !== undefined ||
      evaluation.graceThrough !== undefined
    ) {
      throw new EntitlementUnavailableError();
    }
    return { ...base, plan: "free", accessState: "active" } as const;
  }
  if (evaluation.plan !== "pro" || !exactCanonicalDateTime(evaluation.accessThrough)) {
    throw new EntitlementUnavailableError();
  }
  const evaluatedAt = Date.parse(evaluation.evaluatedAt);
  const accessThrough = Date.parse(evaluation.accessThrough);
  if (evaluation.accessState === "grace") {
    if (
      !exactCanonicalDateTime(evaluation.graceThrough) ||
      evaluatedAt < accessThrough ||
      evaluatedAt >= Date.parse(evaluation.graceThrough)
    ) {
      throw new EntitlementUnavailableError();
    }
    return {
      ...base,
      plan: "pro",
      accessState: "grace",
      accessThrough: evaluation.accessThrough,
      graceThrough: evaluation.graceThrough,
    } as const;
  }
  if (
    evaluation.accessState !== "active" ||
    evaluatedAt >= accessThrough ||
    (evaluation.graceThrough !== undefined &&
      (!exactCanonicalDateTime(evaluation.graceThrough) ||
        accessThrough > Date.parse(evaluation.graceThrough)))
  ) {
    throw new EntitlementUnavailableError();
  }
  return {
    ...base,
    plan: "pro",
    accessState: "active",
    accessThrough: evaluation.accessThrough,
    ...(evaluation.graceThrough ? { graceThrough: evaluation.graceThrough } : {}),
  } as const;
}

function exactMatchAssessment(value: unknown, requestedJobId: string): value is MatchAssessment {
  if (!validateMatchAssessment(value)) return false;
  const assessment = value as MatchAssessment;
  if (
    assessment.requestedJobId !== requestedJobId ||
    !exactCanonicalDateTime(assessment.preferenceUpdatedAt) ||
    !exactCanonicalDateTime(assessment.assessedAt) ||
    Date.parse(assessment.preferenceUpdatedAt) > Date.parse(assessment.assessedAt)
  ) {
    return false;
  }
  try {
    const revision = BigInt(assessment.catalogRevision);
    return revision >= 1n && revision <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

function exactJobReport(value: unknown, requestedJobId: string): value is JobReport {
  if (!validateJobReport(value)) return false;
  const report = value as JobReport;
  return (
    report.requestedJobId === requestedJobId &&
    UUID_V7_PATTERN.test(report.id) &&
    UUID_V7_PATTERN.test(report.canonicalJobId) &&
    exactCanonicalDateTime(report.createdAt)
  );
}

function exactJobContribution(value: unknown): value is JobContribution {
  if (!validateJobContribution(value)) return false;
  const contribution = value as JobContribution;
  return (
    UUID_V7_PATTERN.test(contribution.id) &&
    exactCanonicalDateTime(contribution.submittedAt) &&
    exactCanonicalDateTime(contribution.updatedAt) &&
    Date.parse(contribution.updatedAt) >= Date.parse(contribution.submittedAt)
  );
}

function exactJobContributionHistory(value: unknown): value is JobContributionHistory {
  if (!validateJobContributionHistory(value)) return false;
  const { items } = value as JobContributionHistory;
  const ids = new Set<string>();
  return items.every((item, index) => {
    if (!exactJobContribution(item) || ids.has(item.id)) return false;
    ids.add(item.id);
    const previous = items[index - 1];
    return (
      !previous ||
      previous.submittedAt > item.submittedAt ||
      (previous.submittedAt === item.submittedAt && previous.id > item.id)
    );
  });
}

function projectPrivateSavedPageCapture(
  value: PrivateSavedPageCapture,
): PrivateSavedPageCaptureResponse {
  const response: PrivateSavedPageCaptureResponse = {
    schemaVersion: 1,
    id: value.id,
    source: value.source,
    snapshot: value.snapshot,
    capturedAt: value.capturedAt,
    savedAt: value.savedAt,
    ...(value.resolution
      ? {
          resolution: {
            canonicalJobId: value.resolution.canonicalJobId,
            resolvedAt: value.resolution.resolvedAt,
          },
        }
      : {}),
  };
  if (
    !validatePrivateSavedPageCapture(response) ||
    !exactCanonicalDateTime(response.capturedAt) ||
    !exactCanonicalDateTime(response.savedAt) ||
    (response.resolution && !exactCanonicalDateTime(response.resolution.resolvedAt))
  ) {
    throw new PrivateCaptureUnavailableError();
  }
  return response;
}

function projectModerationCase(
  value: Awaited<ReturnType<JobModeration["openCase"]>>,
): ModerationCase {
  const projected = {
    id: value.id,
    target: value.target,
    status: value.status,
    version: value.version,
    openReasonCode: value.openReasonCode,
    openedAt: value.openedAt,
    ...(value.resolution ? { resolution: value.resolution } : {}),
    ...(value.resolutionReasonCode ? { resolutionReasonCode: value.resolutionReasonCode } : {}),
    ...(value.resolvedAt ? { resolvedAt: value.resolvedAt } : {}),
  };
  if (!validateModerationCase(projected)) throw new ModerationServiceUnavailableError();
  return projected as ModerationCase;
}

function validOpenModerationRequest(value: OpenModerationCaseRequest): boolean {
  return value.target.kind === "job"
    ? value.reasonCode === "candidate_reports" || value.reasonCode === "catalog_integrity"
    : value.reasonCode === "source_integrity";
}

function validModerationResolution(value: ResolveModerationCaseRequest): boolean {
  return value.resolution === "no_action"
    ? value.reasonCode === "insufficient_evidence"
    : value.resolution === "block_job"
      ? value.reasonCode === "report_confirmed" || value.reasonCode === "catalog_policy_violation"
      : value.reasonCode === "source_integrity_failure";
}

function hasNoQuery(request: AuthenticatedRequest): boolean {
  return !request.query || Object.keys(request.query as Record<string, unknown>).length === 0;
}

function projectOwnerTrustCase(value: unknown): OwnerTrustCase {
  if (!validateOwnerTrustCase(value)) throw new TrustApplicationError("dependency_unavailable");
  return value as OwnerTrustCase;
}

function projectReviewerTrustCase(value: TrustCase): ReviewerTrustCase {
  const projected = {
    id: value.id,
    contributionId: value.contributionId,
    state: value.state,
    policyVersion: value.policyVersion,
    version: value.version,
    appealed: value.appealCount === 1,
    ...(value.adverseDecision
      ? { appealDeadlineAt: value.adverseDecision.appealDeadlineAt.toISOString() }
      : {}),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
  if (!validateReviewerTrustCase(projected)) {
    throw new TrustApplicationError("dependency_unavailable");
  }
  return projected as ReviewerTrustCase;
}

function requireTrustRequest(
  request: AuthenticatedRequest,
  validate: ((value: unknown) => boolean) & { errors?: unknown },
): void {
  if (!hasNoQuery(request) || !validate(request.body)) {
    throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
  }
}

@Controller("/v1/trust")
@UseFilters(ProblemDetailsFilter)
class OwnerTrustController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(TRUST_APPLICATION) private readonly trust: TrustApplicationService,
  ) {}

  @Get("/contributions/:contributionId")
  @Header("cache-control", "no-store")
  async read(
    @Req() request: AuthenticatedRequest,
    @Param("contributionId") contributionId: string,
  ): Promise<OwnerTrustCase> {
    const user = await this.identity.resolve(request, "jobs:contribute");
    if (
      !hasNoQuery(request) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(contributionId)
    ) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    return projectOwnerTrustCase(
      await this.trust.readOwnerCase({ contributorUserId: user.id, contributionId }),
    );
  }

  @Post("/contributions/:contributionId/withdraw")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async withdraw(
    @Req() request: AuthenticatedRequest,
    @Param("contributionId") contributionId: string,
  ): Promise<OwnerTrustCase> {
    const user = await this.identity.resolve(request, "jobs:contribute");
    if (!UUID_V7_PATTERN.test(contributionId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireTrustRequest(request, validateWithdrawTrustContribution);
    const body = request.body as WithdrawTrustContributionRequest;
    return projectOwnerTrustCase(
      await this.trust.withdrawOwnerContribution({
        contributorUserId: user.id,
        contributionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post("/contributions/:contributionId/appeals")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async appeal(
    @Req() request: AuthenticatedRequest,
    @Param("contributionId") contributionId: string,
  ): Promise<OwnerTrustCase> {
    const user = await this.identity.resolve(request, "jobs:contribute");
    if (!UUID_V7_PATTERN.test(contributionId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireTrustRequest(request, validateFileTrustAppeal);
    const body = request.body as FileTrustAppealRequest;
    return projectOwnerTrustCase(
      await this.trust.appealOwnerDecision({
        contributorUserId: user.id,
        contributionId,
        expectedVersion: body.expectedVersion,
        evidenceDigestSha256: body.evidenceDigestSha256,
      }),
    );
  }
}

@Controller("/v1/admin/trust")
@UseFilters(ProblemDetailsFilter)
class AdminTrustController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(TRUST_APPLICATION) private readonly trust: TrustApplicationService,
    @Inject(TRUST_REVIEWER_AUTHORITY)
    private readonly reviewers: OidcTrustReviewerAuthority,
  ) {}

  private async reviewer(
    request: AuthenticatedRequest,
    role: TrustReviewerRole,
  ): Promise<{ principal: AuthPrincipal; reviewerId: string }> {
    const principal = await this.identity.authorize(request, "trust:review");
    return { principal, reviewerId: this.reviewers.resolve(principal, role) };
  }

  @Get("/cases")
  @Header("cache-control", "no-store")
  async list(@Req() request: AuthenticatedRequest): Promise<ReviewerTrustCasePage> {
    const { reviewerId } = await this.reviewer(request, "case_reader");
    const query = { ...((request.query as Record<string, unknown>) ?? {}) };
    if (query.pageSize !== undefined) {
      if (typeof query.pageSize !== "string" || !/^(?:[1-9]|1[0-9]|2[0-5])$/u.test(query.pageSize))
        throw new TrustApplicationError("invalid_request");
      query.pageSize = Number(query.pageSize);
    }
    if (request.body !== undefined || !validateReviewerTrustQueueRequest(query))
      throw new TrustApplicationError("invalid_request");
    const page = await this.trust.listReviewerCases({
      reviewerId,
      ...(query as ReviewerTrustCaseQueueRequest),
    });
    const projected = {
      items: page.items.map(projectReviewerTrustCase),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
    if (!validateReviewerTrustCasePage(projected))
      throw new TrustApplicationError("dependency_unavailable");
    return projected;
  }

  @Get("/cases/:caseId/evidence")
  @Header("cache-control", "no-store")
  async evidence(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ReviewerTrustEvidence> {
    const { reviewerId } = await this.reviewer(request, "case_reader");
    if (!hasNoQuery(request) || request.body !== undefined || !TRUST_CASE_ID_PATTERN.test(caseId))
      throw new TrustApplicationError("invalid_request");
    const value = await this.trust.readReviewerEvidence({ reviewerId, caseId });
    if (!validateReviewerTrustEvidence(value))
      throw new TrustApplicationError("dependency_unavailable");
    return value;
  }

  @Get("/cases/:caseId")
  @Header("cache-control", "no-store")
  async read(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ReviewerTrustCase> {
    const { reviewerId } = await this.reviewer(request, "case_reader");
    if (!hasNoQuery(request) || request.body !== undefined || !TRUST_CASE_ID_PATTERN.test(caseId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    return projectReviewerTrustCase(await this.trust.readReviewerCase({ reviewerId, caseId }));
  }

  @Post("/cases")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async open(@Req() request: AuthenticatedRequest): Promise<ReviewerTrustCase> {
    const { reviewerId } = await this.reviewer(request, "case_opener");
    requireTrustRequest(request, validateOpenTrustCase);
    const body = request.body as OpenTrustCaseRequest;
    return projectReviewerTrustCase(
      await this.trust.openReview({
        reviewerId,
        contributionId: body.contributionId,
      }),
    );
  }

  @Post("/cases/:caseId/decision")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async decide(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ReviewerTrustCase> {
    const { reviewerId } = await this.reviewer(request, "initial_reviewer");
    if (!TRUST_CASE_ID_PATTERN.test(caseId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireTrustRequest(request, validateDecideTrustCase);
    const body = request.body as DecideTrustCaseRequest;
    return projectReviewerTrustCase(
      await this.trust.decideInitialReview({ reviewerId, caseId, ...body }),
    );
  }

  @Post("/cases/:caseId/takedown")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async takeDown(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ReviewerTrustCase> {
    const { principal, reviewerId } = await this.reviewer(request, "takedown_reviewer");
    if (!TRUST_CASE_ID_PATTERN.test(caseId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireTrustRequest(request, validateTakeDownTrustCase);
    const body = request.body as TakeDownTrustCaseRequest;
    if (body.reasonCode === "verified_requester_takedown") {
      this.reviewers.requireVerifiedRequesterScope(principal);
    }
    return projectReviewerTrustCase(
      await this.trust.takeDownAcceptedContribution({ reviewerId, caseId, ...body }),
    );
  }

  @Post("/cases/:caseId/appeal-resolution")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async resolveAppeal(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ReviewerTrustCase> {
    const { reviewerId } = await this.reviewer(request, "appeal_reviewer");
    if (!TRUST_CASE_ID_PATTERN.test(caseId)) {
      throw new HttpException("The Trust request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireTrustRequest(request, validateResolveTrustAppeal);
    const body = request.body as ResolveTrustAppealRequest;
    return projectReviewerTrustCase(
      await this.trust.resolveAppeal({ reviewerId, caseId, ...body }),
    );
  }
}

@Controller("/v1/admin/moderation")
@UseFilters(ProblemDetailsFilter)
class AdminModerationController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(JOB_MODERATION) private readonly moderation: JobModeration,
    @Inject(PRIVILEGED_MODERATION_AUDIT)
    private readonly audit: PrivilegedModerationAuditWriter | null,
  ) {}

  private async recordAudit(input: Parameters<PrivilegedModerationAuditWriter["record"]>[0]) {
    if (!this.audit) return;
    try {
      await this.audit.record(input);
    } catch {
      throw new ModerationServiceUnavailableError();
    }
  }

  @Post("/cases/search")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async searchCases(@Req() request: AuthenticatedRequest): Promise<ModerationCasePage> {
    const operatorId = await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateModerationCaseSearch(request.body)
    ) {
      throw new HttpException(
        formatValidationErrors(validateModerationCaseSearch.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.recordAudit({
      action: "jobs.moderation.case_search.access",
      operatorId,
      resourceId: null,
    });
    const page = await this.moderation.searchCases(request.body as ModerationCaseSearchRequest);
    const projected = {
      items: page.items.map(projectModerationCase),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
    if (!validateModerationCasePage(projected)) throw new ModerationServiceUnavailableError();
    return projected as ModerationCasePage;
  }

  @Post("/cases")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async openCase(@Req() request: AuthenticatedRequest): Promise<ModerationCase> {
    const operatorId = await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateOpenModerationCase(request.body) ||
      !validOpenModerationRequest(request.body as OpenModerationCaseRequest)
    ) {
      throw new HttpException(
        validateOpenModerationCase.errors
          ? formatValidationErrors(validateOpenModerationCase.errors)
          : "The moderation target and reason do not match",
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as OpenModerationCaseRequest;
    await this.recordAudit({
      action: "jobs.moderation.case_open.attempt",
      operatorId,
      resourceId: input.target.kind === "job" ? input.target.jobId : null,
    });
    return projectModerationCase(
      await this.moderation.openCase({
        target: input.target,
        operatorId,
        reasonCode: input.reasonCode,
      }),
    );
  }

  @Post("/cases/:caseId/resolve")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async resolveCase(
    @Req() request: AuthenticatedRequest,
    @Param("caseId") caseId: string,
  ): Promise<ModerationCase> {
    const operatorId = await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !UUID_V7_PATTERN.test(caseId) ||
      !validateResolveModerationCase(request.body) ||
      !validModerationResolution(request.body as ResolveModerationCaseRequest)
    ) {
      throw new HttpException(
        validateResolveModerationCase.errors
          ? formatValidationErrors(validateResolveModerationCase.errors)
          : "The moderation resolution is invalid",
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as ResolveModerationCaseRequest;
    await this.recordAudit({
      action: "jobs.moderation.case_resolve.attempt",
      operatorId,
      resourceId: caseId,
    });
    return projectModerationCase(
      await this.moderation.resolveCase({ caseId, operatorId, ...input }),
    );
  }

  @Get("/jobs/:jobId/report-summary")
  @Header("cache-control", "no-store")
  async getReportSummary(
    @Req() request: AuthenticatedRequest,
    @Param("jobId") jobId: string,
  ): Promise<JobReportSummary> {
    const operatorId = await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(jobId)
    ) {
      throw new HttpException("The report-summary input is invalid", HttpStatus.BAD_REQUEST);
    }
    await this.recordAudit({
      action: "jobs.moderation.report_summary.access",
      operatorId,
      resourceId: jobId,
    });
    const summary = await this.moderation.summarizeReports(jobId);
    if (!validateJobReportSummary(summary)) throw new ModerationServiceUnavailableError();
    return summary as JobReportSummary;
  }
}

@Controller("/v1")
@UseFilters(ProblemDetailsFilter)
class CandidateController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(RESTRICTED_ANSWER_VAULT)
    private readonly restrictedAnswers: RestrictedAnswerVaultStore | null,
    @Inject(PROFILE_SECTIONS) private readonly profileSections: ProfileSectionStore | null,
    @Inject(JOB_CATALOG) private readonly catalog: JobCatalogReader,
    @Inject(JOB_REPORTS) private readonly jobReports: JobReports,
    @Inject(JOB_CONTRIBUTIONS) private readonly jobContributions: JobContributions,
    @Inject(UGC_CONTRIBUTION_CONSENTS)
    private readonly ugcContributionConsents: UgcContributionConsentStore,
    @Inject(UGC_CONTRIBUTION_POLICY_VERSION)
    private readonly ugcContributionPolicyVersion: string | null,
    @Inject(SAVED_JOBS) private readonly savedJobs: SavedJobs,
    @Inject(PRIVATE_SAVED_PAGE_CAPTURES)
    private readonly privateSavedPageCaptures: PrivateSavedPageCaptures,
    @Inject(MATCH_ASSESSMENTS) private readonly matchAssessments: MatchAssessments,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementReadService,
    @Inject(DOCUMENT_STORE) private readonly documents: DocumentStore,
    @Inject(CANDIDATE_DATA_EXPORT_DOWNLOADS)
    private readonly candidateDataExportDownloads: CandidateDataExportDownloadSigner | null,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  @Get("/me")
  async me(@Req() request: AuthenticatedRequest): Promise<CurrentUser> {
    return this.identity.resolve(request, "profile:read");
  }

  @Post("/me/data-exports")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("cache-control", "no-store")
  async createCandidateDataExport(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<CandidateDataExport> {
    const { principal, user } = await this.identity.resolveWithReauthenticationProof(
      request,
      "profile:write",
    );
    if (!validateCreateCandidateDataExport(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreateCandidateDataExport.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as CreateCandidateDataExportRequest;
    if (input.format !== "candidate-data-export-v1") {
      throw new HttpException("Candidate data-export format is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!this.store.createCandidateDataExport) throw new CandidateRightsPolicyError();
    return this.store.createCandidateDataExport(
      principal,
      user.id,
      requireIdempotencyKey(idempotencyKey),
      request.traceId ?? correlationId(undefined),
      activeTraceparent(),
    );
  }

  @Get("/me/data-exports/:dataExportId")
  @Header("cache-control", "no-store")
  async getCandidateDataExport(
    @Req() request: AuthenticatedRequest,
    @Param("dataExportId") dataExportId: string,
  ): Promise<CandidateDataExportAccess> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!UUID_V7_PATTERN.test(dataExportId)) {
      throw new HttpException(
        "Candidate data-export identifier is invalid",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.store.getCandidateDataExport) throw new CandidateRightsPolicyError();
    const record = await this.store.getCandidateDataExport(user.id, dataExportId);
    if (!record) {
      throw new HttpException("Candidate data export was not found", HttpStatus.NOT_FOUND);
    }
    const response: { export: CandidateDataExport; download?: CandidateDataExportDownloadGrant } = {
      export: projectCandidateDataExport(record),
    };
    if (record.state === "ready") {
      if (!record.artifact || !this.candidateDataExportDownloads) {
        throw new CandidateRightsPolicyError();
      }
      const now = this.clock();
      if (record.artifact.expiresAt.getTime() <= now.getTime()) {
        throw new CandidateRightsTransitionError();
      }
      const download = await this.candidateDataExportDownloads.createGrant({
        objectKey: record.artifact.objectKey,
        objectVersion: record.artifact.objectVersion,
        artifactExpiresAt: record.artifact.expiresAt,
        now,
      });
      const grantExpiresAt = Date.parse(download.expiresAt);
      if (
        download.method !== "GET" ||
        !Number.isFinite(grantExpiresAt) ||
        grantExpiresAt <= now.getTime() ||
        grantExpiresAt > record.artifact.expiresAt.getTime()
      ) {
        throw new CandidateRightsPolicyError();
      }
      response.download = download;
    }
    if (!validateCandidateDataExportAccess(response)) {
      throw new CandidateRightsPolicyError();
    }
    return response as CandidateDataExportAccess;
  }

  @Post("/me/account-deletion-requests")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createAccountDeletionRequest(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<AccountDeletionRequest> {
    const { principal, user } = await this.identity.resolveWithReauthenticationProof(
      request,
      "profile:write",
    );
    if (!validateCreateAccountDeletionRequest(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreateAccountDeletionRequest.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as CreateAccountDeletionRequest;
    if (input.acknowledgement !== "ACCOUNT_DELETION_IS_IRREVERSIBLE") {
      throw new HttpException(
        "Account-deletion acknowledgement is invalid",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.store.createAccountDeletionRequest) throw new CandidateRightsPolicyError();
    return this.store.createAccountDeletionRequest(
      principal,
      user.id,
      requireIdempotencyKey(idempotencyKey),
      request.traceId ?? correlationId(undefined),
    );
  }

  @Get("/me/account-deletion-requests/:deletionRequestId")
  @Header("cache-control", "no-store")
  async getAccountDeletionRequest(
    @Req() request: AuthenticatedRequest,
    @Param("deletionRequestId") deletionRequestId: string,
  ): Promise<AccountDeletionRequest> {
    const { user } = await this.identity.resolveWithPrincipal(request, "profile:write", true);
    if (!UUID_V7_PATTERN.test(deletionRequestId)) {
      throw new HttpException("Account-deletion identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!this.store.getAccountDeletionRequest) throw new CandidateRightsPolicyError();
    const deletion = await this.store.getAccountDeletionRequest(user.id, deletionRequestId);
    if (!deletion) {
      throw new HttpException("Account-deletion request was not found", HttpStatus.NOT_FOUND);
    }
    return deletion;
  }

  @Delete("/me/account-deletion-requests/:deletionRequestId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async cancelAccountDeletionRequest(
    @Req() request: AuthenticatedRequest,
    @Param("deletionRequestId") deletionRequestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
  ): Promise<void> {
    const { principal, user } = await this.identity.resolveWithReauthenticationProof(
      request,
      "profile:write",
    );
    if (!UUID_V7_PATTERN.test(deletionRequestId)) {
      throw new HttpException("Account-deletion identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!this.store.cancelAccountDeletionRequest) throw new CandidateRightsPolicyError();
    const cancelled = await this.store.cancelAccountDeletionRequest(
      principal,
      user.id,
      deletionRequestId,
      requireExpectedVersion(ifMatch),
      requireIdempotencyKey(idempotencyKey),
      request.traceId ?? correlationId(undefined),
    );
    if (!cancelled) {
      throw new HttpException("Account-deletion request was not found", HttpStatus.NOT_FOUND);
    }
  }

  @Post("/me/account-deletion-requests/:deletionRequestId/confirm")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("cache-control", "no-store")
  async confirmAccountDeletionRequest(
    @Req() request: AuthenticatedRequest,
    @Param("deletionRequestId") deletionRequestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<AccountDeletionRequest> {
    const { principal, user } = await this.identity.resolveWithReauthenticationProof(
      request,
      "profile:write",
      true,
    );
    if (!UUID_V7_PATTERN.test(deletionRequestId)) {
      throw new HttpException("Account-deletion identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!validateConfirmAccountDeletionRequest(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateConfirmAccountDeletionRequest.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as ConfirmAccountDeletionRequest;
    if (input.confirmation !== "DELETE_MY_ACCOUNT") {
      throw new HttpException("Account-deletion confirmation is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!this.store.confirmAccountDeletionRequest) throw new CandidateRightsPolicyError();
    const deletion = await this.store.confirmAccountDeletionRequest(
      principal,
      user.id,
      deletionRequestId,
      input.expectedVersion,
      requireIdempotencyKey(idempotencyKey),
      request.traceId ?? correlationId(undefined),
      activeTraceparent(),
    );
    if (!deletion) {
      throw new HttpException("Account-deletion request was not found", HttpStatus.NOT_FOUND);
    }
    return deletion;
  }

  @Get("/entitlements")
  @Header("cache-control", "no-store")
  async getEntitlements(@Req() request: AuthenticatedRequest): Promise<EntitlementSummary> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      (request.headers["content-length"] !== undefined &&
        request.headers["content-length"] !== "0") ||
      request.headers["transfer-encoding"] !== undefined
    ) {
      throw new HttpException("Entitlement read input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "profile:read");
    try {
      const evaluation = await this.entitlements.evaluate(user.id, this.clock());
      return projectEntitlement(evaluation);
    } catch {
      throw new EntitlementUnavailableError();
    }
  }

  @Get("/me/job-preferences")
  async getPreferences(@Req() request: AuthenticatedRequest) {
    const user = await this.identity.resolve(request, "profile:read");
    const preferences = await this.store.getPreferences(user.id);
    if (!preferences) {
      throw new HttpException("Job preferences were not found", HttpStatus.NOT_FOUND);
    }
    return preferences;
  }

  @Put("/me/job-preferences")
  async putPreferences(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<PutJobPreferencesResponse> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const input = request.body;
    if (!validatePreferences(input)) {
      throw new HttpException(
        formatValidationErrors(validatePreferences.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.store.putPreferences(
      user.id,
      input as PutJobPreferencesRequest,
      commandKey,
      request.traceId ?? correlationId(undefined),
      activeTraceparent(),
    );
  }

  private profileSectionStore(): ProfileSectionStore {
    if (!this.profileSections) {
      throw new HttpException("Profile sections are unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.profileSections;
  }

  private async listProfileSection(request: AuthenticatedRequest, section: ProfileEntrySection) {
    const user = await this.identity.resolve(request, "profile:read");
    return profileCollection(
      section,
      await this.profileSectionStore().listEntries(user.id, section),
    );
  }

  private async createProfileSection(
    request: AuthenticatedRequest,
    idempotencyKey: string | undefined,
    section: ProfileEntrySection,
  ): Promise<ProfileEntryRecord> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const input = validProfileBody<Parameters<ProfileSectionStore["createEntry"]>[2]>(
      PROFILE_SECTION_VALIDATORS[section].create,
      request.body,
    );
    return this.profileSectionStore().createEntry(
      user.id,
      section,
      input,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  private async updateProfileSection(
    request: AuthenticatedRequest,
    recordId: string,
    idempotencyKey: string | undefined,
    section: ProfileEntrySection,
  ): Promise<ProfileEntryRecord> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const id = requireProfileRecordId(recordId);
    const input = validProfileBody<Parameters<ProfileSectionStore["updateEntry"]>[3]>(
      PROFILE_SECTION_VALIDATORS[section].update,
      request.body,
    );
    return this.profileSectionStore().updateEntry(
      user.id,
      section,
      id,
      input,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  private async deleteProfileSection(
    request: AuthenticatedRequest,
    recordId: string,
    idempotencyKey: string | undefined,
    section: ProfileEntrySection,
  ): Promise<void> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const id = requireProfileRecordId(recordId);
    const expectedVersion = parseExpectedVersionQuery(request.query);
    if (request.body !== undefined) {
      throw new HttpException("Profile delete input is invalid", HttpStatus.BAD_REQUEST);
    }
    await this.profileSectionStore().deleteEntry(
      user.id,
      section,
      id,
      expectedVersion,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  private async reorderProfileSection(
    request: AuthenticatedRequest,
    idempotencyKey: string | undefined,
    section: Exclude<ProfileEntrySection, "applicationAnswer">,
  ) {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const input = validProfileBody<{ orderedEntryIds: string[] }>(
      validateReorderProfileEntries,
      request.body,
    );
    return profileCollection(
      section,
      await this.profileSectionStore().reorderEntries(
        user.id,
        section,
        input.orderedEntryIds,
        commandKey,
        request.traceId ?? correlationId(undefined),
      ),
    );
  }

  @Get("/profile/personal")
  @Header("cache-control", "no-store")
  async getProfilePersonal(@Req() request: AuthenticatedRequest): Promise<ProfilePersonal> {
    const user = await this.identity.resolve(request, "profile:read");
    const personal = await this.profileSectionStore().getPersonal(user.id);
    if (!personal) throw new HttpException("Profile record was not found", HttpStatus.NOT_FOUND);
    return personal;
  }

  @Put("/profile/personal")
  @Header("cache-control", "no-store")
  async putProfilePersonal(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfilePersonal> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const input = validProfileBody<Parameters<ProfileSectionStore["putPersonal"]>[1]>(
      validatePutProfilePersonal,
      request.body,
    );
    return this.profileSectionStore().putPersonal(
      user.id,
      input,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  @Get("/profile/education-entries")
  @Header("cache-control", "no-store")
  async listProfileEducationEntries(@Req() request: AuthenticatedRequest) {
    return this.listProfileSection(request, "education");
  }

  @Post("/profile/education-entries")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createProfileEducationEntry(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.createProfileSection(request, idempotencyKey, "education");
  }

  @Post("/profile/education-entries/reorder")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async reorderProfileEducationEntrys(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.reorderProfileSection(request, idempotencyKey, "education");
  }

  @Patch("/profile/education-entries/:entryId")
  @Header("cache-control", "no-store")
  async updateProfileEducationEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.updateProfileSection(request, recordId, idempotencyKey, "education");
  }

  @Delete("/profile/education-entries/:entryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteProfileEducationEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    await this.deleteProfileSection(request, recordId, idempotencyKey, "education");
  }

  @Get("/profile/work-experience-entries")
  @Header("cache-control", "no-store")
  async listProfileWorkExperienceEntries(@Req() request: AuthenticatedRequest) {
    return this.listProfileSection(request, "workExperience");
  }

  @Post("/profile/work-experience-entries")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createProfileWorkExperienceEntry(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.createProfileSection(request, idempotencyKey, "workExperience");
  }

  @Post("/profile/work-experience-entries/reorder")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async reorderProfileWorkExperienceEntrys(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.reorderProfileSection(request, idempotencyKey, "workExperience");
  }

  @Patch("/profile/work-experience-entries/:entryId")
  @Header("cache-control", "no-store")
  async updateProfileWorkExperienceEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.updateProfileSection(request, recordId, idempotencyKey, "workExperience");
  }

  @Delete("/profile/work-experience-entries/:entryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteProfileWorkExperienceEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    await this.deleteProfileSection(request, recordId, idempotencyKey, "workExperience");
  }

  @Get("/profile/skill-entries")
  @Header("cache-control", "no-store")
  async listProfileSkillEntries(@Req() request: AuthenticatedRequest) {
    return this.listProfileSection(request, "skill");
  }

  @Post("/profile/skill-entries")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createProfileSkillEntry(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.createProfileSection(request, idempotencyKey, "skill");
  }

  @Post("/profile/skill-entries/reorder")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async reorderProfileSkillEntrys(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.reorderProfileSection(request, idempotencyKey, "skill");
  }

  @Patch("/profile/skill-entries/:entryId")
  @Header("cache-control", "no-store")
  async updateProfileSkillEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.updateProfileSection(request, recordId, idempotencyKey, "skill");
  }

  @Delete("/profile/skill-entries/:entryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteProfileSkillEntry(
    @Req() request: AuthenticatedRequest,
    @Param("entryId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    await this.deleteProfileSection(request, recordId, idempotencyKey, "skill");
  }

  @Get("/profile/application-answers")
  @Header("cache-control", "no-store")
  async listProfileApplicationAnswers(@Req() request: AuthenticatedRequest) {
    return this.listProfileSection(request, "applicationAnswer");
  }

  @Post("/profile/application-answers")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createProfileApplicationAnswer(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.createProfileSection(request, idempotencyKey, "applicationAnswer");
  }

  @Patch("/profile/application-answers/:answerId")
  @Header("cache-control", "no-store")
  async updateProfileApplicationAnswer(
    @Req() request: AuthenticatedRequest,
    @Param("answerId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryRecord> {
    return this.updateProfileSection(request, recordId, idempotencyKey, "applicationAnswer");
  }

  @Delete("/profile/application-answers/:answerId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteProfileApplicationAnswer(
    @Req() request: AuthenticatedRequest,
    @Param("answerId") recordId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    await this.deleteProfileSection(request, recordId, idempotencyKey, "applicationAnswer");
  }

  @Get("/profile/import-drafts")
  @Header("cache-control", "no-store")
  async listProfileImportDrafts(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ drafts: ProfileImportDraft[] }> {
    const user = await this.identity.resolve(request, "profile:read");
    return { drafts: await this.profileSectionStore().listDrafts(user.id) };
  }

  @Delete("/profile/import-drafts/:draftId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async discardProfileImportDraft(
    @Req() request: AuthenticatedRequest,
    @Param("draftId") draftId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const id = requireProfileRecordId(draftId);
    if (request.body !== undefined) {
      throw new HttpException("Profile delete input is invalid", HttpStatus.BAD_REQUEST);
    }
    await this.profileSectionStore().discardDraft(
      user.id,
      id,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  @Post("/profile/import-drafts/:draftId/save")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async saveProfileImportDraft(
    @Req() request: AuthenticatedRequest,
    @Param("draftId") draftId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileEntryReference> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const id = requireProfileRecordId(draftId);
    const input = validProfileBody<Parameters<ProfileSectionStore["saveDraft"]>[2]>(
      validateSaveProfileImportDraft,
      request.body,
    );
    return this.profileSectionStore().saveDraft(
      user.id,
      id,
      input,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  @Get("/profile/restricted-answers")
  @Header("cache-control", "no-store")
  async listRestrictedAnswers(
    @Req() request: AuthenticatedRequest,
  ): Promise<RestrictedAnswerCollection> {
    const user = await this.identity.resolve(request, "profile:read");
    if (!this.restrictedAnswers) throw new RestrictedAnswerVaultConfigurationError();
    return { answers: [...(await this.restrictedAnswers.list(user.id))] };
  }

  @Put("/profile/restricted-answers/:fieldKey")
  @Header("cache-control", "no-store")
  async saveRestrictedAnswer(
    @Req() request: AuthenticatedRequest,
    @Param("fieldKey") fieldKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<RestrictedAnswer> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!RESTRICTED_ANSWER_FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new HttpException("Restricted answer field key is invalid", HttpStatus.BAD_REQUEST);
    }
    const context = parseRestrictedAnswerContextQuery(request.query);
    if (context === RESTRICTED_ANSWER_QUERY_INVALID) {
      throw new HttpException("Restricted answer query is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!validateSaveRestrictedAnswer(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateSaveRestrictedAnswer.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.restrictedAnswers) throw new RestrictedAnswerVaultConfigurationError();
    const body = request.body as SaveRestrictedAnswerRequest;
    const confirmedAt = new Date(body.confirmedAt);
    const expiresAt = body.expiresAt !== undefined ? new Date(body.expiresAt) : undefined;
    if (Number.isNaN(confirmedAt.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
      throw new HttpException("Restricted answer request is invalid", HttpStatus.BAD_REQUEST);
    }
    const saved = await this.restrictedAnswers.save({
      userId: user.id,
      fieldKey,
      ...(context ? { context } : {}),
      expectedVersion: body.expectedVersion,
      valueType: body.valueType,
      value: body.value,
      sensitivity: body.sensitivity,
      sourceReference: body.sourceReference,
      confirmedAt,
      ...(expiresAt ? { expiresAt } : {}),
      idempotencyKey: commandKey,
      traceId: request.traceId ?? correlationId(undefined),
    });
    // Built from the request and the store's result, not a second read: a save's echoed metadata
    // is exactly what was just written (or, on an idempotent replay, what the first call wrote).
    return {
      id: saved.id,
      fieldKey,
      ...(context ? { context } : {}),
      valueType: body.valueType,
      sensitivity: body.sensitivity,
      state: "active",
      version: saved.version,
      confirmedAt: confirmedAt.toISOString(),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    };
  }

  @Delete("/profile/restricted-answers/:fieldKey")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteRestrictedAnswer(
    @Req() request: AuthenticatedRequest,
    @Param("fieldKey") fieldKey: string,
  ): Promise<void> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!RESTRICTED_ANSWER_FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new HttpException("Restricted answer field key is invalid", HttpStatus.BAD_REQUEST);
    }
    const context = parseRestrictedAnswerContextQuery(request.query);
    if (context === RESTRICTED_ANSWER_QUERY_INVALID) {
      throw new HttpException("Restricted answer query is invalid", HttpStatus.BAD_REQUEST);
    }
    if (request.body !== undefined) {
      throw new HttpException("Restricted answer delete input is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!this.restrictedAnswers) throw new RestrictedAnswerVaultConfigurationError();
    await this.restrictedAnswers.removeByField({
      userId: user.id,
      fieldKey,
      ...(context ? { context } : {}),
      traceId: request.traceId ?? correlationId(undefined),
    });
  }

  @Post("/jobs/contributions")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("cache-control", "no-store")
  async createJobContribution(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<JobContribution> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateCreateJobContribution(request.body)
    ) {
      throw new HttpException(
        formatValidationErrors(validateCreateJobContribution.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    let created: Awaited<ReturnType<JobContributions["contribute"]>>;
    try {
      created = await this.jobContributions.contribute({
        ownerUserId: user.id,
        idempotencyKey: requireIdempotencyKey(idempotencyKey),
        input: request.body as CreateJobContributionRequest,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpException("Job contribution approval is invalid", HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
    if (!exactJobContribution(created)) {
      throw new JobContributionUnavailableError("JOB_RESPONSE_CONTRACT");
    }
    return created as JobContribution;
  }

  @Post("/profile/ugc-contribution-consents")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async grantUgcContributionConsent(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<UgcContributionConsentGrant> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateGrantUgcContributionConsent(request.body)
    ) {
      throw new HttpException(
        formatValidationErrors(validateGrantUgcContributionConsent.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    const input = request.body as GrantUgcContributionConsentRequest;
    if (
      !this.ugcContributionPolicyVersion ||
      input.policyVersion !== this.ugcContributionPolicyVersion
    ) {
      throw new UgcContributionConsentUnavailableError();
    }
    const grantedAt = this.clock().toISOString();
    const consent = await this.ugcContributionConsents.grant({
      documentVersion: input.documentVersion,
      grantedAt,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      ownerUserId: user.id,
      policyVersion: input.policyVersion,
      previewPayloadSha256: input.previewDigestSha256,
      traceId: request.traceId ?? correlationId(undefined),
    });
    const response: UgcContributionConsentGrant = {
      documentVersion: consent.documentVersion as UgcContributionConsentGrant["documentVersion"],
      grantedAt: consent.grantedAt,
      id: consent.id,
      policyVersion: consent.policyVersion as UgcContributionConsentGrant["policyVersion"],
      schemaVersion: 1,
      state: "granted",
    };
    if (!validateUgcContributionConsentGrant(response)) {
      throw new UgcContributionConsentUnavailableError();
    }
    return response;
  }

  @Post("/profile/ugc-contribution-consents/:consentId/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async revokeUgcContributionConsent(
    @Req() request: AuthenticatedRequest,
    @Param("consentId") consentId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<void> {
    if (
      !UUID_V7_PATTERN.test(consentId) ||
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateRevokeUgcContributionConsent(request.body)
    ) {
      throw new HttpException("Contribution consent revocation is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    await this.ugcContributionConsents.revoke({
      consentId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      occurredAt: this.clock().toISOString(),
      ownerUserId: user.id,
      traceId: request.traceId ?? correlationId(undefined),
    });
  }

  @Post("/jobs/contributions/:contributionId/cancel")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async cancelJobContribution(
    @Req() request: AuthenticatedRequest,
    @Param("contributionId") contributionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<JobContribution> {
    if (
      !UUID_V7_PATTERN.test(contributionId) ||
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateCancelJobContribution(request.body)
    ) {
      throw new HttpException("Contribution cancellation input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    if (!this.jobContributions.cancel) throw new JobContributionUnavailableError();
    const contribution = await this.jobContributions.cancel({
      ownerUserId: user.id,
      contributionId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      traceId: request.traceId ?? correlationId(undefined),
    });
    if (!contribution)
      throw new HttpException("Job contribution was not found", HttpStatus.NOT_FOUND);
    if (!exactJobContribution(contribution) || contribution.state !== "consent_invalid") {
      throw new JobContributionUnavailableError("JOB_RESPONSE_CONTRACT");
    }
    return contribution as JobContribution;
  }

  @Get("/jobs/contributions")
  @Header("cache-control", "no-store")
  async listJobContributions(
    @Req() request: AuthenticatedRequest,
  ): Promise<JobContributionHistory> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      (request.headers["content-length"] !== undefined &&
        request.headers["content-length"] !== "0") ||
      request.headers["transfer-encoding"] !== undefined
    ) {
      throw new HttpException("Job contribution history input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    const history = { items: await this.jobContributions.list(user.id) };
    if (!exactJobContributionHistory(history)) {
      throw new JobContributionUnavailableError("JOB_RESPONSE_CONTRACT");
    }
    return history;
  }

  @Get("/jobs/contributions/:contributionId")
  @Header("cache-control", "no-store")
  async getJobContribution(
    @Req() request: AuthenticatedRequest,
    @Param("contributionId") contributionId: string,
  ): Promise<JobContribution> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(contributionId)
    ) {
      throw new HttpException("Job contribution status input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:contribute");
    const contribution = await this.jobContributions.get(user.id, contributionId);
    if (!contribution) {
      throw new HttpException("Job contribution was not found", HttpStatus.NOT_FOUND);
    }
    if (!exactJobContribution(contribution)) {
      throw new JobContributionUnavailableError("JOB_RESPONSE_CONTRACT");
    }
    return contribution as JobContribution;
  }

  @Get("/jobs/:jobId")
  @Header("cache-control", "no-store")
  async getCanonicalJob(
    @Req() request: AuthenticatedRequest,
    @Param("jobId") jobId: string,
  ): Promise<CanonicalJobDetail> {
    await this.identity.authorize(request, "jobs:read");
    if (!UUID_PATTERN.test(jobId)) {
      throw new HttpException("Job identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    const job = await this.catalog.getActiveJob(jobId);
    if (!job) {
      throw new HttpException("Active job was not found", HttpStatus.NOT_FOUND);
    }
    return {
      id: job.id,
      company: job.company,
      title: job.title,
      locations: job.locations,
      ...(job.department ? { department: job.department } : {}),
      description: job.description,
      status: "active",
      firstObservedAt: job.firstObservedAt.toISOString(),
      lastVerifiedAt: job.lastVerifiedAt.toISOString(),
      expiresAt: job.expiresAt.toISOString(),
      ...(job.validThrough ? { validThrough: job.validThrough.toISOString() } : {}),
      sources: job.sources.map((source) => ({
        provider: source.provider,
        provenance: source.provenance,
        canonicalUrl: source.canonicalUrl,
        firstObservedAt: source.firstObservedAt.toISOString(),
        lastVerifiedAt: source.lastVerifiedAt.toISOString(),
        ...(source.validThrough ? { validThrough: source.validThrough.toISOString() } : {}),
      })),
    };
  }

  @Get("/jobs/:jobId/match-assessment")
  @Header("cache-control", "no-store")
  async getJobMatchAssessment(
    @Req() request: AuthenticatedRequest,
    @Param("jobId") jobId: string,
  ): Promise<MatchAssessment> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      (request.headers["content-length"] !== undefined &&
        request.headers["content-length"] !== "0") ||
      request.headers["transfer-encoding"] !== undefined ||
      !UUID_V7_PATTERN.test(jobId)
    ) {
      throw new HttpException("Match assessment input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:read");
    const assessment = await this.matchAssessments.assess(user.id, jobId);
    if (!exactMatchAssessment(assessment, jobId)) {
      throw new MatchAssessmentServiceUnavailableError();
    }
    return assessment as MatchAssessment;
  }

  @Post("/jobs/:jobId/reports")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createJobReport(
    @Req() request: AuthenticatedRequest,
    @Param("jobId") jobId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<JobReport> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !UUID_V7_PATTERN.test(jobId) ||
      !validateCreateJobReport(request.body)
    ) {
      throw new HttpException(
        validateCreateJobReport.errors
          ? formatValidationErrors(validateCreateJobReport.errors)
          : "Job report input is invalid",
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.identity.resolve(request, "jobs:write");
    const created = await this.jobReports.report({
      ownerUserId: user.id,
      requestedJobId: jobId,
      reason: (request.body as CreateJobReportRequest).reason,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    if (!exactJobReport(created, jobId)) {
      throw new JobReportServiceUnavailableError();
    }
    return created as JobReport;
  }

  @Post("/jobs/search")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async searchCanonicalJobs(@Req() request: AuthenticatedRequest): Promise<JobSearchPage> {
    await this.identity.authorize(request, "jobs:read");
    if (!validateJobSearch(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateJobSearch.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    let page: Awaited<ReturnType<JobCatalogReader["searchActiveJobs"]>>;
    try {
      page = await this.catalog.searchActiveJobs(request.body as JobSearchRequest);
    } catch (error) {
      if (
        error instanceof InvalidJobSearchError ||
        error instanceof JobSearchCatalogChangedError ||
        error instanceof JobSearchServiceUnavailableError
      ) {
        throw error;
      }
      throw new JobSearchServiceUnavailableError();
    }
    return {
      items: page.items.map((job) => ({
        id: job.id,
        company: job.company,
        title: job.title,
        locations: job.locations,
        ...(job.department ? { department: job.department } : {}),
        status: "active",
        firstObservedAt: job.firstObservedAt.toISOString(),
        lastVerifiedAt: job.lastVerifiedAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(),
      })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  @Post("/saved-jobs")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createSavedJob(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<SavedJob> {
    const user = await this.identity.resolve(request, "jobs:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!validateCreateSavedJob(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreateSavedJob.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.savedJobs.create(
      user.id,
      (request.body as CreateSavedJobRequest).jobId,
      commandKey,
    );
  }

  @Post("/saved-jobs/search")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async listSavedJobs(@Req() request: AuthenticatedRequest): Promise<SavedJobPage> {
    const user = await this.identity.resolve(request, "jobs:read");
    if (!validateSavedJobSearch(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateSavedJobSearch.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.savedJobs.list(user.id, request.body as SavedJobSearchRequest);
  }

  @Post("/saved-job-captures")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createPrivateSavedPageCapture(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<PrivateSavedPageCaptureResponse> {
    const user = await this.identity.resolve(request, "jobs:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!validateCreatePrivateSavedPageCapture(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreatePrivateSavedPageCapture.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const created = await this.privateSavedPageCaptures.create({
        ownerUserId: user.id,
        idempotencyKey: commandKey,
        input: request.body as CreatePrivateSavedPageCaptureRequest,
      });
      return projectPrivateSavedPageCapture(created);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpException("Private capture input is invalid", HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @Get("/saved-job-captures/:captureId")
  @Header("cache-control", "no-store")
  async getPrivateSavedPageCapture(
    @Req() request: AuthenticatedRequest,
    @Param("captureId") captureId: string,
  ): Promise<PrivateSavedPageCaptureResponse> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(captureId)
    ) {
      throw new HttpException("Private capture read input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:read");
    const capture = await this.privateSavedPageCaptures.get(user.id, captureId);
    if (!capture) throw new HttpException("Private capture was not found", HttpStatus.NOT_FOUND);
    return projectPrivateSavedPageCapture(capture);
  }

  @Delete("/saved-job-captures/:captureId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deletePrivateSavedPageCapture(
    @Req() request: AuthenticatedRequest,
    @Param("captureId") captureId: string,
  ): Promise<void> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(captureId)
    ) {
      throw new HttpException("Private capture delete input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "jobs:write");
    await this.privateSavedPageCaptures.delete(user.id, captureId);
  }

  @Delete("/saved-jobs/:savedJobId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteSavedJob(
    @Req() request: AuthenticatedRequest,
    @Param("savedJobId") savedJobId: string,
  ): Promise<void> {
    const user = await this.identity.resolve(request, "jobs:write");
    if (!UUID_PATTERN.test(savedJobId)) {
      throw new HttpException("Saved-job identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    await this.savedJobs.delete(user.id, savedJobId);
  }

  @Get("/resumes")
  @Header("cache-control", "no-store")
  async listResumes(@Req() request: AuthenticatedRequest): Promise<ResumeDocumentCollection> {
    const user = await this.identity.resolve(request, "documents:read");
    return this.documents.listResumeDocuments(user.id);
  }

  @Delete("/resumes/:documentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async deleteResume(
    @Req() request: AuthenticatedRequest,
    @Param("documentId") documentId: string,
  ): Promise<void> {
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(documentId)
    ) {
      throw new HttpException("Resume delete input is invalid", HttpStatus.BAD_REQUEST);
    }
    const user = await this.identity.resolve(request, "documents:write");
    const traceId = request.traceId ?? correlationId(undefined);
    await this.documents.deleteResume(user.id, documentId, traceId);
    // The resume is already deleted, so a failure here must not fail the request: the byte purge sweep retires the same
    // proposals (ADR-034). It is scoped to this candidate and this document, so calling it for an already-deleted or absent
    // resume is a no-op.
    try {
      await this.store.retireResumeProposals(user.id, documentId, traceId);
    } catch {
      console.error({ event: "resume_proposal_retirement_deferred", traceId });
    }
  }

  @Post("/resumes/uploads")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createResumeUpload(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<CreateResumeUploadResponse> {
    const user = await this.identity.resolve(request, "documents:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!validateCreateResumeUpload(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreateResumeUpload.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.documents.createResumeUpload(
      user.id,
      request.body as CreateResumeUploadRequest,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  @Get("/operations/:operationId")
  async getOperation(
    @Req() request: AuthenticatedRequest,
    @Param("operationId") operationId: string,
  ): Promise<Operation> {
    const user = await this.identity.resolve(request, "profile:read");
    const operation = await this.store.getOperation(user.id, operationId);
    if (!operation) {
      throw new HttpException("Operation was not found", HttpStatus.NOT_FOUND);
    }
    return operation;
  }
}

function applicationsBody<T>(
  request: AuthenticatedRequest,
  validate: ReturnType<typeof compileComponentValidator>,
): T {
  if (!hasNoQuery(request) || !validate(request.body)) {
    throw new HttpException(formatValidationErrors(validate.errors), HttpStatus.BAD_REQUEST);
  }
  return request.body as T;
}

function requireApplicationsRead(request: AuthenticatedRequest): void {
  if (!hasNoQuery(request) || request.body !== undefined) {
    throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
  }
}

function requireApplicationPath(...ids: string[]): void {
  if (!ids.every((id) => UUID_V7_PATTERN.test(id))) {
    throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
  }
}

/**
 * Owner-scoped Applications API (D3). Every route resolves the authenticated owner from an exact
 * `applications:read` or `applications:write` scope and never accepts an owner from the caller.
 */
@Controller("/v1/applications")
@UseFilters(ProblemDetailsFilter)
class ApplicationsController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(APPLICATIONS) private readonly applications: ApplicationsApi,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    const body = applicationsBody<CreateApplicationRequest>(request, validateCreateApplication);
    requireApplicationPath(body.jobId);
    return this.applications.create(user.id, body.jobId, commandKey);
  }

  @Post("/search")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async search(@Req() request: AuthenticatedRequest): Promise<ApplicationPage> {
    const user = await this.identity.resolve(request, "applications:read");
    const body = applicationsBody<ApplicationSearchRequest>(request, validateApplicationSearch);
    return this.applications.search(user.id, body);
  }

  @Get("/:applicationId")
  @Header("cache-control", "no-store")
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId);
    return this.applications.get(user.id, applicationId);
  }

  @Get("/:applicationId/history")
  @Header("cache-control", "no-store")
  async history(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationHistoryPage> {
    const user = await this.identity.resolve(request, "applications:read");
    const page = parseHistoryQuery(request.query);
    if (request.body !== undefined || page === null) {
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    }
    requireApplicationPath(applicationId);
    return this.applications.history(user.id, applicationId, page);
  }

  @Get("/:applicationId/resume")
  @Header("cache-control", "no-store")
  async resumePreview(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationResumePreview> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId);
    return this.applications.resumePreview(user.id, applicationId);
  }

  @Get("/:applicationId/resume/file")
  @Header("cache-control", "no-store")
  async resumeFile(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationResumeFile> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationPath(applicationId);
    const format = parseGeneratedResumeFormatQuery(request.query);
    if (request.body !== undefined || format === null) {
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    }
    return this.applications.resumeFile(user.id, applicationId, format);
  }

  @Get("/:applicationId/resume/uploaded")
  @Header("cache-control", "no-store")
  async uploadedResumeFile(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationUploadedResumeFile> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId);
    if (!this.applications.uploadedResumeFile) throw new ApplicationsUnavailableError();
    return this.applications.uploadedResumeFile(user.id, applicationId);
  }

  @Get("/:applicationId/cover-letter")
  @Header("cache-control", "no-store")
  async coverLetterPreview(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationCoverLetterPreview> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId);
    return this.applications.coverLetterPreview(
      user.id,
      applicationId,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/cover-letter/file")
  @Header("cache-control", "no-store")
  async coverLetterFile(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationCoverLetterFile> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationPath(applicationId);
    const format = parseResumeFormatQuery(request.query);
    if (request.body !== undefined || format === null)
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    return this.applications.coverLetterFile(
      user.id,
      applicationId,
      format,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/cover-letter/location")
  @Header("cache-control", "no-store")
  async temporaryMaterialLocation(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationTemporaryMaterialLocation> {
    const user = await this.identity.resolve(request, "applications:read");
    const query = request.query as Record<string, unknown> | undefined;
    if (
      request.body !== undefined ||
      !query ||
      Object.keys(query).length !== 1 ||
      typeof query.generationId !== "string"
    )
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    requireApplicationPath(applicationId, query.generationId);
    if (!this.applications.temporaryMaterialLocation)
      throw new HttpException("Applications are unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    return this.applications.temporaryMaterialLocation(
      user.id,
      applicationId,
      query.generationId,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/resume/location")
  @Header("cache-control", "no-store")
  async resumeMaterialLocation(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationTemporaryMaterialLocation> {
    const user = await this.identity.resolve(request, "applications:read");
    const query = request.query as Record<string, unknown> | undefined;
    if (
      request.body !== undefined ||
      !query ||
      Object.keys(query).length !== 1 ||
      typeof query.generationId !== "string"
    )
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    requireApplicationPath(applicationId, query.generationId);
    if (!this.applications.resumeMaterialLocation)
      throw new HttpException("Applications are unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    return this.applications.resumeMaterialLocation(
      user.id,
      applicationId,
      query.generationId,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/cover-letter/authorization")
  @Header("cache-control", "no-store")
  async temporaryMaterialAuthorization(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationTemporaryMaterialAuthorization> {
    const user = await this.identity.resolve(request, "applications:read");
    const query = request.query as Record<string, unknown> | undefined;
    if (
      request.body !== undefined ||
      !query ||
      Object.keys(query).length !== 1 ||
      typeof query.generationId !== "string"
    )
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    requireApplicationPath(applicationId, query.generationId);
    if (!this.applications.temporaryMaterialAuthorization)
      throw new HttpException("Applications are unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    return this.applications.temporaryMaterialAuthorization(
      user.id,
      applicationId,
      query.generationId,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/resume/authorization")
  @Header("cache-control", "no-store")
  async resumeMaterialAuthorization(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
  ): Promise<ApplicationTemporaryMaterialAuthorization> {
    const user = await this.identity.resolve(request, "applications:read");
    const query = request.query as Record<string, unknown> | undefined;
    if (
      request.body !== undefined ||
      !query ||
      Object.keys(query).length !== 1 ||
      typeof query.generationId !== "string"
    )
      throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
    requireApplicationPath(applicationId, query.generationId);
    if (!this.applications.resumeMaterialAuthorization)
      throw new HttpException("Applications are unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    return this.applications.resumeMaterialAuthorization(
      user.id,
      applicationId,
      query.generationId,
      temporaryMaterialRequestSignal(request),
    );
  }

  @Get("/:applicationId/packet-preparations/:preparationId")
  @Header("cache-control", "no-store")
  async preparation(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Param("preparationId") preparationId: string,
  ): Promise<ApplicationPacketPreparation> {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId);
    requireApplicationPath(preparationId);
    return this.applications.preparation(user.id, applicationId, preparationId);
  }

  @Post("/:applicationId/packets")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async preparePacket(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Application | ApplicationPacketPreparation> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<PrepareApplicationPacketRequest>(
      request,
      validatePrepareApplicationPacket,
    );
    if (body.coverLetter) {
      // A cover-letter operation always uses the one-off generated resume path.
      if (body.resume === "uploaded")
        throw new HttpException("The Applications request is invalid", HttpStatus.BAD_REQUEST);
      const operation = await this.applications.prepareCoverLetter(
        user.id,
        applicationId,
        { ...body, coverLetter: body.coverLetter },
        commandKey,
      );
      reply.status(HttpStatus.ACCEPTED);
      return operation;
    }
    return this.applications.preparePacket(
      user.id,
      applicationId,
      {
        expectedRevision: body.expectedRevision,
        ...(body.userEntries ? { userEntries: body.userEntries } : {}),
        ...(body.vaultSelections ? { vaultSelections: body.vaultSelections } : {}),
        ...(body.form ? { form: body.form } : {}),
        ...(body.resume ? { resume: body.resume } : {}),
      },
      commandKey,
    );
  }

  @Post("/:applicationId/approval")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async approve(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<ApproveApplicationPacketRequest>(
      request,
      validateApproveApplicationPacket,
    );
    return withNativeMaterialCredential(
      user.id,
      applicationId,
      bearerToken(request.headers.authorization),
      () => this.applications.approve(user.id, applicationId, body, commandKey),
    );
  }

  @Post("/:applicationId/reopen")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async reopen(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<ApplicationRevisionRequest>(request, validateApplicationRevision);
    return this.applications.reopen(user.id, applicationId, body.expectedRevision, commandKey);
  }

  @Post("/:applicationId/cancel")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<ApplicationRevisionRequest>(request, validateApplicationRevision);
    return this.applications.cancel(user.id, applicationId, body.expectedRevision, commandKey);
  }

  @Post("/:applicationId/submissions")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async startSubmission(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ApplicationSubmissionStart> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<StartApplicationSubmissionRequest>(
      request,
      validateStartApplicationSubmission,
    );
    return withNativeMaterialCredential(
      user.id,
      applicationId,
      bearerToken(request.headers.authorization),
      () => this.applications.startSubmission(user.id, applicationId, body, commandKey),
    );
  }

  @Post("/:applicationId/manual-submissions")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async startManualSubmission(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ApplicationSubmissionStart> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId);
    const body = applicationsBody<StartManualApplicationSubmissionRequest>(
      request,
      validateStartManualApplicationSubmission,
    );
    return withNativeMaterialCredential(
      user.id,
      applicationId,
      bearerToken(request.headers.authorization),
      () => this.applications.startManualSubmission(user.id, applicationId, body, commandKey),
    );
  }

  @Post("/:applicationId/attempts/:attemptId/dispatch")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async dispatch(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Param("attemptId") attemptId: string,
  ): Promise<ApplicationAttempt> {
    const user = await this.identity.resolve(request, "applications:write");
    requireApplicationsRead(request);
    requireApplicationPath(applicationId, attemptId);
    return withNativeMaterialCredential(
      user.id,
      applicationId,
      bearerToken(request.headers.authorization),
      () => this.applications.dispatchAttempt(user.id, applicationId, attemptId),
    );
  }

  @Post("/:applicationId/attempts/:attemptId/result")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async result(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Param("attemptId") attemptId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId, attemptId);
    const body = applicationsBody<ApplicationSubmissionResultRequest>(
      request,
      validateApplicationSubmissionResult,
    );
    return this.applications.recordResult(user.id, applicationId, attemptId, body, commandKey);
  }

  @Post("/:applicationId/attempts/:attemptId/reconciliation")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async reconcile(
    @Req() request: AuthenticatedRequest,
    @Param("applicationId") applicationId: string,
    @Param("attemptId") attemptId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<Application> {
    const user = await this.identity.resolve(request, "applications:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    requireApplicationPath(applicationId, attemptId);
    const body = applicationsBody<ReconcileApplicationAttemptRequest>(
      request,
      validateReconcileApplicationAttempt,
    );
    return this.applications.reconcile(user.id, applicationId, attemptId, body, commandKey);
  }
}

function assertNoRequestInput(request: AuthenticatedRequest): void {
  if (
    (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
    (request.headers["content-length"] !== undefined &&
      request.headers["content-length"] !== "0") ||
    request.headers["transfer-encoding"] !== undefined
  ) {
    throw new HttpException("Request input is invalid", HttpStatus.BAD_REQUEST);
  }
}

/** Stripe subscription checkout and portal for the signed-in candidate, plus the signed webhook. */
@Controller("/v1/billing")
@UseFilters(ProblemDetailsFilter)
class StripeBillingController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(STRIPE_BILLING) private readonly billing: StripeBillingGateway,
  ) {}

  @Post("/checkout-sessions")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createCheckoutSession(@Req() request: AuthenticatedRequest): Promise<{ url: string }> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    return this.billing.startCheckout(user.id);
  }

  @Post("/portal-sessions")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async createPortalSession(@Req() request: AuthenticatedRequest): Promise<{ url: string }> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    return this.billing.openPortal(user.id);
  }

  /** Repairs a lost or delayed webhook by pulling the candidate's own subscription from Stripe. */
  @Post("/subscription-syncs")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async syncSubscription(@Req() request: AuthenticatedRequest): Promise<{ changed: boolean }> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    try {
      return await this.billing.syncSubscription(user.id);
    } catch {
      throw new StripeApiError(0, undefined);
    }
  }

  /** Public: authenticated only by the Stripe signature over the raw body. */
  @Post("/webhooks/stripe")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async receiveStripeWebhook(@Req() request: AuthenticatedRequest): Promise<{ received: true }> {
    const raw = (request as unknown as RawBodyRequest).rawBody;
    const signature = request.headers["stripe-signature"];
    if (!raw || typeof signature !== "string") {
      throw new HttpException("Invalid webhook request", HttpStatus.BAD_REQUEST);
    }
    try {
      await this.billing.handleWebhook(raw, signature);
    } catch (error) {
      if (error instanceof StripeSignatureError || error instanceof StripeWebhookPayloadError) {
        throw new HttpException("Invalid webhook request", HttpStatus.BAD_REQUEST);
      }
      // Anything else is ours or Stripe's to retry, so the delivery is not acknowledged.
      throw new HttpException("Webhook processing unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { received: true };
  }
}

/** The candidate's in-app action inbox and delivery preferences (ADR-055). */
export type NotificationsApi = Pick<
  NotificationsService,
  | "listInbox"
  | "acknowledge"
  | "dismiss"
  | "getPreferences"
  | "updatePreferences"
  | "getDeliveryStatus"
  | "requestEmailConfirmation"
  | "confirmEmail"
  | "removeEmail"
  | "addPushSubscription"
  | "removePushSubscription"
  | "sendTestNotification"
>;

class NotificationsUnavailableError extends Error {
  constructor() {
    super("Notifications are unavailable");
    this.name = "NotificationsUnavailableError";
  }
}

const validateUpdateNotificationPreferences = compileComponentValidator(
  "UpdateNotificationPreferencesRequest",
);
const validateRequestNotificationEmail = compileComponentValidator(
  "RequestNotificationEmailRequest",
);
const validateConfirmNotificationEmail = compileComponentValidator(
  "ConfirmNotificationEmailRequest",
);
const validateAddNotificationPushSubscription = compileComponentValidator(
  "AddNotificationPushSubscriptionRequest",
);
const NOTIFICATION_STATES: Readonly<Record<string, readonly InboxState[]>> = Object.freeze({
  open: ["unread", "acknowledged"],
  unread: ["unread"],
  dismissed: ["dismissed"],
  expired: ["expired"],
});

function projectNotificationItem(item: InboxItem): NotificationItemResponse {
  return {
    id: item.id,
    kind: item.kind,
    urgency: item.urgency,
    state: item.state,
    applicationId: item.applicationId,
    sourceRevision: item.sourceRevision,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
  };
}

function projectNotificationPreferences(
  preferences: NotificationPreferencesValue,
): NotificationPreferencesResponse {
  return {
    version: preferences.version,
    inAppEnabled: true,
    emailEnabled: preferences.emailEnabled,
    pushEnabled: preferences.pushEnabled,
    quietHours: { ...preferences.quietHours },
    updatedAt: preferences.updatedAt.toISOString(),
  };
}

async function notificationsOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NotificationsError) throw error;
    throw new NotificationsUnavailableError();
  }
}

/** Present only when Notifications is configured. Every route is scoped to the signed-in candidate. */
@Controller("/v1/notifications")
@UseFilters(ProblemDetailsFilter)
class NotificationsController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(NOTIFICATIONS) private readonly notifications: NotificationsApi,
  ) {}

  @Get()
  @Header("cache-control", "no-store")
  async list(@Req() request: AuthenticatedRequest): Promise<NotificationInboxPageResponse> {
    const user = await this.identity.resolve(request, "profile:read");
    if (
      request.body !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
    )
      throw new HttpException("Request input is invalid", HttpStatus.BAD_REQUEST);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const allowed = new Set(["state", "limit", "cursor"]);
    if (
      Object.keys(query).some((key) => !allowed.has(key)) ||
      Object.values(query).some((value) => typeof value !== "string")
    )
      throw new HttpException("Request input is invalid", HttpStatus.BAD_REQUEST);
    const state = query.state === undefined ? "open" : String(query.state);
    const states = NOTIFICATION_STATES[state];
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    if (
      !states ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (query.limit !== undefined && !/^[0-9]{1,3}$/u.test(String(query.limit))) ||
      (query.cursor !== undefined && !/^[A-Za-z0-9_-]{1,300}$/u.test(String(query.cursor)))
    )
      throw new HttpException("Request input is invalid", HttpStatus.BAD_REQUEST);
    const page = await notificationsOperation(() =>
      this.notifications.listInbox(user.id, {
        states,
        limit,
        ...(query.cursor !== undefined ? { cursor: String(query.cursor) } : {}),
      }),
    );
    return {
      items: page.items.map(projectNotificationItem),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      unreadCount: page.unreadCount,
    };
  }

  @Get("/preferences")
  @Header("cache-control", "no-store")
  async getPreferences(
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationPreferencesResponse> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:read");
    return projectNotificationPreferences(
      await notificationsOperation(() => this.notifications.getPreferences(user.id)),
    );
  }

  @Put("/preferences")
  @Header("cache-control", "no-store")
  async updatePreferences(
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationPreferencesResponse> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!validateUpdateNotificationPreferences(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateUpdateNotificationPreferences.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as UpdateNotificationPreferencesRequest;
    return projectNotificationPreferences(
      await notificationsOperation(() =>
        this.notifications.updatePreferences(user.id, input.expectedVersion, {
          emailEnabled: input.emailEnabled,
          pushEnabled: input.pushEnabled,
          quietHours: { ...input.quietHours },
        }),
      ),
    );
  }

  @Get("/delivery")
  @Header("cache-control", "no-store")
  async getDelivery(
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationDeliveryStatusResponse> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:read");
    const status = await notificationsOperation(() =>
      this.notifications.getDeliveryStatus(user.id),
    );
    return {
      ...(status.email ? { email: { ...status.email } } : {}),
      pushSubscriptions: status.pushSubscriptions.map((subscription) => ({
        id: subscription.id,
        state: subscription.state,
        createdAt: subscription.createdAt.toISOString(),
      })),
      ...(status.pushPublicKey ? { pushPublicKey: status.pushPublicKey } : {}),
    };
  }

  /** Starts confirming an address. The dispatcher emails the code; this request does not. */
  @Put("/delivery/email")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("cache-control", "no-store")
  async requestEmail(@Req() request: AuthenticatedRequest): Promise<void> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!validateRequestNotificationEmail(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateRequestNotificationEmail.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as RequestNotificationEmailRequest;
    await notificationsOperation(() =>
      this.notifications.requestEmailConfirmation(user.id, input.address),
    );
  }

  @Delete("/delivery/email")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async removeEmail(@Req() request: AuthenticatedRequest): Promise<void> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    await notificationsOperation(() => this.notifications.removeEmail(user.id));
  }

  @Post("/delivery/email/confirmation")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async confirmEmail(
    @Req() request: AuthenticatedRequest,
  ): Promise<ConfirmNotificationEmailResult> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!validateConfirmNotificationEmail(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateConfirmNotificationEmail.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as ConfirmNotificationEmailRequest;
    return {
      result: await notificationsOperation(() =>
        this.notifications.confirmEmail(user.id, input.code),
      ),
    };
  }

  @Post("/delivery/push-subscriptions")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async addPushSubscription(
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationPushSubscriptionCreated> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!validateAddNotificationPushSubscription(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateAddNotificationPushSubscription.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body as AddNotificationPushSubscriptionRequest;
    return notificationsOperation(() =>
      this.notifications.addPushSubscription(user.id, input.endpoint),
    );
  }

  /** Creates one test item so the candidate can see their channels work. At most five an hour. */
  @Post("/delivery/test")
  @HttpCode(HttpStatus.CREATED)
  @Header("cache-control", "no-store")
  async sendTest(@Req() request: AuthenticatedRequest): Promise<NotificationTestSent> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    return notificationsOperation(() => this.notifications.sendTestNotification(user.id));
  }

  @Delete("/delivery/push-subscriptions/:subscriptionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("cache-control", "no-store")
  async removePushSubscription(
    @Req() request: AuthenticatedRequest,
    @Param("subscriptionId") subscriptionId: string,
  ): Promise<void> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    await notificationsOperation(() =>
      this.notifications.removePushSubscription(user.id, subscriptionId),
    );
  }

  @Post("/:notificationId/acknowledgement")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async acknowledge(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId") notificationId: string,
  ): Promise<NotificationItemResponse> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    return projectNotificationItem(
      await notificationsOperation(() => this.notifications.acknowledge(user.id, notificationId)),
    );
  }

  @Post("/:notificationId/dismissal")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async dismiss(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId") notificationId: string,
  ): Promise<NotificationItemResponse> {
    assertNoRequestInput(request);
    const user = await this.identity.resolve(request, "profile:write");
    return projectNotificationItem(
      await notificationsOperation(() => this.notifications.dismiss(user.id, notificationId)),
    );
  }
}

@Controller("/v1/material-withdrawals")
@UseFilters(ProblemDetailsFilter)
class NativeMaterialWithdrawalsController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(NATIVE_MATERIAL_WITHDRAWALS)
    private readonly withdrawals: NativeMaterialWithdrawalApi | null,
  ) {}

  @Put("/:requestId")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("cache-control", "no-store")
  async create(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string) {
    const user = await this.identity.resolve(request, "applications:write");
    requireApplicationsRead(request);
    requireApplicationPath(requestId);
    try {
      if (!this.withdrawals) throw Error();
      return await this.withdrawals.create(user.id, requestId);
    } catch {
      throw new ApplicationsUnavailableError();
    }
  }
  @Get("/:requestId")
  @Header("cache-control", "no-store")
  async get(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string) {
    const user = await this.identity.resolve(request, "applications:read");
    requireApplicationsRead(request);
    requireApplicationPath(requestId);
    let result: Awaited<ReturnType<NativeMaterialWithdrawalApi["get"]>>;
    try {
      if (!this.withdrawals) throw Error();
      result = await this.withdrawals.get(user.id, requestId);
    } catch {
      throw new ApplicationsUnavailableError();
    }
    if (!result) throw new HttpException("Material withdrawal not found", HttpStatus.NOT_FOUND);
    return result;
  }
}

export interface AppModuleOptions {
  store: ProfileStore;
  restrictedAnswerVault?: RestrictedAnswerVaultStore;
  profileSections?: ProfileSectionStore;
  catalog: JobCatalogReader;
  jobReports: JobReports;
  jobContributions: JobContributions;
  contributionCapabilityPolicy?: ContributionCapabilityPolicySource;
  ugcContributionConsents: UgcContributionConsentStore;
  ugcContributionPolicyVersion?: string;
  moderation: JobModeration;
  privilegedModerationAudit?: PrivilegedModerationAuditWriter;
  savedJobs: SavedJobs;
  applications: ApplicationsApi;
  nativeMaterialWithdrawals?: NativeMaterialWithdrawalApi;
  privateSavedPageCaptures: PrivateSavedPageCaptures;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
  stripeBilling?: StripeBillingGateway;
  notifications?: NotificationsApi;
  documents: DocumentStore;
  trust: TrustApplicationService;
  trustReviewerAuthority: OidcTrustReviewerAuthority;
  candidateDataExportDownloads?: CandidateDataExportDownloadSigner;
  verifier: AccessTokenVerifier;
  idTokenVerifier?: IdTokenVerifier;
  releaseSha: string;
  clock?: () => Date;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS modules are class-based composition roots.
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        CandidateController,
        OwnerTrustController,
        ApplicationsController,
        NativeMaterialWithdrawalsController,
        AdminModerationController,
        AdminTrustController,
        ...(options.contributionCapabilityPolicy
          ? [ExtensionContributionCapabilityPolicyController]
          : []),
        ...(options.stripeBilling ? [StripeBillingController] : []),
        ...(options.notifications ? [NotificationsController] : []),
      ],
      providers: [
        RequestIdentity,
        { provide: PROFILE_STORE, useValue: options.store },
        { provide: JOB_CATALOG, useValue: options.catalog },
        { provide: JOB_REPORTS, useValue: options.jobReports },
        { provide: JOB_CONTRIBUTIONS, useValue: options.jobContributions },
        {
          provide: CONTRIBUTION_CAPABILITY_POLICY,
          useValue: options.contributionCapabilityPolicy ?? null,
        },
        { provide: UGC_CONTRIBUTION_CONSENTS, useValue: options.ugcContributionConsents },
        {
          provide: UGC_CONTRIBUTION_POLICY_VERSION,
          useValue: options.ugcContributionPolicyVersion ?? null,
        },
        { provide: JOB_MODERATION, useValue: options.moderation },
        {
          provide: PRIVILEGED_MODERATION_AUDIT,
          useValue: options.privilegedModerationAudit ?? null,
        },
        { provide: SAVED_JOBS, useValue: options.savedJobs },
        { provide: APPLICATIONS, useValue: options.applications },
        {
          provide: NATIVE_MATERIAL_WITHDRAWALS,
          useValue: options.nativeMaterialWithdrawals ?? null,
        },
        { provide: PRIVATE_SAVED_PAGE_CAPTURES, useValue: options.privateSavedPageCaptures },
        { provide: MATCH_ASSESSMENTS, useValue: options.matchAssessments },
        { provide: ENTITLEMENTS, useValue: options.entitlements },
        { provide: STRIPE_BILLING, useValue: options.stripeBilling ?? null },
        { provide: NOTIFICATIONS, useValue: options.notifications ?? null },
        { provide: DOCUMENT_STORE, useValue: options.documents },
        { provide: TRUST_APPLICATION, useValue: options.trust },
        { provide: TRUST_REVIEWER_AUTHORITY, useValue: options.trustReviewerAuthority },
        {
          provide: CANDIDATE_DATA_EXPORT_DOWNLOADS,
          useValue: options.candidateDataExportDownloads ?? null,
        },
        { provide: RESTRICTED_ANSWER_VAULT, useValue: options.restrictedAnswerVault ?? null },
        { provide: PROFILE_SECTIONS, useValue: options.profileSections ?? null },
        { provide: TOKEN_VERIFIER, useValue: options.verifier },
        { provide: ID_TOKEN_VERIFIER, useValue: options.idTokenVerifier ?? null },
        { provide: RELEASE_SHA, useValue: options.releaseSha },
        { provide: CLOCK, useValue: options.clock ?? (() => new Date()) },
      ],
    };
  }
}

export async function applyRequestContext(
  request: AuthenticatedRequest,
  reply: FastifyReply,
): Promise<void> {
  request.traceId = correlationId(
    typeof request.headers["x-correlation-id"] === "string"
      ? request.headers["x-correlation-id"]
      : undefined,
  );
  reply.header("x-correlation-id", request.traceId);
}
