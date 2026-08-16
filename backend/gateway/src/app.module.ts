import type {
  CanonicalJobDetail,
  CreateJobReportRequest,
  CreateProfileFactRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CreateSavedJobRequest,
  CurrentUser,
  EntitlementSummary,
  JobReport,
  JobSearchPage,
  JobSearchRequest,
  MatchAssessment,
  Operation,
  ProblemDetails,
  ProfileFact,
  ProfileFactCollection,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ResumeDocumentCollection,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator, formatValidationErrors } from "@ai-job-apply/api-contracts";
import { type AccessTokenVerifier, AuthenticationError, bearerToken } from "@ai-job-apply/auth";
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
  InvalidJobSearchError,
  JobAlreadyReportedError,
  type JobCatalogReader,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  JobReportServiceUnavailableError,
  type JobReports,
  JobReportTargetUnavailableError,
  JobSearchCatalogChangedError,
} from "@ai-job-apply/jobs-service";
import {
  InvalidSavedJobCursorError,
  MatchAssessmentServiceUnavailableError,
  type MatchAssessments,
  MatchAssessmentTargetUnavailableError,
  MatchAssessmentUnavailableError,
  MatchPreferencesRequiredError,
  SavedJobCollectionChangedError,
  SavedJobIdempotencyConflictError,
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
  type SavedJobs,
  SavedJobTargetUnavailableError,
} from "@ai-job-apply/matching-service";
import { activeTraceparent, correlationId } from "@ai-job-apply/observability";
import {
  IdempotencyConflictError,
  ProfileFactTransitionConflictError,
  ProfileFactVersionConflictError,
  type ProfileStore,
} from "@ai-job-apply/profile-service";
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

const PROFILE_STORE = Symbol("PROFILE_STORE");
const JOB_CATALOG = Symbol("JOB_CATALOG");
const JOB_REPORTS = Symbol("JOB_REPORTS");
const SAVED_JOBS = Symbol("SAVED_JOBS");
const MATCH_ASSESSMENTS = Symbol("MATCH_ASSESSMENTS");
const ENTITLEMENTS = Symbol("ENTITLEMENTS");
const DOCUMENT_STORE = Symbol("DOCUMENT_STORE");
const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
const RELEASE_SHA = Symbol("RELEASE_SHA");
const CLOCK = Symbol("CLOCK");

interface AuthenticatedRequest extends FastifyRequest {
  traceId?: string;
}

const SAFE_ERROR_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_ERROR_CODE = /^[A-Z0-9_]{2,32}$/;
const SAFE_ROUTE_TEMPLATES = new Set([
  "/health/live",
  "/health/ready",
  "/v1/me",
  "/v1/me/job-preferences",
  "/v1/profile/facts",
  "/v1/profile/facts/:factId",
  "/v1/resumes",
  "/v1/resumes/uploads",
  "/v1/jobs/search",
  "/v1/jobs/:jobId",
  "/v1/jobs/:jobId/match-assessment",
  "/v1/jobs/:jobId/reports",
  "/v1/saved-jobs",
  "/v1/saved-jobs/search",
  "/v1/saved-jobs/:savedJobId",
  "/v1/entitlements",
  "/v1/operations/:operationId",
]);

export function privacySafeRequestFailure(exception: unknown, routeTemplate: string | undefined) {
  const candidate = exception as { code?: unknown; name?: unknown };
  const errorType =
    typeof candidate?.name === "string" && SAFE_ERROR_IDENTIFIER.test(candidate.name)
      ? candidate.name
      : "UnknownError";
  const errorCode =
    typeof candidate?.code === "string" && SAFE_ERROR_CODE.test(candidate.code)
      ? candidate.code
      : "UNKNOWN";
  return {
    event: "unhandled_request_failure",
    route:
      typeof routeTemplate === "string" && SAFE_ROUTE_TEMPLATES.has(routeTemplate)
        ? routeTemplate
        : "unknown",
    error_type: errorType,
    error_code: errorCode,
  } as const;
}

@Injectable()
class RequestIdentity {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
  ) {}

  async authorize(
    request: AuthenticatedRequest,
    requiredScope:
      | "documents:read"
      | "documents:write"
      | "jobs:read"
      | "jobs:write"
      | "profile:read"
      | "profile:write",
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
      | "jobs:write"
      | "profile:read"
      | "profile:write",
  ): Promise<CurrentUser> {
    const principal = await this.authorize(request, requiredScope);
    return this.store.resolveUser(principal, request.traceId ?? correlationId(undefined));
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

    if (exception instanceof AuthenticationError) {
      status = HttpStatus.UNAUTHORIZED;
      code = "authentication_required";
      title = "Authentication required";
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

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      request.log.error(
        privacySafeRequestFailure(exception, request.routeOptions.url),
        "Request failed with an unhandled privacy-safe error classification",
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
        this.savedJobs.ping(),
        this.entitlements.ping(),
      ]);
      return { status: "ok", service: "gateway", releaseSha: this.releaseSha };
    } catch {
      throw new HttpException("PostgreSQL is unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

const validatePreferences = compileComponentValidator("PutJobPreferencesRequest");
const validateCreateProfileFact = compileComponentValidator("CreateProfileFactRequest");
const validateUpdateProfileFact = compileComponentValidator("UpdateProfileFactRequest");
const validateCreateResumeUpload = compileComponentValidator("CreateResumeUploadRequest");
const validateJobSearch = compileComponentValidator("JobSearchRequest");
const validateCreateSavedJob = compileComponentValidator("CreateSavedJobRequest");
const validateSavedJobSearch = compileComponentValidator("SavedJobSearchRequest");
const validateMatchAssessment = compileComponentValidator("MatchAssessment");
const validateCreateJobReport = compileComponentValidator("CreateJobReportRequest");
const validateJobReport = compileComponentValidator("JobReport");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 16 || value.length > 128) {
    throw new HttpException(
      "Idempotency-Key must contain 16 to 128 characters",
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
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

@Controller("/v1")
@UseFilters(ProblemDetailsFilter)
class CandidateController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(JOB_CATALOG) private readonly catalog: JobCatalogReader,
    @Inject(JOB_REPORTS) private readonly jobReports: JobReports,
    @Inject(SAVED_JOBS) private readonly savedJobs: SavedJobs,
    @Inject(MATCH_ASSESSMENTS) private readonly matchAssessments: MatchAssessments,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementReadService,
    @Inject(DOCUMENT_STORE) private readonly documents: DocumentStore,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  @Get("/me")
  async me(@Req() request: AuthenticatedRequest): Promise<CurrentUser> {
    return this.identity.resolve(request, "profile:read");
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
    const page = await this.catalog.searchActiveJobs(request.body as JobSearchRequest);
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
  savedJobs: SavedJobs;
  matchAssessments: MatchAssessments;
  entitlements: EntitlementReadService;
  documents: DocumentStore;
  verifier: AccessTokenVerifier;
  releaseSha: string;
  clock?: () => Date;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS modules are class-based composition roots.
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, CandidateController],
      providers: [
        RequestIdentity,
        { provide: PROFILE_STORE, useValue: options.store },
        { provide: JOB_CATALOG, useValue: options.catalog },
        { provide: JOB_REPORTS, useValue: options.jobReports },
        { provide: SAVED_JOBS, useValue: options.savedJobs },
        { provide: MATCH_ASSESSMENTS, useValue: options.matchAssessments },
        { provide: ENTITLEMENTS, useValue: options.entitlements },
        { provide: DOCUMENT_STORE, useValue: options.documents },
        { provide: TOKEN_VERIFIER, useValue: options.verifier },
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
