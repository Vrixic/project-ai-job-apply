import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
} from "@ai-job-apply/applications-service";
import { legacyReceiptReplayFromEnvironment } from "@ai-job-apply/applications-service/legacy-receipt-runtime";
import { restrictedPacketWriterFromEnvironment } from "@ai-job-apply/applications-service/restricted-packet-runtime";
import {
  nativeMaterialAvailabilityFromEnvironment,
  withNativeMaterialInvocationCredential,
} from "./native-material-availability.js";
import { nativeMaterialDisposalFromEnvironment } from "./native-material-disposal-runtime.js";
import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { ApplicationEventOutbox } from "@ai-job-apply/applications-service";
import {
  type AccessTokenVerifier,
  AuthenticationError,
  type AuthPrincipal,
  bearerToken,
  createOidcIdTokenVerifier,
} from "@ai-job-apply/auth";
import {
  BillingEntitlementService,
  EntitlementCache,
  PostgresBillingStore,
} from "@ai-job-apply/billing-service";
import {
  type D2LambdaGatewayConfiguration,
  type LambdaGatewayConfig,
  loadD2LambdaGatewayConfigSafely,
  loadLambdaGatewayConfig,
} from "@ai-job-apply/config";
import {
  PostgresDocumentStore,
  S3ResumeUploadSigner,
  UnavailableDocumentStore,
} from "@ai-job-apply/documents-service";
import {
  type ContributionCapabilityPolicySource,
  type ContributionCapabilitySource,
  contributionCapabilityPolicySourceFromEnvironment,
  contributionCapabilitySourceFromEnvironment,
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
import { createLogger, initializeTelemetry } from "@ai-job-apply/observability";
import {
  createDatabase,
  createProfileSectionStore,
  loadCandidateRightsPolicyIfConfigured,
  PostgresProfileStore,
  PostgresRestrictedAnswerVaultStore,
  PostgresUgcContributionConsentStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import { createPrivilegedModerationAuditRuntime } from "@ai-job-apply/profile-service/privileged-moderation-audit";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";
import { createGatewayApplication } from "./application.js";
import { createApplicationsRuntime } from "./applications-runtime.js";
import { S3CandidateDataExportDownloadSigner } from "./candidate-data-export-download-signer.js";
import { S3CandidateDeletionConfirmationJournal } from "./candidate-deletion-confirmation-journal.js";
import { createConfiguredD2TrustRuntime } from "./d2-trust-runtime.js";
import { MAXIMUM_GATEWAY_BODY_BYTES } from "./gateway-boundary.js";
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
import { SqsOutboxNudgePublisher } from "./sqs-outbox-nudge-publisher.js";
import { createStripeBillingGateway } from "./stripe-billing.js";

type JwtClaimValue = string | number | boolean | string[] | undefined;

interface JwtAuthorizerContext {
  jwt?: {
    claims?: Record<string, JwtClaimValue>;
    scopes?: string[];
  };
}

export type AuthorizedHttpApiEvent = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: JwtAuthorizerContext;
  };
};

interface InjectableApplication {
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: string;
  }): Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | number | undefined>;
  }>;
}

export interface ApiGatewayHandlerOptions {
  app: Promise<InjectableApplication>;
  issuer: string;
  audience: string;
  principalBridge: InvocationPrincipalBridge;
  d2Routes?: Partial<D2GatewayRouteGates>;
  onAuthenticationFailure?: (diagnostic: AuthenticationContextDiagnostic) => void;
}

export interface D2GatewayRouteGates {
  privateCapture: boolean;
  contributionPolicy: boolean;
  candidateContribution: boolean;
  trustReviewer: boolean;
}

const disabledD2GatewayRoutes: Readonly<D2GatewayRouteGates> = Object.freeze({
  privateCapture: false,
  contributionPolicy: false,
  candidateContribution: false,
  trustReviewer: false,
});

export interface AuthenticationContextDiagnostic {
  claimsPresent: boolean;
  subjectPresent: boolean;
  issuerMatches: boolean;
  audienceMatches: boolean;
  audienceEncoding: "absent" | "array" | "json_array" | "scalar" | "unsupported";
}

export interface InvocationPrincipalBridge {
  verifier: AccessTokenVerifier;
  run<T>(
    principal: AuthPrincipal,
    dispatch: (internalAccessToken: string) => Promise<T>,
  ): Promise<T>;
}

export type ApiGatewayHandler = (
  event: AuthorizedHttpApiEvent,
) => Promise<APIGatewayProxyStructuredResultV2>;

const PUBLIC_PATHS = new Set(["/health/live", "/health/ready"]);
const PROTECTED_EXACT_ROUTES = new Set([
  "GET /v1/me",
  "GET /v1/me/job-preferences",
  "PUT /v1/me/job-preferences",
  "POST /v1/me/data-exports",
  "POST /v1/me/account-deletion-requests",
  "GET /v1/profile/personal",
  "PUT /v1/profile/personal",
  "GET /v1/profile/import-drafts",
  "GET /v1/profile/education-entries",
  "POST /v1/profile/education-entries",
  "GET /v1/profile/work-experience-entries",
  "POST /v1/profile/work-experience-entries",
  "GET /v1/profile/skill-entries",
  "POST /v1/profile/skill-entries",
  "GET /v1/profile/application-answers",
  "POST /v1/profile/application-answers",
  "POST /v1/profile/education-entries/reorder",
  "POST /v1/profile/work-experience-entries/reorder",
  "POST /v1/profile/skill-entries/reorder",
  "GET /v1/profile/restricted-answers",
  "GET /v1/resumes",
  "POST /v1/resumes/uploads",
  "POST /v1/jobs/search",
  "POST /v1/admin/moderation/cases",
  "POST /v1/admin/moderation/cases/search",
  "POST /v1/saved-jobs",
  "POST /v1/saved-jobs/search",
  "GET /v1/entitlements",
  "GET /v1/notifications/preferences",
  "PUT /v1/notifications/preferences",
  "GET /v1/notifications/delivery",
  "POST /v1/notifications/delivery/push-subscriptions",
]);
const NOTIFICATION_TEST_ROUTE = "POST /v1/notifications/delivery/test";
const NOTIFICATION_ACCOUNT_EMAIL_ROUTE = "PUT /v1/notifications/delivery/email";
const NOTIFICATION_PUSH_SUBSCRIPTION_PATH_PATTERN =
  /^\/v1\/notifications\/delivery\/push-subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOTIFICATION_COMMAND_PATH_PATTERN =
  /^\/v1\/notifications\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:acknowledgement|dismissal)$/;
