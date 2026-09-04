import { createHash } from "node:crypto";
import type {
  AccountDeletionRequest,
  CandidateDataExport,
  CandidateDataExportAccess,
  CandidateDataExportDownloadGrant,
  CanonicalJobDetail,
  ConfirmAccountDeletionRequest,
  CreateAccountDeletionRequest,
  CreateCandidateDataExportRequest,
  CreateJobContributionRequest,
  CreateJobReportRequest,
  CreatePrivateSavedPageCaptureRequest,
  CreateProfileFactRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CreateSavedJobRequest,
  CurrentUser,
  DecideTrustCaseRequest,
  EntitlementSummary,
  FileTrustAppealRequest,
  GrantUgcContributionConsentRequest,
  JobContribution,
  JobReport,
  JobReportSummary,
  JobSearchPage,
  JobSearchRequest,
  MatchAssessment,
  ModerationCase,
  ModerationCasePage,
  ModerationCaseSearchRequest,
  OpenModerationCaseRequest,
  OpenTrustCaseRequest,
  Operation,
  OwnerTrustCase,
  PrivateSavedPageCapture as PrivateSavedPageCaptureResponse,
  ProblemDetails,
  ProfileFact,
  ProfileFactCollection,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ResolveModerationCaseRequest,
  ResolveTrustAppealRequest,
  ResumeDocumentCollection,
  ReviewerTrustCase,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  SignedContributionCapabilityPolicy,
  TakeDownTrustCaseRequest,
  UgcContributionConsentGrant,
  UpdateProfileFactRequest,
  WithdrawTrustContributionRequest,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator, formatValidationErrors } from "@ai-job-apply/api-contracts";
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
} from "@ai-job-apply/billing-service";
import {
  DocumentIdempotencyConflictError,
  DocumentIntakeUnavailableError,
  type DocumentStore,
  ResumeDocumentLimitError,
} from "@ai-job-apply/documents-service";
import {
  type ContributionCapabilityPolicySource,
  ContributionCapabilityPolicySourceUnavailableError,
  InvalidJobSearchError,
  InvalidModerationCursorError,
  JobAlreadyReportedError,
  type JobCatalogReader,
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
import { activeTraceparent, correlationId } from "@ai-job-apply/observability";
import {
  AccountQuarantinedError,
  type CandidateDataExportRecord,
  CandidateRightsAuthenticationError,
  CandidateRightsMfaError,
  CandidateRightsPolicyError,
  CandidateRightsTransitionError,
  IdempotencyConflictError,
  ProfileFactTransitionConflictError,
  ProfileFactVersionConflictError,
  type ProfileStore,
  UgcContributionConsentConflictError,
  type UgcContributionConsentStore,
  UgcContributionConsentUnavailableError,
} from "@ai-job-apply/profile-service";
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
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  type OidcTrustReviewerAuthority,
  TrustReviewerAccessDeniedError,
} from "./trust-reviewer-authority.js";

const PROFILE_STORE = Symbol("PROFILE_STORE");
const JOB_CATALOG = Symbol("JOB_CATALOG");
const JOB_REPORTS = Symbol("JOB_REPORTS");
const JOB_CONTRIBUTIONS = Symbol("JOB_CONTRIBUTIONS");
const CONTRIBUTION_CAPABILITY_POLICY = Symbol("CONTRIBUTION_CAPABILITY_POLICY");
const UGC_CONTRIBUTION_CONSENTS = Symbol("UGC_CONTRIBUTION_CONSENTS");
const UGC_CONTRIBUTION_POLICY_VERSION = Symbol("UGC_CONTRIBUTION_POLICY_VERSION");
const JOB_MODERATION = Symbol("JOB_MODERATION");
const SAVED_JOBS = Symbol("SAVED_JOBS");
const PRIVATE_SAVED_PAGE_CAPTURES = Symbol("PRIVATE_SAVED_PAGE_CAPTURES");
const MATCH_ASSESSMENTS = Symbol("MATCH_ASSESSMENTS");
const ENTITLEMENTS = Symbol("ENTITLEMENTS");
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
  "/v1/profile/facts",
  "/v1/profile/facts/:factId",
  "/v1/resumes",
  "/v1/resumes/uploads",
  "/v1/jobs/search",
  "/v1/jobs/:jobId",
  "/v1/jobs/:jobId/match-assessment",
  "/v1/jobs/:jobId/reports",
  "/v1/jobs/contributions",
  "/v1/jobs/contributions/:contributionId",
  "/v1/extension/contribution-capability-policy",
  "/v1/trust/contributions/:contributionId",
  "/v1/trust/contributions/:contributionId/withdraw",
  "/v1/trust/contributions/:contributionId/appeals",
  "/v1/admin/trust/cases",
  "/v1/admin/trust/cases/:caseId",
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
      ? (directCause.cause as { code?: unknown } | undefined)
      : directCause;
  const postgresCauseCode =
    errorType === "JobContributionUnavailableError" &&
    routeTemplate === "/v1/jobs/contributions" &&
    typeof cause?.code === "string" &&
    /^(?:08|0A|22|23|25|2D|3D|3F|40|42|53|54|55|57|58|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(cause.code)
      ? cause.code
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
    } else if (exception instanceof ProfileFactVersionConflictError) {
      status = HttpStatus.CONFLICT;
      code = "version_conflict";
      title = "Profile fact version conflict";
      detail = exception.message;
    } else if (exception instanceof ProfileFactTransitionConflictError) {
      status = HttpStatus.CONFLICT;
      code = "profile_fact_transition_conflict";
      title = "Profile fact transition conflict";
      detail = exception.message;
    } else if (exception instanceof DocumentIdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof ResumeDocumentLimitError) {
      status = HttpStatus.CONFLICT;
      code = "resume_document_limit";
      title = "Resume document limit reached";
      detail = exception.message;
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
const validateCreateProfileFact = compileComponentValidator("CreateProfileFactRequest");
const validateUpdateProfileFact = compileComponentValidator("UpdateProfileFactRequest");
const validateCreateResumeUpload = compileComponentValidator("CreateResumeUploadRequest");
const validateJobSearch = compileComponentValidator("JobSearchRequest");
const validateCreateSavedJob = compileComponentValidator("CreateSavedJobRequest");
const validateCreatePrivateSavedPageCapture = compileComponentValidator(
  "CreatePrivateSavedPageCaptureRequest",
);
const validatePrivateSavedPageCapture = compileComponentValidator("PrivateSavedPageCapture");
const validateSavedJobSearch = compileComponentValidator("SavedJobSearchRequest");
const validateMatchAssessment = compileComponentValidator("MatchAssessment");
const validateCreateJobReport = compileComponentValidator("CreateJobReportRequest");
const validateJobReport = compileComponentValidator("JobReport");
const validateCreateJobContribution = compileComponentValidator("CreateJobContributionRequest");
const validateJobContribution = compileComponentValidator("JobContribution");
const validateOwnerTrustCase = compileComponentValidator("OwnerTrustCase");
const validateReviewerTrustCase = compileComponentValidator("ReviewerTrustCase");
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
  const base = {
    grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
    version: evaluation.version,
    evaluatedAt: evaluation.evaluatedAt,
  } satisfies Pick<EntitlementSummary, "grants" | "version" | "evaluatedAt">;
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
  ) {}

  @Post("/cases/search")
  @HttpCode(HttpStatus.OK)
  @Header("cache-control", "no-store")
  async searchCases(@Req() request: AuthenticatedRequest): Promise<ModerationCasePage> {
    await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      !validateModerationCaseSearch(request.body)
    ) {
      throw new HttpException(
        formatValidationErrors(validateModerationCaseSearch.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
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
    await this.identity.operator(request);
    if (
      (request.query && Object.keys(request.query as Record<string, unknown>).length > 0) ||
      request.body !== undefined ||
      !UUID_V7_PATTERN.test(jobId)
    ) {
      throw new HttpException("The report-summary input is invalid", HttpStatus.BAD_REQUEST);
    }
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

  @Get("/profile/facts")
  async listProfileFacts(@Req() request: AuthenticatedRequest): Promise<ProfileFactCollection> {
    const user = await this.identity.resolve(request, "profile:read");
    return this.store.listProfileFacts(user.id);
  }

  @Post("/profile/facts")
  @HttpCode(HttpStatus.CREATED)
  async createProfileFact(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileFact> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!validateCreateProfileFact(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateCreateProfileFact.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.store.createProfileFact(
      user.id,
      request.body as CreateProfileFactRequest,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
  }

  @Patch("/profile/facts/:factId")
  async updateProfileFact(
    @Req() request: AuthenticatedRequest,
    @Param("factId") factId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ProfileFact> {
    const user = await this.identity.resolve(request, "profile:write");
    const commandKey = requireIdempotencyKey(idempotencyKey);
    if (!UUID_PATTERN.test(factId)) {
      throw new HttpException("Profile fact identifier is invalid", HttpStatus.BAD_REQUEST);
    }
    if (!validateUpdateProfileFact(request.body)) {
      throw new HttpException(
        formatValidationErrors(validateUpdateProfileFact.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    const fact = await this.store.updateProfileFact(
      user.id,
      factId,
      request.body as UpdateProfileFactRequest,
      commandKey,
      request.traceId ?? correlationId(undefined),
    );
    if (!fact) {
      throw new HttpException("Profile fact was not found", HttpStatus.NOT_FOUND);
    }
    return fact;
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
  async listResumes(@Req() request: AuthenticatedRequest): Promise<ResumeDocumentCollection> {
    const user = await this.identity.resolve(request, "documents:read");
    return this.documents.listResumeDocuments(user.id);
  }

  @Post("/resumes/uploads")
  @HttpCode(HttpStatus.CREATED)
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

export interface AppModuleOptions {
  store: ProfileStore;
  catalog: JobCatalogReader;
  jobReports: JobReports;
  jobContributions: JobContributions;
  contributionCapabilityPolicy?: ContributionCapabilityPolicySource;
  ugcContributionConsents: UgcContributionConsentStore;
  ugcContributionPolicyVersion?: string;
  moderation: JobModeration;
  savedJobs: SavedJobs;
  privateSavedPageCaptures: PrivateSavedPageCaptures;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
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
        AdminModerationController,
        AdminTrustController,
        ...(options.contributionCapabilityPolicy
          ? [ExtensionContributionCapabilityPolicyController]
          : []),
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
        { provide: SAVED_JOBS, useValue: options.savedJobs },
        { provide: PRIVATE_SAVED_PAGE_CAPTURES, useValue: options.privateSavedPageCaptures },
        { provide: MATCH_ASSESSMENTS, useValue: options.matchAssessments },
        { provide: ENTITLEMENTS, useValue: options.entitlements },
        { provide: DOCUMENT_STORE, useValue: options.documents },
        { provide: TRUST_APPLICATION, useValue: options.trust },
        { provide: TRUST_REVIEWER_AUTHORITY, useValue: options.trustReviewerAuthority },
        {
          provide: CANDIDATE_DATA_EXPORT_DOWNLOADS,
          useValue: options.candidateDataExportDownloads ?? null,
        },
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