const OPERATION_PATH_PATTERN =
  /^\/v1\/operations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_PATH_PATTERN =
  /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_ASSESSMENT_PATH_PATTERN =
  /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/match-assessment$/;
const JOB_REPORT_PATH_PATTERN =
  /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/reports$/;
const MODERATION_RESOLUTION_PATH_PATTERN =
  /^\/v1\/admin\/moderation\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/resolve$/;
const MODERATION_REPORT_SUMMARY_PATH_PATTERN =
  /^\/v1\/admin\/moderation\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/report-summary$/;
const PROFILE_RECORD_PATH_PATTERN =
  /^\/v1\/profile\/(?:education-entries|work-experience-entries|skill-entries|application-answers)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_DRAFT_PATH_PATTERN =
  /^\/v1\/profile\/import-drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_DRAFT_SAVE_PATH_PATTERN =
  /^\/v1\/profile\/import-drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/save$/i;
const RESTRICTED_ANSWER_PATH_PATTERN =
  /^\/v1\/profile\/restricted-answers\/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const SAVED_JOB_PATH_PATTERN =
  /^\/v1\/saved-jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const D2_UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const D2_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PRIVATE_CAPTURE_PATH_PATTERN = new RegExp(`^/v1/saved-job-captures/${D2_UUID_V7}$`, "u");
const RESUME_PATH_PATTERN = new RegExp(`^/v1/resumes/${D2_UUID_V7}$`, "u");
const CONTRIBUTION_PATH_PATTERN = new RegExp(`^/v1/jobs/contributions/${D2_UUID_V7}$`, "u");
const CONTRIBUTION_CANCEL_PATH_PATTERN = new RegExp(
  `^/v1/jobs/contributions/${D2_UUID_V7}/cancel$`,
  "u",
);
const CONSENT_REVOKE_PATH_PATTERN = new RegExp(
  `^/v1/profile/ugc-contribution-consents/${D2_UUID_V7}/revoke$`,
  "u",
);
const OWNER_TRUST_PATH_PATTERN = new RegExp(`^/v1/trust/contributions/${D2_UUID_V7}$`, "u");
const OWNER_TRUST_WITHDRAW_PATH_PATTERN = new RegExp(
  `^/v1/trust/contributions/${D2_UUID_V7}/withdraw$`,
  "u",
);
const OWNER_TRUST_APPEAL_PATH_PATTERN = new RegExp(
  `^/v1/trust/contributions/${D2_UUID_V7}/appeals$`,
  "u",
);
const REVIEWER_TRUST_CASE_PATH_PATTERN = new RegExp(`^/v1/admin/trust/cases/${D2_UUID}$`, "u");
const REVIEWER_TRUST_EVIDENCE_PATH_PATTERN = new RegExp(
  `^/v1/admin/trust/cases/${D2_UUID}/evidence$`,
  "u",
);
const REVIEWER_TRUST_DECISION_PATH_PATTERN = new RegExp(
  `^/v1/admin/trust/cases/${D2_UUID}/decision$`,
  "u",
);
const REVIEWER_TRUST_TAKEDOWN_PATH_PATTERN = new RegExp(
  `^/v1/admin/trust/cases/${D2_UUID}/takedown$`,
  "u",
);
const REVIEWER_TRUST_APPEAL_PATH_PATTERN = new RegExp(
  `^/v1/admin/trust/cases/${D2_UUID}/appeal-resolution$`,
  "u",
);
const CANDIDATE_DATA_EXPORT_PATH_PATTERN =
  /^\/v1\/me\/data-exports\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_DELETION_REQUEST_PATH_PATTERN =
  /^\/v1\/me\/account-deletion-requests\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_DELETION_CONFIRMATION_PATH_PATTERN =
  /^\/v1\/me\/account-deletion-requests\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/confirm$/;
const APPLICATION_ID = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const APPLICATION_READ_PATH_PATTERN = new RegExp(`^/v1/applications/${APPLICATION_ID}$`, "u");
const APPLICATION_HISTORY_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/history$`,
  "u",
);
const APPLICATION_RESUME_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/resume$`,
  "u",
);
const APPLICATION_RESUME_FILE_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/resume/file$`,
  "u",
);
const APPLICATION_UPLOADED_RESUME_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/resume/uploaded$`,
  "u",
);
const APPLICATION_COVER_LETTER_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/cover-letter$`,
  "u",
);
const APPLICATION_MATERIAL_AUTHORIZATION_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/(?:cover-letter|resume)/(?:authorization|location)$`,
  "u",
);
const APPLICATION_GENERATION_ID_PATTERN = new RegExp(`^${APPLICATION_ID}$`, "u");
const APPLICATION_COVER_LETTER_FILE_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/cover-letter/file$`,
  "u",
);
const APPLICATION_PREPARATION_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/packet-preparations/${APPLICATION_ID}$`,
  "u",
);
const APPLICATION_COMMAND_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/(?:packets|approval|reopen|cancel|submissions|manual-submissions)$`,
  "u",
);
const APPLICATION_DISPATCH_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/attempts/${APPLICATION_ID}/dispatch$`,
  "u",
);
const APPLICATION_NATIVE_AVAILABILITY_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/(?:approval|submissions|manual-submissions)$`,
  "u",
);
const APPLICATION_ATTEMPT_COMMAND_PATH_PATTERN = new RegExp(
  `^/v1/applications/${APPLICATION_ID}/attempts/${APPLICATION_ID}/(?:result|reconciliation)$`,
  "u",
);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const MAXIMUM_BEARER_TOKEN_BYTES = 16 * 1024;

interface AllowedRoute {
  acceptsBody: boolean;
  protected: boolean;
  acceptsReviewQueueQuery?: true;
  acceptsApplicationHistoryQuery?: true;
  acceptsApplicationGenerationQuery?: true;
  acceptsApplicationResumeFormatQuery?: true;
  acceptsRestrictedAnswerContextQuery?: true;
  acceptsProfileExpectedVersionQuery?: true;
  acceptsNotificationsQuery?: true;
}

function exactD2RouteKey(routeKey: string, expected: string): boolean {
  return routeKey === expected;
}

function allowedRoute(
  method: string,
  path: string,
  routeKey: string,
  d2Routes: Readonly<D2GatewayRouteGates>,
): AllowedRoute | undefined {
  if (method === "GET" && PUBLIC_PATHS.has(path)) {
    return { acceptsBody: false, protected: false };
  }
  if (
    (method === "PUT" || method === "GET") &&
    new RegExp(`^/v1/material-withdrawals/${APPLICATION_ID}$`, "u").test(path)
  )
    return { acceptsBody: false, protected: true };
  if (
    method === "POST" &&
    (path === "/v1/billing/checkout-sessions" ||
      path === "/v1/billing/portal-sessions" ||
      path === "/v1/billing/subscription-syncs")
  ) {
    return { acceptsBody: false, protected: true };
  }
  // The Stripe webhook is the one public write route. It authenticates itself by verifying the
  // Stripe signature over the raw body, and the app registers it only when billing is configured.
  if (method === "POST" && path === "/v1/billing/webhooks/stripe") {
    return { acceptsBody: true, protected: false };
  }
  if (method === "GET" && path === "/v1/notifications") {
    return { acceptsBody: false, protected: true, acceptsNotificationsQuery: true };
  }
  if (
    `${method} ${path}` === NOTIFICATION_TEST_ROUTE ||
    `${method} ${path}` === NOTIFICATION_ACCOUNT_EMAIL_ROUTE
  ) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "POST" && NOTIFICATION_COMMAND_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "DELETE" && NOTIFICATION_PUSH_SUBSCRIPTION_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (PROTECTED_EXACT_ROUTES.has(`${method} ${path}`)) {
    return { acceptsBody: method === "PUT" || method === "POST", protected: true };
  }
  if (
    method === "POST" &&
    (path === "/v1/applications" ||
      path === "/v1/applications/search" ||
      APPLICATION_COMMAND_PATH_PATTERN.test(path) ||
      APPLICATION_ATTEMPT_COMMAND_PATH_PATTERN.test(path))
  ) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "POST" && APPLICATION_DISPATCH_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "GET" && APPLICATION_READ_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "GET" && APPLICATION_MATERIAL_AUTHORIZATION_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true, acceptsApplicationGenerationQuery: true };
  }
  if (method === "GET" && APPLICATION_HISTORY_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true, acceptsApplicationHistoryQuery: true };
  }
  if (
    method === "GET" &&
    (APPLICATION_RESUME_PATH_PATTERN.test(path) ||
      APPLICATION_UPLOADED_RESUME_PATH_PATTERN.test(path) ||
      APPLICATION_COVER_LETTER_PATH_PATTERN.test(path) ||
      APPLICATION_PREPARATION_PATH_PATTERN.test(path))
  ) {
    return { acceptsBody: false, protected: true };
  }
  if (
    method === "GET" &&
    (APPLICATION_RESUME_FILE_PATH_PATTERN.test(path) ||
      APPLICATION_COVER_LETTER_FILE_PATH_PATTERN.test(path))
  ) {
    return { acceptsBody: false, protected: true, acceptsApplicationResumeFormatQuery: true };
  }
  if (method === "PATCH" && PROFILE_RECORD_PATH_PATTERN.test(path)) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "DELETE" && PROFILE_RECORD_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true, acceptsProfileExpectedVersionQuery: true };
  }
  if (method === "DELETE" && PROFILE_DRAFT_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "POST" && PROFILE_DRAFT_SAVE_PATH_PATTERN.test(path)) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "PUT" && RESTRICTED_ANSWER_PATH_PATTERN.test(path)) {
    return { acceptsBody: true, protected: true, acceptsRestrictedAnswerContextQuery: true };
  }
  if (method === "DELETE" && RESTRICTED_ANSWER_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true, acceptsRestrictedAnswerContextQuery: true };
  }
  if (method === "GET" && (OPERATION_PATH_PATTERN.test(path) || JOB_PATH_PATTERN.test(path))) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "GET" && MATCH_ASSESSMENT_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (
    method === "GET" &&
    (CANDIDATE_DATA_EXPORT_PATH_PATTERN.test(path) ||
      ACCOUNT_DELETION_REQUEST_PATH_PATTERN.test(path))
  ) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "DELETE" && ACCOUNT_DELETION_REQUEST_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "POST" && ACCOUNT_DELETION_CONFIRMATION_PATH_PATTERN.test(path)) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "GET" && MODERATION_REPORT_SUMMARY_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (
    method === "POST" &&
    (JOB_REPORT_PATH_PATTERN.test(path) || MODERATION_RESOLUTION_PATH_PATTERN.test(path))
  ) {
    return { acceptsBody: true, protected: true };
  }
  if (method === "DELETE" && SAVED_JOB_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (method === "DELETE" && RESUME_PATH_PATTERN.test(path)) {
    return { acceptsBody: false, protected: true };
  }
  if (
    d2Routes.privateCapture &&
    method === "POST" &&
    path === "/v1/saved-job-captures" &&
    exactD2RouteKey(routeKey, "POST /v1/saved-job-captures")
  ) {
    return { acceptsBody: true, protected: true };
  }
  if (
    d2Routes.privateCapture &&
    PRIVATE_CAPTURE_PATH_PATTERN.test(path) &&
    ((method === "GET" && exactD2RouteKey(routeKey, "GET /v1/saved-job-captures/{captureId}")) ||
      (method === "DELETE" &&
        exactD2RouteKey(routeKey, "DELETE /v1/saved-job-captures/{captureId}")))
  ) {
    return { acceptsBody: false, protected: true };
  }
  if (
    d2Routes.contributionPolicy &&
    method === "GET" &&
    path === "/v1/extension/contribution-capability-policy" &&
    exactD2RouteKey(routeKey, "GET /v1/extension/contribution-capability-policy")
  ) {
    return { acceptsBody: false, protected: false };
  }
  if (d2Routes.candidateContribution) {
    if (
      method === "GET" &&
      path === "/v1/jobs/contributions" &&
      exactD2RouteKey(routeKey, "GET /v1/jobs/contributions")
    ) {
      return { acceptsBody: false, protected: true };
    }
    if (
      method === "POST" &&
      CONTRIBUTION_CANCEL_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/jobs/contributions/{contributionId}/cancel")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      path === "/v1/jobs/contributions" &&
      exactD2RouteKey(routeKey, "POST /v1/jobs/contributions")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      path === "/v1/profile/ugc-contribution-consents" &&
      exactD2RouteKey(routeKey, "POST /v1/profile/ugc-contribution-consents")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      CONSENT_REVOKE_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/profile/ugc-contribution-consents/{consentId}/revoke")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "GET" &&
      CONTRIBUTION_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "GET /v1/jobs/contributions/{contributionId}")
    ) {
      return { acceptsBody: false, protected: true };
    }
    if (
      method === "GET" &&
      OWNER_TRUST_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "GET /v1/trust/contributions/{contributionId}")
    ) {
      return { acceptsBody: false, protected: true };
    }
    if (
      method === "POST" &&
      OWNER_TRUST_WITHDRAW_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/trust/contributions/{contributionId}/withdraw")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      OWNER_TRUST_APPEAL_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/trust/contributions/{contributionId}/appeals")
    ) {
      return { acceptsBody: true, protected: true };
    }
  }
  if (d2Routes.trustReviewer) {
    if (
      method === "GET" &&
      path === "/v1/admin/trust/cases" &&
      exactD2RouteKey(routeKey, "GET /v1/admin/trust/cases")
    )
      return { acceptsBody: false, protected: true, acceptsReviewQueueQuery: true };
    if (
      method === "GET" &&
      REVIEWER_TRUST_EVIDENCE_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "GET /v1/admin/trust/cases/{caseId}/evidence")
    )
      return { acceptsBody: false, protected: true };
    if (
      method === "POST" &&
      path === "/v1/admin/trust/cases" &&
      exactD2RouteKey(routeKey, "POST /v1/admin/trust/cases")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "GET" &&
      REVIEWER_TRUST_CASE_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "GET /v1/admin/trust/cases/{caseId}")
    ) {
      return { acceptsBody: false, protected: true };
    }
    if (
      method === "POST" &&
      REVIEWER_TRUST_DECISION_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/admin/trust/cases/{caseId}/decision")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      REVIEWER_TRUST_TAKEDOWN_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/admin/trust/cases/{caseId}/takedown")
    ) {
      return { acceptsBody: true, protected: true };
    }
    if (
      method === "POST" &&
      REVIEWER_TRUST_APPEAL_PATH_PATTERN.test(path) &&
      exactD2RouteKey(routeKey, "POST /v1/admin/trust/cases/{caseId}/appeal-resolution")
    ) {
      return { acceptsBody: true, protected: true };
    }
  }
  return undefined;
}

function boundaryFailure(
  event: APIGatewayProxyEventV2,
  status: number,
  code: string,
  title: string,
): APIGatewayProxyStructuredResultV2 {
  const traceId = event.requestContext.requestId;
  return {
    statusCode: status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      "x-correlation-id": traceId,
    },
    body: JSON.stringify({
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId,
    }),
  };
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function decodeBase64(value: string): Buffer | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  return Buffer.from(value, "base64");
}

function requestPayload(
  event: APIGatewayProxyEventV2,
  route: AllowedRoute,
): { failure?: APIGatewayProxyStructuredResultV2; payload?: string } {
  if (
    (route.acceptsApplicationGenerationQuery || route.acceptsProfileExpectedVersionQuery) &&
    !event.rawQueryString
  ) {
    return { failure: boundaryFailure(event, 400, "invalid_request", "Invalid request") };
  }
  if (
    event.rawQueryString &&
    !(
      (route.acceptsReviewQueueQuery && validReviewQueueQuery(event.rawQueryString)) ||
      (route.acceptsApplicationGenerationQuery &&
        validApplicationGenerationQuery(event.rawQueryString)) ||
      (route.acceptsApplicationHistoryQuery &&
        validApplicationHistoryQuery(event.rawQueryString)) ||
      (route.acceptsApplicationResumeFormatQuery &&
        validApplicationResumeFormatQuery(event.rawQueryString)) ||
      (route.acceptsRestrictedAnswerContextQuery &&
        validRestrictedAnswerContextQuery(event.rawQueryString)) ||
      (route.acceptsProfileExpectedVersionQuery &&
        validProfileExpectedVersionQuery(event.rawQueryString)) ||
      (route.acceptsNotificationsQuery && validNotificationsQuery(event.rawQueryString))
    )
  ) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }

  if (event.body === undefined) {
    if (route.acceptsBody) {
      return {
        failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
      };
    }
    return {};
  }

  if (!route.acceptsBody) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }
  if (!isJsonContentType(event.headers?.["content-type"] ?? event.headers?.["Content-Type"])) {
    return {
      failure: boundaryFailure(event, 415, "unsupported_media_type", "Unsupported media type"),
    };
  }

  const body = event.isBase64Encoded ? decodeBase64(event.body) : Buffer.from(event.body, "utf8");
  if (!body) {
    return {
      failure: boundaryFailure(event, 400, "invalid_request", "Invalid request"),
    };
  }
  if (body.byteLength > MAXIMUM_GATEWAY_BODY_BYTES) {
    return {
      failure: boundaryFailure(event, 413, "payload_too_large", "Payload too large"),
    };
  }
  return { payload: body.toString("utf8") };
}

function validReviewQueueQuery(raw: string): boolean {
  if (raw.length > 512) return false;
  const seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === "state" && ["needs_review", "appeal_pending"].includes(value)) continue;
    if (key === "pageSize" && /^(?:[1-9]|1[0-9]|2[0-5])$/u.test(value)) continue;
    if (key === "cursor" && /^[A-Za-z0-9_-]{1,400}$/u.test(value)) continue;
    return false;
  }
  return seen.size > 0;
}

/** The inbox list takes only a known state, a bounded page size and an opaque cursor, each once. */
function validNotificationsQuery(raw: string): boolean {
  if (raw.length > 400) return false;
  const seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === "state" && ["open", "unread", "dismissed", "expired"].includes(value)) continue;
    if (key === "limit" && /^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) continue;
    if (key === "cursor" && /^[A-Za-z0-9_-]{1,300}$/u.test(value)) continue;
    return false;
  }
  return seen.size > 0;
}

/** Only bounded, unique `afterSeq` and `limit` integers are forwarded to the history route. */
function validApplicationHistoryQuery(raw: string): boolean {
  if (raw.length > 64) return false;
  const seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === "afterSeq" && /^\d{1,9}$/u.test(value)) continue;
    if (key === "limit" && /^(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|200)$/u.test(value)) continue;
    return false;
  }
  return seen.size > 0;
}

function validApplicationGenerationQuery(raw: string): boolean {
  if (raw.length > 256) return false;
  const parameters = [...new URLSearchParams(raw)];
  const only = parameters[0];
  return (
    parameters.length === 1 &&
    only?.[0] === "generationId" &&
    APPLICATION_GENERATION_ID_PATTERN.test(only[1])
  );
}

/** The resume file route takes exactly one `format` parameter, `docx` or `pdf`, and nothing else. */
function validApplicationResumeFormatQuery(raw: string): boolean {
  const parameters = [...new URLSearchParams(raw)];
  const only = parameters[0];
  return (
    parameters.length === 1 && only?.[0] === "format" && (only[1] === "docx" || only[1] === "pdf")
  );
}

function validRestrictedAnswerContextQuery(raw: string): boolean {
  const parameters = [...new URLSearchParams(raw)];
  const only = parameters[0];
  return (
    parameters.length === 1 &&
    only?.[0] === "context" &&
    typeof only[1] === "string" &&
    only[1].length >= 1 &&
    only[1].length <= 120
  );
}

function validProfileExpectedVersionQuery(raw: string): boolean {
  const parameters = [...new URLSearchParams(raw)];
  const only = parameters[0];
  return (
    parameters.length === 1 &&
    only?.[0] === "expectedVersion" &&
    /^[1-9][0-9]{0,8}$/.test(only[1] ?? "")
  );
}

function claimStrings(value: JwtClaimValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") {
    return [];
  }

  // API Gateway's JWT context normally preserves a scalar audience. Some providers issue a
  // multi-audience claim that API Gateway represents as a JSON-encoded string. Normalize only a
  // valid string array; never split arbitrary text or weaken exact audience matching.
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed;
      }
    } catch {
      // Treat malformed serialized data as one non-matching scalar and fail closed below.
    }
  }
  return [value];
}

function bearerTokenClaims(
  event: AuthorizedHttpApiEvent,
): Record<string, JwtClaimValue> | undefined {
  const authorization = Object.entries(event.headers ?? {}).find(
    ([name, value]) => name.toLowerCase() === "authorization" && typeof value === "string",
  )?.[1];
  if (typeof authorization !== "string" || authorization.length > MAXIMUM_BEARER_TOKEN_BYTES) {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match?.[2]) {
    return undefined;
  }

  try {
    const decoded: unknown = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return undefined;
    }
    return decoded as Record<string, JwtClaimValue>;
  } catch {
    return undefined;
  }
}

function audienceEncoding(
  value: JwtClaimValue,
): AuthenticationContextDiagnostic["audienceEncoding"] {
  if (value === undefined) {
    return "absent";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value !== "string") {
    return "unsupported";
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return "json_array";
      }
    } catch {
      // The invalid value remains a scalar for privacy-safe diagnostics and fails exact matching.
    }
  }
  return "scalar";
}

function authorizerPrincipal(
  event: AuthorizedHttpApiEvent,
  issuer: string,
  audience: string,
  onAuthenticationFailure?: (diagnostic: AuthenticationContextDiagnostic) => void,
): AuthPrincipal {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const subject = typeof claims?.sub === "string" ? claims.sub : undefined;
  const tokenIssuer = typeof claims?.iss === "string" ? claims.iss : undefined;
  const contextAudiences = claimStrings(claims?.aud);
  const contextAudienceMatches = contextAudiences.includes(audience);
  const originalClaims = contextAudienceMatches ? undefined : bearerTokenClaims(event);
  const originalSubject = typeof originalClaims?.sub === "string" ? originalClaims.sub : undefined;
  const originalIssuer = typeof originalClaims?.iss === "string" ? originalClaims.iss : undefined;
  const originalAudiences = claimStrings(originalClaims?.aud);
  // API Gateway has already verified the bearer token's signature, algorithm, time claims,
  // issuer, and audience before creating this authorizer context. Its string-only claims map can
  // flatten a standards-compliant multi-valued `aud` claim. In that one case, recover the exact
  // array from the same bearer token and bind it back to the trusted context through issuer and
  // subject equality. The caller token is never forwarded into the application.
  const originalAudienceMatches =
    Boolean(claims?.aud) &&
    originalIssuer === tokenIssuer &&
    originalSubject === subject &&
    originalAudiences.includes(audience);
  const audiences = contextAudienceMatches ? contextAudiences : originalAudiences;
  const validatedScopes = event.requestContext.authorizer?.jwt?.scopes;
  const scopes = Array.isArray(validatedScopes)
    ? validatedScopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  if (
    !claims ||
    !subject ||
    tokenIssuer !== issuer ||
    (!contextAudienceMatches && !originalAudienceMatches)
  ) {
    onAuthenticationFailure?.({
      claimsPresent: Boolean(claims),
      subjectPresent: Boolean(subject),
      issuerMatches: tokenIssuer === issuer,
      audienceMatches: contextAudienceMatches || originalAudienceMatches,
      audienceEncoding: audienceEncoding(claims?.aud),
    });
    throw new AuthenticationError("Validated API Gateway identity context is required");
  }

  return {
    issuer: tokenIssuer,
    subject,
    audience: audiences,
    scopes,
    ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    ...(typeof claims.sid === "string" ? { sessionId: claims.sid } : {}),
  };
}

/**
 * Bridges the principal already validated by API Gateway into the normal HTTP authentication
 * boundary without forwarding the caller's bearer token into the application. Tokens are random,
 * invocation-scoped capabilities held only in Lambda memory and removed after dispatch.
 */
export function createInvocationPrincipalBridge(): InvocationPrincipalBridge {
  const principals = new Map<string, AuthPrincipal>();
  const verifier: AccessTokenVerifier = {
    async verify(accessToken): Promise<AuthPrincipal> {
      const principal = principals.get(accessToken);
      if (!principal) {
        throw new AuthenticationError("Validated API Gateway identity context is required");
      }
      return principal;
    },
  };

  return {
    verifier,
    async run<T>(
      principal: AuthPrincipal,
      dispatch: (internalAccessToken: string) => Promise<T>,
    ): Promise<T> {
      let internalAccessToken: string;
      do {
        internalAccessToken = randomBytes(32).toString("base64url");
      } while (principals.has(internalAccessToken));

      principals.set(internalAccessToken, principal);
      try {
        return await dispatch(internalAccessToken);
      } finally {
        principals.delete(internalAccessToken);
      }
    },
  };
}

function requestHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (typeof value === "string") {
      headers[name.toLowerCase()] = value;
    }
  }
  if (event.cookies?.length) {
    headers.cookie = event.cookies.join("; ");
  }
  return headers;
}

function responseHeaders(headers: Record<string, string | string[] | number | undefined>): {
  headers: Record<string, string>;
  cookies?: string[];
} {
  const result: Record<string, string> = {};
  let cookies: string[] | undefined;
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (rawValue === undefined || HOP_BY_HOP_HEADERS.has(name)) {
      continue;
    }
    if (name === "set-cookie") {
      cookies = Array.isArray(rawValue) ? rawValue.map(String) : [String(rawValue)];
      continue;
    }
    result[name] = Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue);
  }
  return cookies ? { headers: result, cookies } : { headers: result };
}

function authenticationFailure(event: APIGatewayProxyEventV2): APIGatewayProxyStructuredResultV2 {
  return boundaryFailure(event, 401, "authentication_required", "Authentication required");
}

export function createApiGatewayHandler(options: ApiGatewayHandlerOptions): ApiGatewayHandler {
  const d2Routes = Object.freeze({ ...disabledD2GatewayRoutes, ...options.d2Routes });
  return async (event) => {
    const path = event.rawPath || "/";
    const method = event.requestContext.http.method.toUpperCase();
    const routeKey =
      event.routeKey === event.requestContext.routeKey ? event.routeKey : "mismatched-route-key";
    const route = allowedRoute(method, path, routeKey, d2Routes);
    if (!route) {
      return boundaryFailure(event, 404, "not_found", "Not found");
    }

    const decodedRequest = requestPayload(event, route);
    if (decodedRequest.failure) {
      return decodedRequest.failure;
    }

    let principal: AuthPrincipal | undefined;
    if (route.protected) {
      try {
        principal = authorizerPrincipal(
          event,
          options.issuer,
          options.audience,
          options.onAuthenticationFailure,
        );
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return authenticationFailure(event);
        }
        throw error;
      }
    }

    const app = await options.app;
    const inject = (internalAccessToken?: string) => {
      const headers = requestHeaders(event);
      const nativeAccessToken =
        internalAccessToken &&
        method === "POST" &&
        (APPLICATION_NATIVE_AVAILABILITY_PATH_PATTERN.test(path) ||
          APPLICATION_DISPATCH_PATH_PATTERN.test(path))
          ? bearerToken(headers.authorization)
          : undefined;
      headers["x-correlation-id"] ??= event.requestContext.requestId;
      if (internalAccessToken) {
        headers.authorization = `Bearer ${internalAccessToken}`;
      }
      const dispatch = () =>
        app.inject({
          method,
          url:
            (route.acceptsReviewQueueQuery ||
              route.acceptsApplicationHistoryQuery ||
              route.acceptsApplicationGenerationQuery ||
              route.acceptsApplicationResumeFormatQuery ||
              route.acceptsRestrictedAnswerContextQuery ||
              route.acceptsProfileExpectedVersionQuery ||
              route.acceptsNotificationsQuery) &&
            event.rawQueryString
              ? `${path}?${event.rawQueryString}`
              : path,
          headers,
          ...(decodedRequest.payload !== undefined ? { payload: decodedRequest.payload } : {}),
        });
      return nativeAccessToken && internalAccessToken
        ? withNativeMaterialInvocationCredential(
            internalAccessToken,
            path.split("/")[3] ?? "",
            nativeAccessToken,
            dispatch,
          )
        : dispatch();
    };
    const response = principal
      ? await options.principalBridge.run(principal, inject)
      : await inject();
    const mappedHeaders = responseHeaders(response.headers);
    return {
      statusCode: response.statusCode,
      headers: mappedHeaders.headers,
      ...(mappedHeaders.cookies ? { cookies: mappedHeaders.cookies } : {}),
      body: response.body,
      isBase64Encoded: false,
    };
  };
}

interface D2LambdaComposition {
  configuration: D2LambdaGatewayConfiguration;
  contributionCapability?: ContributionCapabilitySource;
  contributionCapabilityPolicy?: ContributionCapabilityPolicySource;
  trustConfiguration?: D2LambdaGatewayConfiguration["trust"];
  routes: Readonly<D2GatewayRouteGates>;
}

export function loadD2LambdaComposition(
  config: LambdaGatewayConfig,
  environment: NodeJS.ProcessEnv = process.env,
): D2LambdaComposition {
  const configuration = loadD2LambdaGatewayConfigSafely(environment);
  let contributionCapability: ContributionCapabilitySource | undefined;
  if (configuration.valid) {
    try {
      contributionCapability =
        contributionCapabilitySourceFromEnvironment(environment, () => new Date()) ?? undefined;
    } catch {
      contributionCapability = undefined;
    }
  }
  let contributionCapabilityPolicy: ContributionCapabilityPolicySource | undefined;
  if (
    !configuration.developmentContributionsEnabled &&
    configuration.signedContributionPolicyConfigured
  ) {
    try {
      contributionCapabilityPolicy =
        contributionCapabilityPolicySourceFromEnvironment(environment, () => new Date()) ??
        undefined;
    } catch {
      contributionCapabilityPolicy = undefined;
    }
  }
  const trustConfiguration = configuration.trust?.reviewerAssignments.every(
    (assignment) => assignment.issuer === config.OIDC_ISSUER,
  )
    ? configuration.trust
    : undefined;
  const routes = Object.freeze({
    privateCapture: configuration.privateCaptureRoutesEnabled,
    contributionPolicy:
      configuration.contributionPolicyRouteEnabled && Boolean(contributionCapabilityPolicy),
    candidateContribution:
      configuration.contributionRoutesEnabled &&
      Boolean(contributionCapability) &&
      Boolean(trustConfiguration),
    trustReviewer: configuration.trustReviewerRoutesEnabled && Boolean(trustConfiguration),
  });
  return Object.freeze({
    configuration,
    ...(contributionCapability ? { contributionCapability } : {}),
    ...(contributionCapabilityPolicy ? { contributionCapabilityPolicy } : {}),
    ...(trustConfiguration ? { trustConfiguration } : {}),
    routes,
  });
}

async function createConfiguredApplication(
  principalBridge: InvocationPrincipalBridge,
  config: LambdaGatewayConfig,
  d2: D2LambdaComposition,
): Promise<NestFastifyApplication> {
  initializeTelemetry({
    service: "gateway",
    environment: config.NODE_ENV,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
    sampleRatio: config.OTEL_TRACE_SAMPLE_RATIO,
    releaseSha: config.RELEASE_SHA,
  });
  const logger = createLogger({
    service: "gateway",
    level: config.LOG_LEVEL,
    releaseSha: config.RELEASE_SHA,
  });
  const databaseUrl = await resolveLambdaDatabaseUrl(config, {
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  });
  const database = createDatabase(databaseUrl, { maxConnections: 2 });
  const candidateRightsPolicy = loadCandidateRightsPolicyIfConfigured(process.env);
  const idTokenAudience = config.OIDC_ID_TOKEN_AUDIENCE;
  if (candidateRightsPolicy && !idTokenAudience) {
    throw new Error("CandidateRightsIdTokenVerifierConfigurationInvalid");
  }
  const idTokenVerifier =
    candidateRightsPolicy && idTokenAudience
      ? createOidcIdTokenVerifier({
          issuer: config.OIDC_ISSUER,
          audience: idTokenAudience,
        })
      : undefined;
  const recoveryBucket = process.env.CANDIDATE_DELETION_RECOVERY_BUCKET;
  const recoveryKmsKeyArn = process.env.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN;
  if (candidateRightsPolicy && (!recoveryBucket || !recoveryKmsKeyArn)) {
    throw new Error("CandidateDeletionConfirmationJournalConfigurationInvalid");
  }
  const store = new PostgresProfileStore(database, {
    dispatchTarget: config.OUTBOX_DISPATCH_TARGET,
    ...(config.OUTBOX_QUEUE_URL
      ? { nudgePublisher: new SqsOutboxNudgePublisher(config.OUTBOX_QUEUE_URL) }
      : {}),
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
  // The cipher is optional: listing and deleting a restricted answer never need it, and saving or
  // reading its value fails closed with a clean 503 (RestrictedAnswerVaultConfigurationError)
  // rather than a silent no-op when no key is configured yet.
  const profileSections = createProfileSectionStore(database.client);
  const restrictedAnswerVaultKmsKeyArn = process.env.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN;
  const restrictedAnswerVault = new PostgresRestrictedAnswerVaultStore(
    database.client,
    restrictedAnswerVaultKmsKeyArn
      ? new KmsRestrictedAnswerCipher(restrictedAnswerVaultKmsKeyArn)
      : undefined,
  );
  const catalog = new PostgresJobCatalog(database.client, {
    searchCursorKeys: deriveJobSearchCursorKeys(databaseUrl),
  });
  const jobReports = new JobReportingService(new PostgresJobReportStore(database.client));
  const ugcContributionConsents = new PostgresUgcContributionConsentStore(database.client);
  const ugcContributionPolicyVersion = configuredUgcContributionPolicyVersion(
    d2.configuration.ugcContributionPolicyVersion,
  );
  const jobContributions = new JobContributionService(
    new PostgresJobContributionStore(database.client),
    new ProfileJobContributionConsentVerifier(
      ugcContributionConsents,
      ugcContributionPolicyVersion,
    ),
    d2.contributionCapability,
    undefined,
    new ProfileJobContributionConsentRevoker(ugcContributionConsents),
  );
  const moderation = new JobModerationService(
    new PostgresJobModerationStore(database.client, deriveModerationCursorKey(databaseUrl)),
  );
  const savedJobs = new SavedJobsService(
    new PostgresSavedJobStore(database.client),
    new JobCatalogSavedJobResolver(catalog),
    deriveSavedJobCursorKeys(databaseUrl),
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
  const candidateDataExportDownloads =
    candidateRightsPolicy && process.env.CANDIDATE_DATA_EXPORT_BUCKET
      ? new S3CandidateDataExportDownloadSigner(
          process.env.CANDIDATE_DATA_EXPORT_BUCKET,
          candidateRightsPolicy.downloadGrantLifetimeSeconds,
        )
      : undefined;
  const trust = d2.trustConfiguration
    ? createConfiguredD2TrustRuntime(database.client, d2.trustConfiguration)
    : undefined;
  // Applications needs its own plain client: the shared one camel-cases columns and installs
  // Drizzle's JSON and timestamp handling, which makes the store fail (see applications-database).
  const privilegedModerationAudit =
    process.env.PRIVILEGED_MODERATION_AUDIT_ENABLED === "true"
      ? createPrivilegedModerationAuditRuntime(
          databaseUrl,
          () => process.env.PRIVILEGED_MODERATION_AUDIT_ENABLED === "true",
        )
      : undefined;
  const packetProtection = restrictedPacketWriterFromEnvironment(process.env);
  const legacyReceipts = legacyReceiptReplayFromEnvironment(
    process.env,
    () => packetProtection?.enabled() === true,
  );
  const nativeMaterialLocations = nativeMaterialLocationsFromEnvironment(
    databaseUrl,
    process.env,
    () => packetProtection?.enabled() === true,
  );
  const nativeResumeLocations = nativeResumeLocationsFromEnvironment(
    databaseUrl,
    process.env,
    () => packetProtection?.enabled() === true,
  );
  const nativeMaterialDisposal = nativeMaterialDisposalFromEnvironment(databaseUrl, process.env);
  const applications = createApplicationsRuntime({
    client: createApplicationsDatabase(databaseUrl, { maxConnections: 2 }),
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
      readCurrentReference: restrictedAnswerVault.readCurrentReference.bind(restrictedAnswerVault),
    }),
    // The Documents runtime tailors the candidate's resume; the Gateway never reads resume text.
    ...(process.env.DOCUMENT_TAILORING_FUNCTION_ARN
      ? {
          tailoring: new LambdaResumeTailoringClient(process.env.DOCUMENT_TAILORING_FUNCTION_ARN),
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
  });
  return createGatewayApplication({
    store,
    restrictedAnswerVault,
    profileSections,
    catalog,
    jobReports,
    jobContributions,
    ...(d2.contributionCapabilityPolicy
      ? { contributionCapabilityPolicy: d2.contributionCapabilityPolicy }
      : {}),
    ugcContributionConsents,
    ...(ugcContributionPolicyVersion ? { ugcContributionPolicyVersion } : {}),
    moderation,
    ...(privilegedModerationAudit
      ? { privilegedModerationAudit: privilegedModerationAudit.writer }
      : {}),
    savedJobs,
    applications,
    ...(nativeMaterialDisposal
      ? { nativeMaterialWithdrawals: nativeMaterialDisposal.ownerRequests }
      : {}),
    privateSavedPageCaptures,
    matchAssessments,
    entitlements,
    ...(stripeBilling ? { stripeBilling } : {}),
    ...(notifications ? { notifications } : {}),
    documents,
    ...(trust ? { trust: trust.service, trustReviewerAssignments: trust.reviewerAssignments } : {}),
    ...(candidateDataExportDownloads ? { candidateDataExportDownloads } : {}),
    verifier: principalBridge.verifier,
    ...(idTokenVerifier ? { idTokenVerifier } : {}),
    releaseSha: config.RELEASE_SHA,
    adapter: new FastifyAdapter({
      bodyLimit: MAXIMUM_GATEWAY_BODY_BYTES,
      loggerInstance: logger,
    }),
  });
}

let configuredHandler: ApiGatewayHandler | undefined;

export const handler: Handler<AuthorizedHttpApiEvent, APIGatewayProxyStructuredResultV2> = async (
  event,
) => {
  if (!configuredHandler) {
    const config = loadLambdaGatewayConfig();
    const d2 = loadD2LambdaComposition(config);
    const principalBridge = createInvocationPrincipalBridge();
    const boundaryLogger = createLogger({
      service: "gateway",
      level: config.LOG_LEVEL,
      releaseSha: config.RELEASE_SHA,
    });
    configuredHandler = createApiGatewayHandler({
      app: createConfiguredApplication(principalBridge, config, d2),
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
      principalBridge,
      d2Routes: d2.routes,
      onAuthenticationFailure: (diagnostic) => {
        boundaryLogger.warn(
          { event: "api_gateway_identity_context_rejected", ...diagnostic },
          "API Gateway identity context failed the Lambda defense-in-depth check",
        );
      },
    });
  }
  return configuredHandler(event);
};
