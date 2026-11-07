import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ApplicationNotFoundError,
  ApplicationRevisionConflictError,
  type ApplicationsApi,
  ApplicationsUnavailableError,
  ApprovalRefusedError,
  AttemptRefusedError,
  NarrativeAnswerLimitError,
  NarrativeAnswersUnavailableError,
  NarrativeAnswerStateError,
  PreparationNotFoundError,
  RestrictedPacketStoreUnavailableError,
  StalePacketError,
  UploadedResumeTooLargeError,
} from "@ai-job-apply/applications-service";
import type { PrivilegedModerationAuditWriter } from "@ai-job-apply/profile-service/privileged-moderation-audit";
import "reflect-metadata";
import { createHash } from "node:crypto";
import type {
  AccountDeletionRequest,
  CandidateDataExport,
  CreatePrivateSavedPageCaptureRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CurrentUser,
  JobContribution,
  JobPreferenceSet,
  JobReport,
  MatchAssessment,
  Operation,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ResumeDocument,
  ResumeDocumentCollection,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  SignedContributionCapabilityPolicy,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { AuthenticationError, type AuthPrincipal, type IdTokenVerifier } from "@ai-job-apply/auth";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import {
  BillingEntitlementService,
  type BillingEntitlementStore,
  EntitlementCache,
  type EntitlementEvaluation,
  type EntitlementReadService,
  type EntitlementSchedule,
  EntitlementUnavailableError,
} from "@ai-job-apply/billing-service";
import {
  type DocumentStore,
  ResumeDocumentLimitError,
  ResumeNotDeletableError,
  ResumeUploadInProgressError,
  ResumeUploadRegistrationError,
} from "@ai-job-apply/documents-service";
import {
  type ActiveJobRecord,
  type ActiveJobSearchInput,
  type ContributionCapabilityPolicySource,
  ContributionCapabilityPolicySourceUnavailableError,
  type CreateJobContributionCommand,
  type CreateJobReportCommand,
  type ModerationCase as DomainModerationCase,
  JobAlreadyReportedError,
  type JobCatalogReader,
  type JobContributions,
  JobContributionUnavailableError,
  type JobModeration,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  JobReportServiceUnavailableError,
  type JobReports,
  JobReportTargetUnavailableError,
  JobSearchCatalogChangedError,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
  PostgresJobCatalog,
} from "@ai-job-apply/jobs-service";
import {
  type CreatePrivateSavedPageCaptureCommand,
  MatchAssessmentServiceUnavailableError,
  type MatchAssessments,
  MatchAssessmentTargetUnavailableError,
  MatchAssessmentUnavailableError,
  MatchPreferencesRequiredError,
  type PrivateSavedPageCapture,
  type PrivateSavedPageCaptures,
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
  type SavedJobs,
} from "@ai-job-apply/matching-service";
import { NotificationsError } from "@ai-job-apply/notifications-service";
import type {
  ProfileSectionStore,
  ProfileStore,
  RestrictedAnswerVaultStore,
  UgcContributionConsent,
  UgcContributionConsentStore,
} from "@ai-job-apply/profile-service";
import {
  AccountQuarantinedError,
  ProfileSectionDuplicateError,
  ProfileSectionLimitError,
  ProfileSectionNotFoundError,
  ProfileSectionRestrictedQuestionError,
  ProfileSectionVersionConflictError,
  RestrictedAnswerVaultConflictError,
  UgcContributionConsentConflictError,
} from "@ai-job-apply/profile-service";
import {
  assertCandidateRightsAuthentication,
  type CandidateRightsPolicy,
} from "@ai-job-apply/profile-service/candidate-rights";
import {
  TrustApplicationError,
  type TrustApplicationService,
  type TrustCase,
} from "@ai-job-apply/trust-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type NotificationsApi, privacySafeRequestFailure } from "./app.module.js";
import { createGatewayApplication } from "./application.js";
import { createApplicationsRuntime, loadFieldDefinitions } from "./applications-runtime.js";
import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
} from "./lambda.js";
import { createStripeBillingGateway, type StripeBillingGateway } from "./stripe-billing.js";
import type { TrustReviewerAssignment } from "./trust-reviewer-authority.js";

const FRESH_ID_TOKEN_PROOF = "fresh-header-segment.fresh-payload-segment.fresh-signature-segment";
const RECENT_PASSWORD_ID_TOKEN_PROOF =
  "password-header-segment.password-payload-segment.password-signature-segment";
const STALE_ID_TOKEN_PROOF = "stale-header-segment.stale-payload-segment.stale-signature-segment";
const FUTURE_ID_TOKEN_PROOF =
  "future-header-segment.future-payload-segment.future-signature-segment";
const MISMATCHED_ID_TOKEN_PROOF =
  "mismatch-header-segment.mismatch-payload-segment.mismatch-signature-segment";
const VERIFIED_EMAIL_ID_TOKEN_PROOF =
  "verified-header-segment.verified-payload-segment.verified-signature-segment";
const UNVERIFIED_EMAIL_ID_TOKEN_PROOF =
  "unverified-header-segment.unverified-payload-segment.unverified-signature-segment";

class MemoryProfileStore implements ProfileStore {
  resolveUserCalls = 0;
  retiredResumeProposals: Array<{ userId: string; documentId: string }> = [];
  retireFailure: Error | undefined;
  candidateRightsPrincipals: AuthPrincipal[] = [];
  private readonly users = new Map<string, CurrentUser>();
  private preferences: JobPreferenceSet | undefined;
  private readonly operations = new Map<string, Operation>();
  private readonly idempotency = new Map<
    string,
    { hash: string; response: PutJobPreferencesResponse }
  >();
  private readonly candidateRightsNow = new Date("2026-08-16T12:00:00.000Z");
  private readonly candidateRightsPolicy: CandidateRightsPolicy = {
    version: "d1-test-v1",
    accountablePolicySha256: "a".repeat(64),
    exportArtifactLifetimeSeconds: 3_600,
    downloadGrantLifetimeSeconds: 300,
    backupRetentionDays: 35,
    recentAuthenticationMaxAgeSeconds: 900,
    ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing"],
    subprocessorInventory: [],
  };

  private assertCandidateRights(principal: AuthPrincipal, requireMfa: boolean): void {
    assertCandidateRightsAuthentication(
      principal,
      this.candidateRightsNow,
      this.candidateRightsPolicy,
      requireMfa,
    );
    this.candidateRightsPrincipals.push(principal);
  }

  async createCandidateDataExport(principal: AuthPrincipal): Promise<CandidateDataExport> {
    this.assertCandidateRights(principal, false);
    const timestamp = this.candidateRightsNow.toISOString();
    return {
      id: uuidv7(),
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      policyVersion: this.candidateRightsPolicy.version,
      state: "queued",
      requestedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async createAccountDeletionRequest(principal: AuthPrincipal): Promise<AccountDeletionRequest> {
    this.assertCandidateRights(principal, false);
    const timestamp = this.candidateRightsNow.toISOString();
    return {
      id: uuidv7(),
      schemaVersion: 1,
      policyVersion: this.candidateRightsPolicy.version,
      state: "requested",
      version: 1,
      requestedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async cancelAccountDeletionRequest(principal: AuthPrincipal): Promise<boolean> {
    this.assertCandidateRights(principal, false);
    return true;
  }

  async confirmAccountDeletionRequest(principal: AuthPrincipal): Promise<AccountDeletionRequest> {
    this.assertCandidateRights(principal, true);
    const timestamp = this.candidateRightsNow.toISOString();
    return {
      id: uuidv7(),
      schemaVersion: 1,
      policyVersion: this.candidateRightsPolicy.version,
      state: "quarantined",
      version: 2,
      requestedAt: timestamp,
      updatedAt: timestamp,
      confirmedAt: timestamp,
      backupExpiresAt: "2026-09-20T12:00:00.000Z",
    };
  }

  async retireResumeProposals(
    userId: string,
    documentId: string,
  ): Promise<{ proposalsErased: number }> {
    if (this.retireFailure) throw this.retireFailure;
    this.retiredResumeProposals.push({ userId, documentId });
    return { proposalsErased: 0 };
  }

  async resolveUser(principal: AuthPrincipal): Promise<CurrentUser> {
    this.resolveUserCalls += 1;
    const key = `${principal.issuer}\0${principal.subject}`;
    const existing = this.users.get(key);
    if (existing) return existing;
    const user = { id: uuidv7(), ...(principal.email ? { email: principal.email } : {}) };
    this.users.set(key, user);
    return user;
  }

  async getPreferences(): Promise<JobPreferenceSet | null> {
    return this.preferences ?? null;
  }

  async putPreferences(
    _userId: string,
    input: PutJobPreferencesRequest,
    idempotencyKey: string,
  ): Promise<PutJobPreferencesResponse> {
    const hash = JSON.stringify(input);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.hash !== hash) {
        const { IdempotencyConflictError } = await import("@ai-job-apply/profile-service");
        throw new IdempotencyConflictError();
      }
      return existing.response;
    }
    this.preferences = {
      id: this.preferences?.id ?? uuidv7(),
      version: (this.preferences?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      ...input,
    };
    const operationId = uuidv7();
    this.operations.set(operationId, {
      id: operationId,
      kind: "profile_readiness",
      state: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const response = { preferences: this.preferences, operationId };
    this.idempotency.set(idempotencyKey, { hash, response });
    return response;
  }

  async getOperation(_userId: string, operationId: string): Promise<Operation | null> {
    return this.operations.get(operationId) ?? null;
  }

  async getPreferencesById(): Promise<JobPreferenceSet | null> {
    return this.preferences ?? null;
  }
  async markOperationRunning(): Promise<void> {}
  async completeReadinessOperation(
    _operationId: string,
    _preferenceSetId: string,
    _readiness: ProfileReadiness,
  ): Promise<void> {}
  async failReadinessOperation(): Promise<void> {}
  async failDurableReadinessOperation(): Promise<void> {}
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

class MemoryJobCatalog implements JobCatalogReader {
  lastSearchInput: ActiveJobSearchInput | undefined;
  catalogChanged = false;
  searchFailure: Error | undefined;
  readonly job: ActiveJobRecord = {
    id: uuidv7(),
    company: {
      id: uuidv7(),
      name: "Synthetic Company",
      verifiedDomain: "example.test",
    },
    title: "Software Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    description: "A synthetic active job used for gateway verification.",
    status: "active",
    firstObservedAt: new Date("2026-08-11T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-08-11T12:00:00.000Z"),
    expiresAt: new Date("2026-09-10T12:00:00.000Z"),
    sources: [
      {
        provider: "greenhouse",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.example.test/synthetic/1",
        firstObservedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastVerifiedAt: new Date("2026-08-11T12:00:00.000Z"),
      },
    ],
  };

  async getActiveJob(jobId: string): Promise<ActiveJobRecord | null> {
    return jobId === this.job.id ? this.job : null;
  }

  async getCatalogRevision(): Promise<string> {
    return "1";
  }

  async getMatchableJob(jobId: string) {
    return jobId === this.job.id
      ? {
          requestedJobId: jobId,
          job: {
            id: this.job.id,
            catalogRevision: "1",
            eligibleThrough: this.job.expiresAt.toISOString(),
            title: this.job.title,
            locations: [...this.job.locations],
            workMode: "remote" as const,
            employmentType: "full_time" as const,
          },
        }
      : null;
  }

  async resolveActiveJobSummaries(jobIds: readonly string[]) {
    return {
      catalogRevision: "1",
      items: jobIds.includes(this.job.id)
        ? [
            {
              requestedJobId: this.job.id,
              job: {
                id: this.job.id,
                company: this.job.company,
                title: this.job.title,
                locations: this.job.locations,
                ...(this.job.department ? { department: this.job.department } : {}),
                status: "active" as const,
                firstObservedAt: this.job.firstObservedAt,
                lastVerifiedAt: this.job.lastVerifiedAt,
                expiresAt: this.job.expiresAt,
              },
            },
          ]
        : [],
    };
  }

  async searchActiveJobs(input: ActiveJobSearchInput) {
    this.lastSearchInput = input;
    if (this.searchFailure) {
      throw this.searchFailure;
    }
    if (this.catalogChanged) {
      throw new JobSearchCatalogChangedError();
    }
    return {
      items: [
        {
          id: this.job.id,
          company: this.job.company,
          title: this.job.title,
          locations: this.job.locations,
          ...(this.job.department ? { department: this.job.department } : {}),
          status: "active" as const,
          firstObservedAt: this.job.firstObservedAt,
          lastVerifiedAt: this.job.lastVerifiedAt,
          expiresAt: this.job.expiresAt,
        },
      ],
      ...(input.cursor ? {} : { nextCursor: "opaque_cursor_v1.signature_v1" }),
    };
  }

  async ping(): Promise<void> {}
}

class MemorySavedJobs implements SavedJobs {
  readonly items = new Map<string, SavedJob[]>();
  createFailure: Error | undefined;

  async create(ownerUserId: string, requestedJobId: string): Promise<SavedJob> {
    if (this.createFailure) throw this.createFailure;
    const saved: SavedJob = {
      id: uuidv7(),
      requestedJobId,
      snapshot: {
        jobIdAtSave: requestedJobId,
        company: { id: uuidv7(), name: "Synthetic Company" },
        title: "Software Engineer",
        locations: ["Remote - US"],
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-09-10T12:00:00.000Z",
      },
      availability: { state: "unavailable" },
      savedAt: "2026-08-15T12:00:00.000Z",
    };
    this.items.set(ownerUserId, [saved, ...(this.items.get(ownerUserId) ?? [])]);
    return saved;
  }

  async list(ownerUserId: string, _input: SavedJobSearchRequest): Promise<SavedJobPage> {
    return { items: this.items.get(ownerUserId) ?? [] };
  }

  async delete(ownerUserId: string, savedJobId: string): Promise<void> {
    this.items.set(
      ownerUserId,
      (this.items.get(ownerUserId) ?? []).filter((item) => item.id !== savedJobId),
    );
  }

  async ping(): Promise<void> {}
}

class MemoryPrivateSavedPageCaptures implements PrivateSavedPageCaptures {
  readonly records = new Map<string, PrivateSavedPageCapture>();
  readonly commands = new Map<string, { digest: string; capture: PrivateSavedPageCapture }>();

  async create(command: CreatePrivateSavedPageCaptureCommand): Promise<PrivateSavedPageCapture> {
    const key = `${command.ownerUserId}\0${command.idempotencyKey}`;
    const digest = JSON.stringify(command.input);
    const replay = this.commands.get(key);
    if (replay) {
      if (replay.digest !== digest) {
        const { PrivateCaptureIdempotencyConflictError } = await import(
          "@ai-job-apply/matching-service"
        );
        throw new PrivateCaptureIdempotencyConflictError();
      }
      return replay.capture;
    }
    const capture: PrivateSavedPageCapture = {
      id: command.input.captureId,
      ownerUserId: command.ownerUserId,
      source: command.input.source,
      snapshot: command.input.snapshot,
      capturedAt: command.input.capturedAt,
      savedAt: "2026-08-16T12:00:00.000Z",
    };
    this.records.set(capture.id, capture);
    this.commands.set(key, { capture, digest });
    return capture;
  }

  async get(ownerUserId: string, captureId: string): Promise<PrivateSavedPageCapture | null> {
    const capture = this.records.get(captureId);
    return capture?.ownerUserId === ownerUserId ? capture : null;
  }

  async delete(ownerUserId: string, captureId: string): Promise<void> {
    const capture = this.records.get(captureId);
    if (capture?.ownerUserId === ownerUserId) this.records.delete(captureId);
  }
}

class MemoryJobReports implements JobReports {
  failure: Error | undefined;
  pingFailure: Error | undefined;
  lastCommand?: CreateJobReportCommand;
  malformed: JobReport | undefined;

  async ping(): Promise<void> {
    if (this.pingFailure) throw this.pingFailure;
  }

  async report(command: CreateJobReportCommand): Promise<JobReport> {
    this.lastCommand = command;
    if (this.failure) throw this.failure;
    return (
      this.malformed ?? {
        id: uuidv7(),
        requestedJobId: command.requestedJobId,
        canonicalJobId: command.requestedJobId,
        reason: command.reason,
        createdAt: "2026-08-16T12:00:00.000Z",
      }
    );
  }
}

class MemoryJobContributions implements JobContributions {
  readonly records = new Map<string, { ownerUserId: string; contribution: JobContribution }>();
  readonly keys = new Map<string, { hash: string; contribution: JobContribution }>();
  failure: Error | undefined;

  async ping(): Promise<void> {}

  async cancel(command: {
    ownerUserId: string;
    contributionId: string;
  }): Promise<JobContribution | null> {
    if (this.failure) throw this.failure;
    const record = this.records.get(command.contributionId);
    if (!record || record.ownerUserId !== command.ownerUserId) return null;
    record.contribution = { ...record.contribution, state: "consent_invalid" };
    return record.contribution;
  }

  async contribute(command: CreateJobContributionCommand): Promise<JobContribution> {
    if (this.failure) throw this.failure;
    const key = `${command.ownerUserId}\0${command.idempotencyKey}`;
    const hash = JSON.stringify(command.input);
    const existing = this.keys.get(key);
    if (existing) {
      if (existing.hash !== hash) {
        const { JobContributionIdempotencyConflictError } = await import(
          "@ai-job-apply/jobs-service"
        );
        throw new JobContributionIdempotencyConflictError();
      }
      return existing.contribution;
    }
    const timestamp = "2026-08-16T12:00:00.000Z";
    const contribution: JobContribution = {
      id: uuidv7(),
      state: "queued",
      submittedAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(contribution.id, { ownerUserId: command.ownerUserId, contribution });
    this.keys.set(key, { hash, contribution });
    return contribution;
  }

  async get(ownerUserId: string, contributionId: string): Promise<JobContribution | null> {
    const record = this.records.get(contributionId);
    return record?.ownerUserId === ownerUserId ? record.contribution : null;
  }

  async list(ownerUserId: string): Promise<JobContribution[]> {
    if (this.failure) throw this.failure;
    return [...this.records.values()]
      .filter((record) => record.ownerUserId === ownerUserId)
      .map((record) => record.contribution)
      .sort(
        (left, right) =>
          right.submittedAt.localeCompare(left.submittedAt) || right.id.localeCompare(left.id),
      )
      .slice(0, 25);
  }
}

class MemoryUgcContributionConsents implements UgcContributionConsentStore {
  readonly records = new Map<string, UgcContributionConsent>();
  readonly receipts = new Map<string, { hash: string; response: UgcContributionConsent }>();

  async grant(
    command: Parameters<UgcContributionConsentStore["grant"]>[0],
  ): Promise<UgcContributionConsent> {
    const key = `${command.ownerUserId}\0grant\0${command.idempotencyKey}`;
    const hash = JSON.stringify({
      documentVersion: command.documentVersion,
      ownerUserId: command.ownerUserId,
      policyVersion: command.policyVersion,
      previewPayloadSha256: command.previewPayloadSha256,
    });
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.hash !== hash) throw new UgcContributionConsentConflictError();
      return receipt.response;
    }
    const id = uuidv7();
    const response: UgcContributionConsent = {
      client: "extension",
      documentVersion: command.documentVersion,
      grantedAt: command.grantedAt,
      id,
      ownerUserId: command.ownerUserId,
      policyVersion: command.policyVersion,
      previewPayloadSha256: command.previewPayloadSha256,
      purpose: "ugc_contribution",
      recordedAt: command.grantedAt,
      schemaVersion: 1,
      state: "granted",
    };
    this.records.set(id, response);
    this.receipts.set(key, { hash, response });
    return response;
  }

  async revoke(
    command: Parameters<UgcContributionConsentStore["revoke"]>[0],
  ): Promise<UgcContributionConsent> {
    const current = this.records.get(command.consentId);
    if (!current || current.ownerUserId !== command.ownerUserId || current.state !== "granted") {
      throw new UgcContributionConsentConflictError();
    }
    const revoked = { ...current, recordedAt: command.occurredAt, state: "revoked" as const };
    this.records.set(command.consentId, revoked);
    return revoked;
  }

  async supersede(): Promise<UgcContributionConsent> {
    throw new UgcContributionConsentConflictError();
  }

  async verify(command: Parameters<UgcContributionConsentStore["verify"]>[0]) {
    const current = this.records.get(command.consentId);
    if (!current || current.ownerUserId !== command.ownerUserId) {
      return { reason: "not_found" as const, valid: false as const };
    }
    return { consent: current, valid: true as const };
  }
}

class MemoryModeration implements JobModeration {
  readonly cases: DomainModerationCase[] = [];
  lastOperatorId: string | undefined;

  async ping(): Promise<void> {}
  async openCase(input: Parameters<JobModeration["openCase"]>[0]): Promise<DomainModerationCase> {
    this.lastOperatorId = input.operatorId;
    const created: DomainModerationCase = {
      id: uuidv7(),
      target: input.target,
      status: "open",
      version: 0,
      openedBy: input.operatorId,
      openReasonCode: input.reasonCode,
      openedAt: "2026-08-16T12:00:00.000Z",
    };
    this.cases.unshift(created);
    return created;
  }
  async resolveCase(
    input: Parameters<JobModeration["resolveCase"]>[0],
  ): Promise<DomainModerationCase> {
    this.lastOperatorId = input.operatorId;
    const index = this.cases.findIndex((item) => item.id === input.caseId);
    const current = this.cases[index];
    if (!current) throw new Error("missing synthetic case");
    const resolved: DomainModerationCase = {
      ...current,
      status: "resolved",
      version: 1,
      resolution: input.resolution,
      resolvedBy: input.operatorId,
      resolutionReasonCode: input.reasonCode,
      resolvedAt: "2026-08-16T12:01:00.000Z",
    };
    this.cases[index] = resolved;
    return resolved;
  }
  async summarizeReports(canonicalJobId: string) {
    return {
      canonicalJobId,
      total: 2,
      counts: {
        job_closed: 1,
        job_not_found: 0,
        job_inaccurate: 0,
        suspected_scam: 1,
        duplicate_listing: 0,
        other_catalog_issue: 0,
      },
    };
  }
  async searchCases(input: Parameters<JobModeration["searchCases"]>[0]) {
    return { items: this.cases.filter((item) => item.status === input.status) };
  }
}

class MemoryMatchAssessments implements MatchAssessments {
  readonly calls: Array<{ ownerUserId: string; requestedJobId: string }> = [];
  failure: Error | undefined;

  async assess(ownerUserId: string, requestedJobId: string): Promise<MatchAssessment> {
    this.calls.push({ ownerUserId, requestedJobId });
    if (this.failure) throw this.failure;
    return {
      schemaVersion: 1,
      requestedJobId,
      canonicalJobId: requestedJobId,
      preferenceSetId: uuidv7(),
      preferenceVersion: 1,
      preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
      catalogRevision: "1",
      assessedAt: "2026-08-16T12:00:00.000Z",
      gate: "review_required",
      evidence: [
        { constraint: "work_mode", state: "satisfied", reasonCode: "work_mode_selected" },
        {
          constraint: "employment_type",
          state: "satisfied",
          reasonCode: "employment_type_selected",
        },
        {
          constraint: "target_role",
          state: "satisfied",
          reasonCode: "target_role_exact_overlap",
        },
        { constraint: "location", state: "unknown", reasonCode: "location_not_established" },
        {
          constraint: "compensation",
          state: "unknown",
          reasonCode: "compensation_semantics_unavailable",
        },
        {
          constraint: "authorization_sponsorship",
          state: "unknown",
          reasonCode: "authorization_sponsorship_unavailable",
        },
        {
          constraint: "seniority",
          state: "unknown",
          reasonCode: "seniority_semantics_unavailable",
        },
        {
          constraint: "blocked_company",
          state: "unknown",
          reasonCode: "blocked_company_preferences_unavailable",
        },
        {
          constraint: "qualifications",
          state: "unknown",
          reasonCode: "qualification_evidence_unavailable",
        },
      ],
    };
  }
}

class MemoryEntitlements implements EntitlementReadService {
  readonly calls: Array<{ userId: string; now: Date }> = [];
  readonly evaluations = new Map<string, EntitlementEvaluation>();
  failure: Error | undefined;
  pingFailure: Error | undefined;

  async evaluate(userId: string, now: Date): Promise<EntitlementEvaluation> {
    this.calls.push({ userId, now: new Date(now.getTime()) });
    if (this.failure) throw this.failure;
    return (
      this.evaluations.get(userId) ?? {
        valid: true,
        plan: "free",
        accessState: "active",
        grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
        limits: { maxStoredResumes: 1 },
        version: 0,
        evaluatedAt: now.toISOString(),
      }
    );
  }

  async allows(userId: string, capability: string, now: Date): Promise<boolean> {
    const result = await this.evaluate(userId, now);
    return result.valid && (result.grants as readonly string[]).includes(capability);
  }

  async ping(): Promise<void> {
    if (this.pingFailure) throw this.pingFailure;
  }
}

class SequenceBillingStore implements BillingEntitlementStore {
  readonly schedules = new Map<string, EntitlementSchedule>();
  readonly reads: string[] = [];
  failReads = false;
  nextKind: "pro" | "free" | "future" | "expired" = "pro";

  async readEntitlement(userId: string): Promise<EntitlementSchedule> {
    this.reads.push(userId);
    if (this.failReads) throw new Error("synthetic Billing reader outage");
    const existing = this.schedules.get(userId);
    if (existing) return existing;
    const kind = this.nextKind;
    let schedule: EntitlementSchedule;
    if (kind === "free") {
      schedule = { userId, version: 0, plan: "free" };
    } else {
      schedule = {
        accountId: uuidv7(),
        userId,
        version: 1,
        plan: "pro",
        effectiveAt: new Date(
          kind === "future" ? "2026-08-16T12:30:00.000Z" : "2026-08-16T11:00:00.000Z",
        ),
        accessThrough: new Date(
          kind === "expired"
            ? "2026-08-16T11:15:00.000Z"
            : kind === "future"
              ? "2026-08-16T13:10:00.000Z"
              : "2026-08-16T12:10:00.000Z",
        ),
        graceThrough: new Date(
          kind === "expired"
            ? "2026-08-16T11:30:00.000Z"
            : kind === "future"
              ? "2026-08-16T13:20:00.000Z"
              : "2026-08-16T12:20:00.000Z",
        ),
      };
    }
    this.schedules.set(userId, schedule);
    return schedule;
  }

  async applyEntitlementChange(): Promise<never> {
    throw new Error("not used by read tests");
  }

  async ping(): Promise<void> {}
}

class MemoryDocumentStore implements DocumentStore {
  private readonly documents: ResumeDocument[] = [];
  private readonly responses = new Map<string, CreateResumeUploadResponse>();

  async listResumeDocuments(): Promise<ResumeDocumentCollection> {
    return { documents: [...this.documents] };
  }

  async createResumeUpload(
    _userId: string,
    input: CreateResumeUploadRequest,
    idempotencyKey: string,
  ): Promise<CreateResumeUploadResponse> {
    const existing = this.responses.get(idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const document: ResumeDocument = {
      id: uuidv7(),
      ...input,
      status: "awaiting_upload",
      createdAt: now,
      updatedAt: now,
    };
    const response: CreateResumeUploadResponse = {
      document,
      upload: {
        url: "https://candidate-documents.example.test/",
        method: "POST",
        fields: { key: `quarantine/${document.id}/source`, policy: "signed-policy" },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    };
    this.documents.unshift(document);
    this.responses.set(idempotencyKey, response);
    return response;
  }

  async deleteResume(_userId: string, documentId: string): Promise<void> {
    const index = this.documents.findIndex((document) => document.id === documentId);
    if (index >= 0) this.documents.splice(index, 1);
  }

  async close(): Promise<void> {}
}

async function createApp(
  options: {
    catalog?: JobCatalogReader;
    contributionCapabilityPolicy?: ContributionCapabilityPolicySource;
    trust?: TrustApplicationService;
    trustReviewerAssignments?: readonly TrustReviewerAssignment[];
    applications?: ApplicationsApi;
    documents?: DocumentStore;
    restrictedAnswerVault?: RestrictedAnswerVaultStore;
    profileSections?: ProfileSectionStore;
    stripeBilling?: StripeBillingGateway;
    notifications?: NotificationsApi;
    privilegedModerationAudit?: PrivilegedModerationAuditWriter;
  } = {},
) {
  const issuer = await createTestTokenIssuer();
  const store = new MemoryProfileStore();
  const catalog = new MemoryJobCatalog();
  const documents = options.documents ?? new MemoryDocumentStore();
  const savedJobs = new MemorySavedJobs();
  const privateSavedPageCaptures = new MemoryPrivateSavedPageCaptures();
  const jobReports = new MemoryJobReports();
  const jobContributions = new MemoryJobContributions();
  const ugcContributionConsents = new MemoryUgcContributionConsents();
  const moderation = new MemoryModeration();
  const matchAssessments = new MemoryMatchAssessments();
  const entitlements = new MemoryEntitlements();
  const now = new Date("2026-08-16T12:00:00.000Z");
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const idTokenVerificationTokens: string[] = [];
  const idTokenVerifier: IdTokenVerifier = {
    async verify(token) {
      idTokenVerificationTokens.push(token);
      const evidence =
        token === FRESH_ID_TOKEN_PROOF
          ? { authenticatedAt: nowSeconds - 30, authenticationMethods: ["pwd", "mfa"] }
          : token === RECENT_PASSWORD_ID_TOKEN_PROOF
            ? { authenticatedAt: nowSeconds - 30, authenticationMethods: ["pwd"] }
            : token === STALE_ID_TOKEN_PROOF
              ? { authenticatedAt: nowSeconds - 901, authenticationMethods: ["pwd", "mfa"] }
              : token === FUTURE_ID_TOKEN_PROOF
                ? { authenticatedAt: nowSeconds + 31, authenticationMethods: ["pwd", "mfa"] }
                : { authenticatedAt: nowSeconds - 30, authenticationMethods: ["pwd", "mfa"] };
      return {
        issuer: "https://test-issuer.invalid/",
        subject:
          token === MISMATCHED_ID_TOKEN_PROOF ? "different-candidate" : "candidate-rights-route",
        audience: ["candidate-web-client"],
        ...evidence,
      };
    },
    async verifyIdentity(token) {
      const issuer = "https://test-issuer.invalid/";
      if (token === MISMATCHED_ID_TOKEN_PROOF) return { issuer, subject: "different-candidate" };
      if (token === VERIFIED_EMAIL_ID_TOKEN_PROOF)
        return { issuer, subject: "notif-email-owner", verifiedEmail: "Person@Example.com" };
      if (token === UNVERIFIED_EMAIL_ID_TOKEN_PROOF)
        return { issuer, subject: "notif-email-owner" };
      throw new AuthenticationError("The ID token is invalid");
    },
  };
  const app = await createGatewayApplication({
    store,
    ...(options.restrictedAnswerVault
      ? { restrictedAnswerVault: options.restrictedAnswerVault }
      : {}),
    ...(options.profileSections ? { profileSections: options.profileSections } : {}),
    catalog: options.catalog ?? catalog,
    savedJobs,
    privateSavedPageCaptures,
    jobReports,
    jobContributions,
    ...(options.contributionCapabilityPolicy
      ? { contributionCapabilityPolicy: options.contributionCapabilityPolicy }
      : {}),
    ugcContributionConsents,
    ugcContributionPolicyVersion: "d2-synthetic-policy.v1",
    moderation,
    ...(options.privilegedModerationAudit
      ? { privilegedModerationAudit: options.privilegedModerationAudit }
      : {}),
    matchAssessments,
    entitlements,
    ...(options.stripeBilling ? { stripeBilling: options.stripeBilling } : {}),
    ...(options.notifications ? { notifications: options.notifications } : {}),
    documents,
    ...(options.applications ? { applications: options.applications } : {}),
    ...(options.trust ? { trust: options.trust } : {}),
    ...(options.trustReviewerAssignments
      ? { trustReviewerAssignments: options.trustReviewerAssignments }
      : {}),
    verifier: issuer.verifier,
    idTokenVerifier,
    releaseSha: "test",
    clock: () => new Date(now.getTime()),
  });
  return {
    app,
    issuer,
    catalog,
    store,
    savedJobs,
    privateSavedPageCaptures,
    jobReports,
    jobContributions,
    ugcContributionConsents,
    matchAssessments,
    entitlements,
    moderation,
    now,
    idTokenVerificationTokens,
  };
}

const publicContributionCapabilityPolicy = {
  keyId: "extension-policy-key-v1",
  payload: {
    schemaVersion: 1,
    revision: "extension-policy-r42",
    issuedAt: "2026-08-16T11:00:00.000Z",
    expiresAt: "2026-08-16T18:00:00.000Z",
    intakeEnabled: true,
    processingEnabled: false,
    clients: { "0.2.0": true },
    providers: { ashby: true, greenhouse: true, lever: false },
    variants: {
      "ashby-job-board-v1": true,
      "greenhouse-board-v1": true,
      "lever-posting-v1": false,
    },
    domains: { "jobs.ashbyhq.com": true },
  },
  signature: "a".repeat(86),
} satisfies SignedContributionCapabilityPolicy;

describe("public extension contribution capability policy", () => {
  it("is absent unless a verified source is explicitly configured", async () => {
    const { app } = await createApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/extension/contribution-capability-policy",
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns only the exact signed envelope without authentication and disables storage", async () => {
    const source: ContributionCapabilityPolicySource = {
      async load() {
        throw new Error("The public route must not use the private loader projection");
      },
      async readPublicEnvelope() {
        return structuredClone(publicContributionCapabilityPolicy);
      },
    };
    const { app } = await createApp({ contributionCapabilityPolicy: source });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/extension/contribution-capability-policy",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual(publicContributionCapabilityPolicy);
      expect(response.body).not.toContain("PUBLIC KEY");
      expect(response.body).not.toContain("PRIVATE KEY");

      const invalid = await app.inject({
        method: "GET",
        url: "/v1/extension/contribution-capability-policy?revision=older",
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.headers["cache-control"]).toBe("no-store");

      const body = await app.inject({
        method: "GET",
        url: "/v1/extension/contribution-capability-policy",
        payload: { revision: "older" },
      });
      expect(body.statusCode).toBe(400);
      expect(body.headers["cache-control"]).toBe("no-store");
      expect(body.headers["content-type"]).toContain("application/problem+json");
    } finally {
      await app.close();
    }
  });

  it("projects source and shape failures to one fixed safe unavailable problem", async () => {
    const messages = ["unknown key secret", "stale revision secret"];
    for (const message of messages) {
      const source: ContributionCapabilityPolicySource = {
        async load() {
          return null;
        },
        async readPublicEnvelope() {
          if (message.startsWith("unknown")) {
            throw new ContributionCapabilityPolicySourceUnavailableError();
          }
          return { ...publicContributionCapabilityPolicy, signingSecret: message } as never;
        },
      };
      const { app } = await createApp({ contributionCapabilityPolicy: source });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/v1/extension/contribution-capability-policy",
        });
        expect(response.statusCode).toBe(503);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json().code).toBe("contribution_capability_policy_unavailable");
        expect(response.body).not.toContain(message);
      } finally {
        await app.close();
      }
    }
  });
});

describe("candidate API", () => {
  let app: NestFastifyApplication;
  let issuer: Awaited<ReturnType<typeof createTestTokenIssuer>>;
  let catalog: MemoryJobCatalog;
  let store: MemoryProfileStore;
  let savedJobs: MemorySavedJobs;
  let jobReports: MemoryJobReports;
  let jobContributions: MemoryJobContributions;
  let matchAssessments: MemoryMatchAssessments;
  let entitlements: MemoryEntitlements;
  let moderation: MemoryModeration;
  let now: Date;
  let idTokenVerificationTokens: string[];

  beforeAll(async () => {
    const setup = await createApp();
    app = setup.app;
    issuer = setup.issuer;
    catalog = setup.catalog;
    store = setup.store;
    savedJobs = setup.savedJobs;
    jobReports = setup.jobReports;
    jobContributions = setup.jobContributions;
    matchAssessments = setup.matchAssessments;
    entitlements = setup.entitlements;
    moderation = setup.moderation;
    now = setup.now;
    idTokenVerificationTokens = setup.idTokenVerificationTokens;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_required");
  });

  it("requires a subject-bound recent ID-token proof on every candidate-rights mutation", async () => {
    const token = await issuer.issue("candidate-rights-route", {
      scope: "profile:read profile:write",
    });
    const authorization = { authorization: `Bearer ${token}` };
    const idempotencyKey = "candidate-rights-route-test-0001";
    const deletionRequestId = uuidv7();

    for (const proof of [undefined, "malformed-proof"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/me/data-exports",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          ...(proof ? { "x-ai-job-apply-reauthentication": proof } : {}),
        },
        payload: { format: "candidate-data-export-v1" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("authentication_required");
    }

    for (const proof of [STALE_ID_TOKEN_PROOF, FUTURE_ID_TOKEN_PROOF]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/me/data-exports",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-ai-job-apply-reauthentication": proof,
        },
        payload: { format: "candidate-data-export-v1" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("authentication_required");
    }

    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/me/data-exports",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-ai-job-apply-reauthentication": MISMATCHED_ID_TOKEN_PROOF,
      },
      payload: { format: "candidate-data-export-v1" },
    });
    expect(mismatch.statusCode).toBe(401);

    const exportResponse = await app.inject({
      method: "POST",
      url: "/v1/me/data-exports",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-ai-job-apply-reauthentication": FRESH_ID_TOKEN_PROOF,
      },
      payload: { format: "candidate-data-export-v1" },
    });
    expect(exportResponse.statusCode).toBe(202);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/me/account-deletion-requests",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "candidate-rights-route-test-0002",
        "x-ai-job-apply-reauthentication": FRESH_ID_TOKEN_PROOF,
      },
      payload: { acknowledgement: "ACCOUNT_DELETION_IS_IRREVERSIBLE" },
    });
    expect(createResponse.statusCode).toBe(201);

    const cancelResponse = await app.inject({
      method: "DELETE",
      url: `/v1/me/account-deletion-requests/${deletionRequestId}`,
      headers: {
        ...authorization,
        "idempotency-key": "candidate-rights-route-test-0003",
        "if-match": '"1"',
        "x-ai-job-apply-reauthentication": FRESH_ID_TOKEN_PROOF,
      },
    });
    expect(cancelResponse.statusCode).toBe(204);

    const noMfaConfirmation = await app.inject({
      method: "POST",
      url: `/v1/me/account-deletion-requests/${deletionRequestId}/confirm`,
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "candidate-rights-route-test-0004",
        "x-ai-job-apply-reauthentication": RECENT_PASSWORD_ID_TOKEN_PROOF,
      },
      payload: { expectedVersion: 1, confirmation: "DELETE_MY_ACCOUNT" },
    });
    expect(noMfaConfirmation.statusCode).toBe(401);
    expect(noMfaConfirmation.json().code).toBe("authentication_required");

    const confirmation = await app.inject({
      method: "POST",
      url: `/v1/me/account-deletion-requests/${deletionRequestId}/confirm`,
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "candidate-rights-route-test-0005",
        "x-ai-job-apply-reauthentication": FRESH_ID_TOKEN_PROOF,
      },
      payload: { expectedVersion: 1, confirmation: "DELETE_MY_ACCOUNT" },
    });
    expect(confirmation.statusCode).toBe(202);
    expect(store.candidateRightsPrincipals).toHaveLength(4);
    expect(store.candidateRightsPrincipals.at(-1)).toMatchObject({
      authenticatedAt: Math.floor(now.getTime() / 1_000) - 30,
      authenticationMethods: ["pwd", "mfa"],
    });

    const verificationCount = idTokenVerificationTokens.length;
    const unrelated = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        ...authorization,
        "x-ai-job-apply-reauthentication": FRESH_ID_TOKEN_PROOF,
      },
    });
    expect(unrelated.statusCode).toBe(200);
    expect(idTokenVerificationTokens).toHaveLength(verificationCount);
  });

  it("fails readiness when the Billing schema is unavailable", async () => {
    entitlements.pingFailure = new Error("missing billing relation");
    const unavailable = await app.inject({ method: "GET", url: "/health/ready" });
    entitlements.pingFailure = undefined;
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("billing relation");
    expect(ready.statusCode).toBe(200);
  });

  it("fails readiness when the Jobs reporting migration is unavailable", async () => {
    jobReports.pingFailure = new Error("missing private reporting relation");
    const unavailable = await app.inject({ method: "GET", url: "/health/ready" });
    jobReports.pingFailure = undefined;
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("private reporting relation");
    expect(ready.statusCode).toBe(200);
  });

  it("classifies internal failures without retaining messages, stacks, or unknown routes", () => {
    const failure = Object.assign(
      new Error("Bearer secret-token for candidate@example.test in Atlanta"),
      {
        code: "42P01",
        stack: "sensitive stack and filesystem path",
      },
    );

    const diagnostic = privacySafeRequestFailure(failure, "/v1/jobs/:jobId");
    expect(diagnostic).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/jobs/:jobId",
      error_type: "Error",
      error_code: "42P01",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-token");
    expect(JSON.stringify(diagnostic)).not.toContain("candidate@example.test");
    expect(JSON.stringify(diagnostic)).not.toContain("Atlanta");
    expect(JSON.stringify(diagnostic)).not.toContain("filesystem");
    expect(privacySafeRequestFailure({ name: "bad value", code: "secret-value" }, "/raw")).toEqual({
      event: "unhandled_request_failure",
      route: "unknown",
      error_type: "UnknownError",
      error_code: "UNKNOWN",
    });

    const registrationFailure = new ResumeUploadRegistrationError(
      "GRANT_SIGN",
      new Error("temporary credential and candidate content must remain private"),
    );
    expect(privacySafeRequestFailure(registrationFailure, "/v1/resumes/uploads")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/resumes/uploads",
      error_type: "ResumeUploadRegistrationError",
      error_code: "DOCUMENT_GRANT_SIGN",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(registrationFailure, "/v1/resumes/uploads")),
    ).not.toContain("candidate content");

    // A PostgreSQL SQLSTATE cause is logged for upload registration, and nothing else from the cause is.
    const registrationDatabaseFailure = new ResumeUploadRegistrationError(
      "IDEMPOTENCY_INSERT",
      Object.assign(new Error("candidate resume text must remain private"), { code: "42804" }),
    );
    expect(privacySafeRequestFailure(registrationDatabaseFailure, "/v1/resumes/uploads")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/resumes/uploads",
      error_type: "ResumeUploadRegistrationError",
      error_code: "DOCUMENT_IDEMPOTENCY_INSERT",
      postgres_cause_code: "42804",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(registrationDatabaseFailure, "/v1/resumes/uploads")),
    ).not.toContain("candidate resume text");
    // A driver error code (the D3-024 failure) is reported as such, and nothing else from the cause is.
    const registrationDriverFailure = new ResumeUploadRegistrationError(
      "IDEMPOTENCY_INSERT",
      Object.assign(new Error("candidate resume text must remain private"), {
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(privacySafeRequestFailure(registrationDriverFailure, "/v1/resumes/uploads")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/resumes/uploads",
      error_type: "ResumeUploadRegistrationError",
      error_code: "DOCUMENT_IDEMPOTENCY_INSERT",
      driver_cause_code: "ERR_INVALID_ARG_TYPE",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(registrationDriverFailure, "/v1/resumes/uploads")),
    ).not.toContain("candidate resume text");
    expect(
      privacySafeRequestFailure(registrationDriverFailure, "/v1/jobs/:jobId"),
    ).not.toHaveProperty("driver_cause_code");
    for (const unsafeDriverCode of [
      "secret value",
      "lower_case",
      "AB",
      `A${"B".repeat(70)}`,
      "ERR-DASH",
    ]) {
      const unsafe = new ResumeUploadRegistrationError(
        "IDEMPOTENCY_INSERT",
        Object.assign(new Error("private"), { code: unsafeDriverCode }),
      );
      expect(privacySafeRequestFailure(unsafe, "/v1/resumes/uploads")).not.toHaveProperty(
        "driver_cause_code",
      );
    }
    for (const unsafeCode of ["secret-value", "42", "42804 ", "xx000", "not a code"]) {
      const unsafe = new ResumeUploadRegistrationError(
        "IDEMPOTENCY_INSERT",
        Object.assign(new Error("private"), { code: unsafeCode }),
      );
      expect(privacySafeRequestFailure(unsafe, "/v1/resumes/uploads")).not.toHaveProperty(
        "postgres_cause_code",
      );
    }
    // Only the upload route reports it, so another route with the same error name does not.
    expect(
      privacySafeRequestFailure(registrationDatabaseFailure, "/v1/jobs/:jobId"),
    ).not.toHaveProperty("postgres_cause_code");

    const contributionFailure = new JobContributionUnavailableError(
      "JOB_STORE_CHRONOLOGY",
      Object.assign(new Error("private posting data"), { code: "42883" }),
    );
    expect(privacySafeRequestFailure(contributionFailure, "/v1/jobs/contributions")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/jobs/contributions",
      error_type: "JobContributionUnavailableError",
      error_code: "JOB_STORE_CHRONOLOGY",
      postgres_cause_code: "42883",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(contributionFailure, "/v1/jobs/contributions")),
    ).not.toContain("private posting data");

    const stagedContributionFailure = new JobContributionUnavailableError(
      "JOB_STORE_SCHEMA",
      Object.assign(new Error("private stage detail"), {
        cause: Object.assign(new Error("private database detail"), { code: "42883" }),
        code: "JOB_STORE_INSERT",
        name: "JobContributionStoreStageError",
      }),
    );
    expect(privacySafeRequestFailure(stagedContributionFailure, "/v1/jobs/contributions")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/jobs/contributions",
      error_type: "JobContributionUnavailableError",
      error_code: "JOB_STORE_SCHEMA",
      postgres_cause_code: "42883",
    });
    expect(
      JSON.stringify(
        privacySafeRequestFailure(stagedContributionFailure, "/v1/jobs/contributions"),
      ),
    ).not.toContain("private");

    const stagedClientFailure = new JobContributionUnavailableError(
      "JOB_STORE_INSERT",
      Object.assign(new Error("private stage detail"), {
        cause: Object.assign(new TypeError("private binding detail"), {
          code: "UNDEFINED_VALUE",
        }),
        code: "JOB_STORE_INSERT",
        name: "JobContributionStoreStageError",
      }),
    );
    expect(privacySafeRequestFailure(stagedClientFailure, "/v1/jobs/contributions")).toEqual({
      event: "unhandled_request_failure",
      route: "/v1/jobs/contributions",
      error_type: "JobContributionUnavailableError",
      error_code: "JOB_STORE_INSERT",
      contribution_cause_code: "UNDEFINED_VALUE",
      contribution_cause_type: "TypeError",
    });
    expect(
      JSON.stringify(privacySafeRequestFailure(stagedClientFailure, "/v1/jobs/contributions")),
    ).not.toContain("private");

    const untrustedCause = new JobContributionUnavailableError(
      "JOB_STORE_WRITE",
      Object.assign(new Error("private posting data"), { code: "SEC01" }),
    );
    expect(privacySafeRequestFailure(untrustedCause, "/v1/jobs/contributions")).not.toHaveProperty(
      "postgres_cause_code",
    );
    expect(privacySafeRequestFailure(untrustedCause, "/v1/jobs/contributions")).toMatchObject({
      contribution_cause_type: "Error",
    });
    expect(privacySafeRequestFailure(untrustedCause, "/v1/jobs/contributions")).not.toHaveProperty(
      "contribution_cause_code",
    );
  });

  it("preserves an API Gateway principal through the real Fastify injection lifecycle", async () => {
    const issuerUrl = "https://identity.example.test/";
    const audience = "ai-job-apply-api";
    const principalBridge = createInvocationPrincipalBridge();
    const lambdaApp = await createGatewayApplication({
      store: new MemoryProfileStore(),
      catalog: new MemoryJobCatalog(),
      savedJobs: new MemorySavedJobs(),
      jobReports: new MemoryJobReports(),
      jobContributions: new MemoryJobContributions(),
      moderation: new MemoryModeration(),
      matchAssessments: new MemoryMatchAssessments(),
      entitlements: new MemoryEntitlements(),
      documents: new MemoryDocumentStore(),
      verifier: principalBridge.verifier,
      releaseSha: "lambda-principal-bridge-test",
    });
    const handler = createApiGatewayHandler({
      app: Promise.resolve(lambdaApp),
      issuer: issuerUrl,
      audience,
      principalBridge,
    });
    const input = {
      version: "2.0",
      routeKey: "GET /v1/me",
      rawPath: "/v1/me",
      rawQueryString: "",
      headers: { authorization: "Bearer caller-token-must-not-reach-fastify" },
      requestContext: {
        accountId: "123456789012",
        apiId: "api-id",
        domainName: "api.example.test",
        domainPrefix: "api",
        http: {
          method: "GET",
          path: "/v1/me",
          protocol: "HTTP/1.1",
          sourceIp: "203.0.113.1",
          userAgent: "test",
        },
        requestId: "request-id-fastify-bridge",
        routeKey: "GET /v1/me",
        stage: "$default",
        time: "02/Aug/2026:00:00:00 +0000",
        timeEpoch: 1_775_000_000_000,
        authorizer: {
          jwt: {
            claims: {
              iss: issuerUrl,
              sub: "auth0|candidate-fastify",
              aud: [audience],
              scope: "profile:read profile:write",
            },
            scopes: ["profile:read", "profile:write"],
          },
        },
      },
      isBase64Encoded: false,
    } as AuthorizedHttpApiEvent;

    try {
      const response = await handler(input);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body ?? "{}").id).toBeTypeOf("string");
    } finally {
      await lambdaApp.close();
    }
  });

  it("resolves the full external identity tuple to distinct internal owners", async () => {
    const identities = new MemoryProfileStore();
    const base = {
      subject: "same-subject",
      audience: ["ai-job-apply-api"],
      scopes: ["profile:read"],
    };
    const first = await identities.resolveUser({
      ...base,
      issuer: "https://issuer-a.example.test/",
    });
    const replay = await identities.resolveUser({
      ...base,
      issuer: "https://issuer-a.example.test/",
    });
    const otherIssuer = await identities.resolveUser({
      ...base,
      issuer: "https://issuer-b.example.test/",
    });
    const otherSubject = await identities.resolveUser({
      ...base,
      issuer: "https://issuer-a.example.test/",
      subject: "other-subject",
    });

    expect(replay.id).toBe(first.id);
    expect(otherIssuer.id).not.toBe(first.id);
    expect(otherSubject.id).not.toBe(first.id);
  });

  it("returns only the authenticated owner's derived entitlement projection", async () => {
    const firstToken = await issuer.issue("candidate-entitlement-a", { scope: "profile:read" });
    const secondToken = await issuer.issue("candidate-entitlement-b", { scope: "profile:read" });
    const wrongScope = await issuer.issue("candidate-entitlement-no-read", { scope: "jobs:read" });
    const first = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const firstOwner = entitlements.calls.at(-1)?.userId;
    expect(firstOwner).toMatch(/^[a-f0-9-]{36}$/);
    entitlements.evaluations.set(firstOwner as string, {
      valid: true,
      plan: "pro",
      accessState: "grace",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      limits: { maxStoredResumes: 1 },
      version: 7,
      evaluatedAt: now.toISOString(),
      accessThrough: "2026-08-15T12:00:00.000Z",
      graceThrough: "2026-08-20T12:00:00.000Z",
    });
    const projected = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const second = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${secondToken}` },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${wrongScope}` },
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toEqual({
      plan: "free",
      accessState: "active",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      limits: { maxStoredResumes: 1 },
      version: 0,
      evaluatedAt: now.toISOString(),
    });
    expect(projected.json()).toEqual({
      plan: "pro",
      accessState: "grace",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      limits: { maxStoredResumes: 1 },
      version: 7,
      evaluatedAt: now.toISOString(),
      accessThrough: "2026-08-15T12:00:00.000Z",
      graceThrough: "2026-08-20T12:00:00.000Z",
    });
    expect(projected.body).not.toMatch(/userId|accountId|provider|price|quota|valid|reason/i);
    expect(entitlements.calls.at(-1)?.userId).not.toBe(firstOwner);
    expect(second.statusCode).toBe(200);
    expect(forbidden.statusCode).toBe(403);

    const callsBeforeInvalidInput = entitlements.calls.length;
    const resolutionsBeforeInvalidInput = store.resolveUserCalls;
    const query = await app.inject({
      method: "GET",
      url: "/v1/entitlements?owner=other",
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const body = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${firstToken}`, "content-type": "application/json" },
      payload: { owner: "other" },
    });
    expect(query.statusCode).toBe(400);
    expect(body.statusCode).toBe(400);
    expect(entitlements.calls).toHaveLength(callsBeforeInvalidInput);
    expect(store.resolveUserCalls).toBe(resolutionsBeforeInvalidInput);
    expect(query.body).not.toContain("other");
    expect(body.body).not.toContain("other");
  });

  it("collapses malformed and unavailable entitlement state to one privacy-safe 503", async () => {
    const token = await issuer.issue("candidate-entitlement-failure", { scope: "profile:read" });
    const authorization = { authorization: `Bearer ${token}` };
    entitlements.failure = new Error(
      "provider secret, account 018f92b0-4ad7-7b1d-8f44-b7ae694c85c1 and candidate@example.test",
    );
    const unavailable = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: authorization,
    });
    entitlements.failure = undefined;
    const owner = entitlements.calls.at(-1)?.userId as string;
    entitlements.evaluations.set(owner, { valid: false, reason: "invalid_schedule", grants: [] });
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: authorization,
    });

    for (const response of [unavailable, malformed]) {
      expect(response.statusCode).toBe(503);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        code: "entitlement_unavailable",
        title: "Entitlement status unavailable",
      });
      expect(response.body).not.toMatch(/provider secret|candidate@|018f92b0|invalid_schedule/i);
    }
    // limits are part of the contract: a missing or out-of-range limit fails closed like any malformed evaluation
    for (const limits of [
      undefined,
      { maxStoredResumes: -1 },
      { maxStoredResumes: 1.5 },
      { maxStoredResumes: 1001 },
      { maxStoredResumes: "1" },
    ]) {
      entitlements.evaluations.set(owner, {
        valid: true,
        plan: "free",
        accessState: "active",
        grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
        limits,
        version: 1,
        evaluatedAt: now.toISOString(),
      } as never);
      const badLimits = await app.inject({
        method: "GET",
        url: "/v1/entitlements",
        headers: authorization,
      });
      expect(badLimits.statusCode, JSON.stringify(limits)).toBe(503);
      expect(badLimits.json().code, JSON.stringify(limits)).toBe("entitlement_unavailable");
    }
    entitlements.evaluations.set(owner, {
      valid: true,
      plan: "enterprise",
      accessState: "active",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      version: 1,
      evaluatedAt: now.toISOString(),
      accessThrough: "2026-09-16T12:00:00.000Z",
    } as never);
    const unknownPlan = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: authorization,
    });
    entitlements.evaluations.set(owner, {
      valid: true,
      plan: "pro",
      accessState: "grace",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      limits: { maxStoredResumes: 1 },
      version: 1,
      evaluatedAt: now.toISOString(),
      accessThrough: "2026-08-16T12:01:00.000Z",
      graceThrough: "2026-08-16T12:02:00.000Z",
    });
    const prematureGrace = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: authorization,
    });
    entitlements.evaluations.set(owner, {
      valid: true,
      plan: "free",
      accessState: "active",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
      limits: { maxStoredResumes: 1 },
      version: 1,
      evaluatedAt: "2026-02-30T12:00:00.000Z",
    });
    const impossibleDate = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: authorization,
    });
    for (const response of [unknownPlan, prematureGrace, impossibleDate]) {
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toMatch(/enterprise|invalid_schedule|12:01|02-30/i);
    }
    entitlements.evaluations.delete(owner);
  });

  it("uses only owner-keyed eligible Pro fallback after a Billing-reader failure", async () => {
    const cacheStore = new SequenceBillingStore();
    let cacheClock = new Date("2026-08-16T12:00:00.000Z");
    const cacheApp = await createGatewayApplication({
      store: new MemoryProfileStore(),
      catalog: new MemoryJobCatalog(),
      savedJobs: new MemorySavedJobs(),
      jobReports: new MemoryJobReports(),
      jobContributions: new MemoryJobContributions(),
      moderation: new MemoryModeration(),
      matchAssessments: new MemoryMatchAssessments(),
      entitlements: new BillingEntitlementService(
        cacheStore,
        new EntitlementCache({ capacity: 10, freshTtlMs: 1_000 }),
      ),
      documents: new MemoryDocumentStore(),
      verifier: issuer.verifier,
      releaseSha: "entitlement-cache-test",
      clock: () => new Date(cacheClock.getTime()),
    });
    const kinds = ["pro", "free", "future", "expired"] as const;
    const tokens: string[] = [];
    try {
      for (const kind of kinds) {
        cacheStore.nextKind = kind;
        const token = await issuer.issue(`candidate-entitlement-cache-${kind}`, {
          scope: "profile:read",
        });
        tokens.push(token);
        const initial = await cacheApp.inject({
          method: "GET",
          url: "/v1/entitlements",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(initial.statusCode).toBe(200);
        expect(initial.json().plan).toBe(kind === "pro" ? "pro" : "free");
      }

      cacheStore.failReads = true;
      cacheClock = new Date("2026-08-16T12:00:00.500Z");
      for (const token of tokens) {
        expect(
          (
            await cacheApp.inject({
              method: "GET",
              url: "/v1/entitlements",
              headers: { authorization: `Bearer ${token}` },
            })
          ).statusCode,
        ).toBe(200);
      }

      cacheClock = new Date("2026-08-16T12:00:02.000Z");
      const afterFreshness = await Promise.all(
        tokens.map((token) =>
          cacheApp.inject({
            method: "GET",
            url: "/v1/entitlements",
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      );
      expect(afterFreshness.map((response) => response.statusCode)).toEqual([200, 503, 503, 503]);

      const uncachedToken = await issuer.issue("candidate-entitlement-cache-uncached", {
        scope: "profile:read",
      });
      const uncached = await cacheApp.inject({
        method: "GET",
        url: "/v1/entitlements",
        headers: { authorization: `Bearer ${uncachedToken}` },
      });
      expect(uncached.statusCode).toBe(503);
      expect(uncached.body).not.toContain("synthetic Billing reader outage");
    } finally {
      await cacheApp.close();
    }
  });

  it("persists preferences idempotently and exposes an owned operation", async () => {
    const token = await issuer.issue("candidate-1", { email: "candidate@example.test" });
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: ["New York, NY"],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "foundation-test-key-0001",
    };
    const first = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    const replay = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());

    const preferences = await app.inject({
      method: "GET",
      url: "/v1/me/job-preferences",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preferences.statusCode).toBe(200);
    expect(preferences.json()).toMatchObject(payload);

    const operation = await app.inject({
      method: "GET",
      url: `/v1/operations/${first.json().operationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(operation.statusCode).toBe(200);
    expect(operation.json().state).toBe("queued");
  });

  it("returns an active redacted job only with the dedicated read scope", async () => {
    const jobToken = await issuer.issue("candidate-job-reader", { scope: "jobs:read" });
    const profileToken = await issuer.issue("candidate-profile-reader", {
      scope: "profile:read",
    });

    const identityWritesBeforeJobReads = store.resolveUserCalls;
    const accepted = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id}`,
      headers: { authorization: `Bearer ${jobToken}` },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id}`,
      headers: { authorization: `Bearer ${profileToken}` },
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/jobs/${uuidv7()}`,
      headers: { authorization: `Bearer ${jobToken}` },
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/jobs/not-a-uuid",
      headers: { authorization: `Bearer ${jobToken}` },
    });

    expect(accepted.statusCode).toBe(200);
    // The installed extension's strict reader requires this exact policy on authenticated reads.
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.json()).toMatchObject({
      id: catalog.job.id,
      status: "active",
      company: { name: "Synthetic Company" },
      sources: [{ provenance: "authorized_fixture" }],
    });
    expect(accepted.json().sources[0]).not.toHaveProperty("rawSnapshot");
    expect(accepted.json().sources[0]).not.toHaveProperty("externalJobId");
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("forbidden");
    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
    expect(store.resolveUserCalls).toBe(identityWritesBeforeJobReads);
  });

  it.each([false, true])(
    "serializes PostgreSQL detail timestamp strings into the canonical contract (alias=%s)",
    async (alias) => {
      const canonicalId = uuidv7();
      const requestedId = alias ? uuidv7() : canonicalId;
      const companyId = uuidv7();
      const privateCanary = "synthetic-private-source-field-not-for-candidate-response";
      const row = {
        id: canonicalId,
        companyId,
        companyName: "Synthetic PostgreSQL Company",
        companyVerifiedDomain: null,
        title: "Synthetic PostgreSQL Engineer",
        locations: ["Remote - US"],
        department: null,
        description: "Synthetic description preserved through the actual detail route.",
        status: "active",
        firstObservedAt: "2026-08-11 20:00:00.123456+00",
        lastVerifiedAt: "2026-08-12 20:00:00.234567+00",
        expiresAt: "2099-09-11 20:00:00.345678+00",
        validThrough: alias ? "2099-09-10 20:00:00.456789+00" : null,
        rawSnapshot: privateCanary,
        sources: [
          {
            provider: "greenhouse",
            provenance: "permitted_api",
            canonicalUrl: "https://jobs.example.test/synthetic/postgres-detail",
            firstObservedAt: "2026-08-11T20:00:00.123456+00:00",
            lastVerifiedAt: "2026-08-12T20:00:00.234567+00:00",
            validThrough: "2099-09-10T20:00:00.456789+00:00",
            externalJobId: privateCanary,
          },
          {
            provider: "ugc",
            provenance: "explicit_ugc",
            canonicalUrl: "https://careers.example.test/synthetic/postgres-detail",
            firstObservedAt: "2026-08-11T16:00:00.123456-04:00",
            lastVerifiedAt: "2026-08-12T16:00:00.234567-04:00",
            validThrough: null,
            contributorId: privateCanary,
          },
        ],
      };
      const parameters: unknown[][] = [];
      const client = ((parts: TemplateStringsArray, ...values: unknown[]) => {
        parameters.push(values);
        const statement = parts.join("?").replace(/\s+/g, " ").trim();
        if (statement.startsWith("WITH RECURSIVE resolution(id, path)")) {
          return Promise.resolve(alias ? [{ id: canonicalId }] : []);
        }
        if (statement.startsWith("WITH RECURSIVE canonical_members(id)")) {
          expect(statement).toContain("source.withdrawn_at IS NULL");
          expect(statement).toContain("job.status = 'active'");
          expect(statement).toContain("job.expires_at > ?");
          return Promise.resolve([row]);
        }
        throw new Error("Unexpected generated detail query");
      }) as unknown as postgres.Sql;
      const setup = await createApp({
        catalog: new PostgresJobCatalog(client, {
          searchCursorKeys: { active: { id: "detail-test-v1", key: Buffer.alloc(32, 7) } },
        }),
      });
      try {
        const token = await setup.issuer.issue("synthetic-postgres-detail-reader", {
          scope: "jobs:read",
        });
        const response = await setup.app.inject({
          method: "GET",
          url: `/v1/jobs/${requestedId}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(200);
        const value: unknown = response.json();
        expect(compileComponentValidator("CanonicalJobDetail")(value)).toBe(true);
        expect(value).toEqual({
          id: canonicalId,
          company: { id: companyId, name: row.companyName },
          title: row.title,
          locations: row.locations,
          description: row.description,
          status: "active",
          firstObservedAt: "2026-08-11T20:00:00.123Z",
          lastVerifiedAt: "2026-08-12T20:00:00.234Z",
          expiresAt: "2099-09-11T20:00:00.345Z",
          ...(alias ? { validThrough: "2099-09-10T20:00:00.456Z" } : {}),
          sources: row.sources.map((source) => ({
            provider: source.provider,
            provenance: source.provenance,
            canonicalUrl: source.canonicalUrl,
            firstObservedAt: "2026-08-11T20:00:00.123Z",
            lastVerifiedAt: "2026-08-12T20:00:00.234Z",
            ...(source.validThrough ? { validThrough: "2099-09-10T20:00:00.456Z" } : {}),
          })),
        });
        expect(response.body).not.toContain(privateCanary);
        expect(parameters).toHaveLength(2);
        expect(parameters[0]).toEqual([requestedId, requestedId]);
        expect(parameters[1]?.slice(0, 2)).toEqual([canonicalId, canonicalId]);
        expect(parameters[1]?.[2]).toEqual(expect.any(String));
        expect(setup.store.resolveUserCalls).toBe(0);
      } finally {
        await setup.app.close();
      }
    },
  );

  it("searches active jobs through a strict privacy-safe body and dedicated read scope", async () => {
    const jobToken = await issuer.issue("candidate-job-search", { scope: "jobs:read" });
    const profileToken = await issuer.issue("candidate-job-search-wrong-scope", {
      scope: "profile:read",
    });
    const payload = {
      query: "software engineer",
      filters: {
        title: "Software Engineer",
        company: "Synthetic Company",
        location: "Remote - US",
        verifiedWithinDays: 30,
      },
      sort: "relevance",
      pageSize: 10,
    };
    const identityWritesBeforeSearch = store.resolveUserCalls;
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload,
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${profileToken}` },
      payload,
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload: { ...payload, sort: "match", pageSize: 26 },
    });
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      payload,
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: {
        authorization: `Bearer ${jobToken}`,
        "content-type": "application/json",
      },
      payload: '{"query":"must-not-leak"',
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.json()).toEqual({
      items: [
        expect.objectContaining({
          id: catalog.job.id,
          status: "active",
          company: {
            id: catalog.job.company.id,
            name: "Synthetic Company",
            verifiedDomain: "example.test",
          },
        }),
      ],
      nextCursor: "opaque_cursor_v1.signature_v1",
    });
    expect(accepted.json().items[0]).not.toHaveProperty("description");
    expect(catalog.lastSearchInput).toEqual(payload);
    expect(forbidden.statusCode).toBe(403);
    expect(unauthenticated.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("must-not-leak");
    expect(invalid.json().detail).not.toContain("software engineer");
    expect(store.resolveUserCalls).toBe(identityWritesBeforeSearch);

    catalog.catalogChanged = true;
    const changed = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload: { ...payload, cursor: "opaque_cursor_v1.signature_v1" },
    });
    catalog.catalogChanged = false;
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({
      code: "job_search_catalog_changed",
      title: "Job catalog changed",
    });
    expect(changed.json().detail).toContain("restart the search");

    catalog.searchFailure = new Error(
      "postgres password and candidate@example.test must not leave the boundary",
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/v1/jobs/search",
      headers: { authorization: `Bearer ${jobToken}` },
      payload,
    });
    catalog.searchFailure = undefined;
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    expect(unavailable.json()).toMatchObject({
      code: "job_search_unavailable",
      title: "Job search is unavailable",
    });
    expect(unavailable.body).not.toMatch(/postgres password|candidate@/i);
  });

  it("returns only owner-self fixed match evidence through the exact read boundary", async () => {
    const firstToken = await issuer.issue("candidate-match-a", { scope: "jobs:read" });
    const secondToken = await issuer.issue("candidate-match-b", { scope: "jobs:read" });
    const wrongScope = await issuer.issue("candidate-match-no-read", { scope: "profile:read" });
    const path = `/v1/jobs/${catalog.job.id}/match-assessment`;

    const first = await app.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const second = await app.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${secondToken}` },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${wrongScope}` },
    });
    const invalidQuery = await app.inject({
      method: "GET",
      url: `${path}?owner=other`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const uppercase = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id.toUpperCase()}/match-assessment`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const body = await app.inject({
      method: "GET",
      url: path,
      headers: { authorization: `Bearer ${firstToken}`, "content-type": "application/json" },
      payload: { owner: "other" },
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toMatchObject({
      requestedJobId: catalog.job.id,
      canonicalJobId: catalog.job.id,
      gate: "review_required",
    });
    expect(first.json().evidence).toHaveLength(9);
    expect(second.statusCode).toBe(200);
    expect(matchAssessments.calls.at(-2)?.ownerUserId).not.toBe(
      matchAssessments.calls.at(-1)?.ownerUserId,
    );
    expect(matchAssessments.calls.at(-1)?.requestedJobId).toBe(catalog.job.id);
    expect(forbidden.statusCode).toBe(403);
    expect(invalidQuery.statusCode).toBe(400);
    expect(uppercase.statusCode).toBe(400);
    expect(body.statusCode).toBe(400);
  });

  it.each([
    [new MatchAssessmentTargetUnavailableError(), 404, "match_job_unavailable"],
    [new MatchPreferencesRequiredError(), 409, "match_preferences_required"],
    [new MatchAssessmentUnavailableError(), 409, "match_preferences_require_review"],
    [new MatchAssessmentServiceUnavailableError(), 503, "match_assessment_unavailable"],
  ] as const)(
    "maps match-assessment failures to stable private problems",
    async (failure, status, code) => {
      matchAssessments.failure = failure;
      const token = await issuer.issue(`candidate-match-${code}`, { scope: "jobs:read" });
      const response = await app.inject({
        method: "GET",
        url: `/v1/jobs/${catalog.job.id}/match-assessment`,
        headers: { authorization: `Bearer ${token}` },
      });
      matchAssessments.failure = undefined;

      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().code).toBe(code);
      expect(response.body).not.toContain("candidate-match");
    },
  );

  it("fails closed when a match-assessment implementation returns a malformed projection", async () => {
    const original = matchAssessments.assess;
    matchAssessments.assess = async () =>
      ({
        schemaVersion: 1,
        requestedJobId: catalog.job.id,
        canonicalJobId: catalog.job.id,
        preferenceSetId: uuidv7(),
        preferenceVersion: 1,
        preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
        catalogRevision: "1",
        assessedAt: "2026-08-16T12:00:00.000Z",
        gate: "review_required",
        evidence: [],
        privateCandidateValue: "must-not-leak",
      }) as unknown as MatchAssessment;
    const token = await issuer.issue("candidate-match-malformed", { scope: "jobs:read" });
    const response = await app.inject({
      method: "GET",
      url: `/v1/jobs/${catalog.job.id}/match-assessment`,
      headers: { authorization: `Bearer ${token}` },
    });
    matchAssessments.assess = original;

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("must-not-leak");
  });

  it("rejects impossible, future-ordered, and out-of-range match metadata", async () => {
    const original = matchAssessments.assess;
    const valid = await original.call(matchAssessments, uuidv7(), catalog.job.id);
    const token = await issuer.issue("candidate-match-metadata", { scope: "jobs:read" });
    try {
      for (const malformed of [
        { ...valid, requestedJobId: uuidv7() },
        { ...valid, assessedAt: "2026-02-31T12:00:00.000Z" },
        { ...valid, preferenceUpdatedAt: "2026-08-16T12:00:00.001Z" },
        { ...valid, catalogRevision: "9223372036854775808" },
      ]) {
        matchAssessments.assess = async () => malformed as MatchAssessment;
        const response = await app.inject({
          method: "GET",
          url: `/v1/jobs/${catalog.job.id}/match-assessment`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(503);
      }
    } finally {
      matchAssessments.assess = original;
    }
  });

  it("recovers only the current owner's newest bounded contribution history", async () => {
    const ownerToken = await issuer.issue("history-owner", {
      scope: "jobs:contribute profile:read",
    });
    const otherToken = await issuer.issue("history-other", { scope: "jobs:contribute" });
    const headers = { authorization: `Bearer ${ownerToken}` };
    const owner = (await app.inject({ method: "GET", url: "/v1/me", headers })).json();
    const expected = Array.from({ length: 28 }, (_, index) => ({
      id: `019c0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      state: "awaiting_trust" as const,
      submittedAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:01:00.000Z",
    }));
    for (const contribution of expected) {
      jobContributions.records.set(contribution.id, { ownerUserId: owner.id, contribution });
    }
    const result = await app.inject({ method: "GET", url: "/v1/jobs/contributions", headers });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.json()).toEqual({ items: expected.reverse().slice(0, 25) });
    expect(result.body).not.toContain(owner.id);
    const foreign = await app.inject({
      method: "GET",
      url: "/v1/jobs/contributions",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json()).toEqual({ items: [] });
    expect(foreign.body).not.toContain(expected[0]?.id);
  });

  it("rejects history without exact contribution scope or with caller-controlled filters/body", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/jobs/contributions" })).statusCode).toBe(
      401,
    );
    for (const scope of ["jobs:read", "jobs:write", "profile:read"]) {
      const token = await issuer.issue(`history-${scope}`, { scope });
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/v1/jobs/contributions",
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(403);
    }
    const token = await issuer.issue("history-input", { scope: "jobs:contribute" });
    const headers = { authorization: `Bearer ${token}` };
    const list = vi.spyOn(jobContributions, "list");
    try {
      for (const suffix of [
        "?ownerUserId=other",
        "?cursor=value",
        "?limit=100",
        "?state=published",
      ]) {
        expect(
          (await app.inject({ method: "GET", url: `/v1/jobs/contributions${suffix}`, headers }))
            .statusCode,
        ).toBe(400);
      }
      expect(
        (await app.inject({ method: "GET", url: "/v1/jobs/contributions", headers, payload: {} }))
          .statusCode,
      ).toBe(400);
      expect(list).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  });

  it("checks Profile active-owner resolution before reading contribution history", async () => {
    const token = await issuer.issue("history-quarantined", { scope: "jobs:contribute" });
    const resolve = vi
      .spyOn(store, "resolveUser")
      .mockRejectedValueOnce(new AccountQuarantinedError());
    const list = vi.spyOn(jobContributions, "list");
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/jobs/contributions",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("account_quarantined");
      expect(list).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
      list.mockRestore();
    }
  });

  it("fails history closed for dependency errors, malformed projections, duplicates and misordering", async () => {
    const token = await issuer.issue("history-malformed", { scope: "jobs:contribute" });
    const request = {
      method: "GET" as const,
      url: "/v1/jobs/contributions",
      headers: { authorization: `Bearer ${token}` },
    };
    const list = vi.spyOn(jobContributions, "list");
    const item: JobContribution = {
      id: uuidv7(),
      state: "queued",
      submittedAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    try {
      list.mockRejectedValueOnce(
        new JobContributionUnavailableError(
          "JOB_STORE_READ",
          new Error("private database contents"),
        ),
      );
      const failure = await app.inject(request);
      expect(failure.statusCode).toBe(503);
      expect(failure.body).not.toContain("private database contents");
      for (const items of [
        [{ ...item, ownerUserId: "private-owner" }],
        [{ ...item, updatedAt: "2026-08-31T12:00:00.000Z" }],
        [item, item],
        [
          item,
          {
            ...item,
            id: uuidv7(),
            submittedAt: "2026-09-02T12:00:00.000Z",
            updatedAt: "2026-09-02T12:00:00.000Z",
          },
        ],
        [item, { ...item, id: uuidv7() }],
        Array.from({ length: 26 }, () => item),
      ]) {
        list.mockResolvedValueOnce(items);
        const response = await app.inject(request);
        expect(response.statusCode).toBe(503);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).not.toContain("private-owner");
        expect(response.body).not.toContain(item.id);
      }
    } finally {
      list.mockRestore();
    }
  });

  it("queues strict contributions behind jobs:contribute with replay and owner isolation", async () => {
    const ownerToken = await issuer.issue("candidate-contribution-owner", {
      scope: "jobs:contribute",
    });
    const otherToken = await issuer.issue("candidate-contribution-other", {
      scope: "jobs:contribute",
    });
    const writeOnlyToken = await issuer.issue("candidate-contribution-write-only", {
      scope: "jobs:write",
    });
    const payload = {
      schemaVersion: 1,
      contributionId: uuidv7(),
      client: { surface: "browser_extension", version: "0.1.0" },
      source: {
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
        externalJobId: "123",
        adapterVersion: "d2-job-page-v1",
      },
      posting: {
        companyName: "Synthetic Company",
        title: "Software Engineer",
        locations: ["Remote - US"],
        description: "Generated public posting data for gateway verification.",
      },
      observation: {
        observedAt: "2026-08-16T11:59:00.000Z",
        contentSha256: "a".repeat(64),
      },
      approval: {
        consentId: uuidv7(),
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "ugc-policy-v1",
        approvedAt: "2026-08-16T12:00:00.000Z",
        approvedFields: [
          "provider",
          "pageVariant",
          "sourceUrl",
          "externalJobId",
          "companyName",
          "title",
          "locations",
          "description",
        ],
        previewDigestSha256: "0".repeat(64),
      },
    };
    payload.observation.contentSha256 = createHash("sha256")
      .update(jobContributionContentDigestInput(payload as CreateJobContributionCommand["input"]))
      .digest("hex");
    payload.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(payload as CreateJobContributionCommand["input"]))
      .digest("hex");
    const request = {
      method: "POST" as const,
      url: "/v1/jobs/contributions",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": "gateway-contribution-key-0001",
      },
      payload,
    };
    const created = await app.inject(request);
    const replay = await app.inject(request);
    expect(created.statusCode).toBe(202);
    expect(replay.json()).toEqual(created.json());
    expect(created.json()).toMatchObject({ state: "queued" });
    expect(created.headers["cache-control"]).toBe("no-store");

    const projected = jobContributions.records.get(created.json().id);
    if (!projected) throw new Error("Synthetic contribution was not retained");
    projected.contribution.state = "ready_for_publication";
    projected.contribution.updatedAt = "2026-08-16T12:01:00.000Z";

    const owned = await app.inject({
      method: "GET",
      url: `/v1/jobs/contributions/${created.json().id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/jobs/contributions/${created.json().id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.json()).toEqual({
      id: created.json().id,
      state: "ready_for_publication",
      submittedAt: "2026-08-16T12:00:00.000Z",
      updatedAt: "2026-08-16T12:01:00.000Z",
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain("ready_for_publication");

    const conflict = await app.inject({
      ...request,
      payload: { ...payload, posting: { ...payload.posting, title: "Changed" } },
    });
    expect(conflict.statusCode).toBe(409);
    const wrongScope = await app.inject({
      ...request,
      headers: { ...request.headers, authorization: `Bearer ${writeOnlyToken}` },
    });
    expect(wrongScope.statusCode).toBe(403);

    jobContributions.failure = Object.assign(new Error("must remain private"), {
      name: "JobContributionCapabilityDisabledError",
    });
    try {
      const disabled = await app.inject(request);
      expect(disabled.statusCode).toBe(503);
      expect(disabled.json()).toMatchObject({ code: "job_contribution_unavailable" });
      expect(disabled.body).not.toContain("capability");
      expect(disabled.body).not.toContain("client_disabled");
    } finally {
      jobContributions.failure = undefined;
    }
  });

  it("grants server-timed preview consent without accepting a client consent identity", async () => {
    const ownerToken = await issuer.issue("candidate-consent-owner", {
      scope: "jobs:contribute",
    });
    const otherToken = await issuer.issue("candidate-consent-other", {
      scope: "jobs:contribute",
    });
    const request = {
      method: "POST" as const,
      url: "/v1/profile/ugc-contribution-consents",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": "gateway-ugc-consent-grant-0001",
      },
      payload: {
        schemaVersion: 1,
        documentVersion: "ugc-contribution-preview.v1",
        policyVersion: "d2-synthetic-policy.v1",
        previewDigestSha256: "a".repeat(64),
      },
    };
    const granted = await app.inject(request);
    const replay = await app.inject(request);
    expect(granted.statusCode).toBe(201);
    expect(granted.headers["cache-control"]).toBe("no-store");
    expect(replay.json()).toEqual(granted.json());
    expect(granted.json()).toMatchObject({
      documentVersion: "ugc-contribution-preview.v1",
      grantedAt: now.toISOString(),
      policyVersion: "d2-synthetic-policy.v1",
      state: "granted",
    });
    expect(granted.json()).not.toHaveProperty("ownerUserId");
    expect(granted.json()).not.toHaveProperty("previewDigestSha256");

    const fabricated = await app.inject({
      ...request,
      headers: { ...request.headers, "idempotency-key": "gateway-ugc-consent-grant-0002" },
      payload: { ...request.payload, consentId: uuidv7(), grantedAt: now.toISOString() },
    });
    expect(fabricated.statusCode).toBe(400);

    const policyMismatch = await app.inject({
      ...request,
      headers: { ...request.headers, "idempotency-key": "gateway-ugc-consent-grant-0003" },
      payload: { ...request.payload, policyVersion: "unapproved-policy.v1" },
    });
    expect(policyMismatch.statusCode).toBe(503);

    const crossOwnerRevoke = await app.inject({
      method: "POST",
      url: `/v1/profile/ugc-contribution-consents/${granted.json().id}/revoke`,
      headers: {
        authorization: `Bearer ${otherToken}`,
        "idempotency-key": "gateway-ugc-consent-revoke-0001",
      },
      payload: { schemaVersion: 1 },
    });
    expect(crossOwnerRevoke.statusCode).toBe(409);
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/profile/ugc-contribution-consents/${granted.json().id}/revoke`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": "gateway-ugc-consent-revoke-0002",
      },
      payload: { schemaVersion: 1 },
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.headers["cache-control"]).toBe("no-store");
  });

  it("validates owner-bound cancellation, terminal conflicts and fail-closed no-store responses", async () => {
    const ownerToken = await issuer.issue("candidate-cancellation", { scope: "jobs:contribute" });
    const otherToken = await issuer.issue("other-cancellation", { scope: "jobs:contribute" });
    const scopeToken = await issuer.issue("candidate-cancellation", { scope: "jobs:read" });
    const owner = await store.resolveUser(await issuer.verifier.verify(ownerToken));
    const id = uuidv7();
    jobContributions.records.set(id, {
      ownerUserId: owner.id,
      contribution: {
        id,
        state: "awaiting_independent_verification",
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    const request = {
      method: "POST" as const,
      url: `/v1/jobs/contributions/${id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}`, "idempotency-key": `cancel-${id}` },
      payload: { schemaVersion: 1 },
    };
    const cross = await app.inject({
      ...request,
      headers: { ...request.headers, authorization: `Bearer ${otherToken}` },
    });
    expect(cross.statusCode).toBe(404);
    const forbidden = await app.inject({
      ...request,
      headers: { ...request.headers, authorization: `Bearer ${scopeToken}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      (await app.inject({ ...request, payload: { ...request.payload, ownerUserId: owner.id } }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ ...request, url: `${request.url}?owner=forged` })).statusCode).toBe(
      400,
    );
    const cancelled = await app.inject(request);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.headers["cache-control"]).toBe("no-store");
    expect(cancelled.json()).toEqual({
      id,
      state: "consent_invalid",
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect((await app.inject(request)).json()).toEqual(cancelled.json());
    const { JobContributionCancellationConflictError } = await import("@ai-job-apply/jobs-service");
    jobContributions.failure = new JobContributionCancellationConflictError();
    const conflict = await app.inject(request);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("job_contribution_requires_trust_withdrawal");
    jobContributions.failure = new Error("synthetic-private-database-canary");
    const unavailable = await app.inject(request);
    expect(unavailable.statusCode).toBe(500);
    expect(unavailable.body).not.toContain("synthetic-private-database-canary");
    jobContributions.failure = undefined;
  });

  it("rejects contribution payload leakage and incomplete preview approval", async () => {
    const token = await issuer.issue("candidate-contribution-invalid", {
      scope: "jobs:contribute",
    });
    const base = {
      schemaVersion: 1,
      contributionId: uuidv7(),
      client: { surface: "browser_extension", version: "0.1.0" },
      source: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        sourceUrl: "https://jobs.lever.co/synthetic/123",
        externalJobId: "123",
        adapterVersion: "d2-job-page-v1",
      },
      posting: {
        companyName: "Synthetic Company",
        title: "Engineer",
        locations: ["Remote - US"],
        description: "Generated public text.",
      },
      observation: {
        observedAt: "2026-08-16T11:59:00.000Z",
        contentSha256: "b".repeat(64),
      },
      approval: {
        consentId: uuidv7(),
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "ugc-policy-v1",
        approvedAt: "2026-08-16T12:00:00.000Z",
        approvedFields: [
          "provider",
          "pageVariant",
          "sourceUrl",
          "externalJobId",
          "companyName",
          "title",
          "locations",
          "description",
        ],
        previewDigestSha256: "0".repeat(64),
      },
    };
    base.observation.contentSha256 = createHash("sha256")
      .update(jobContributionContentDigestInput(base as CreateJobContributionCommand["input"]))
      .digest("hex");
    base.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(base as CreateJobContributionCommand["input"]))
      .digest("hex");
    for (const payload of [
      { ...base, rawHtml: "<form>private</form>" },
      { ...base, approval: { ...base.approval, approvedFields: ["sourceUrl"] } },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/jobs/contributions",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": `invalid-contribution-${crypto.randomUUID()}`,
        },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain("private");
    }
  });

  it("accepts only owner-self enum job reports behind jobs:write", async () => {
    const readToken = await issuer.issue("candidate-job-report-owner", { scope: "jobs:read" });
    const writeToken = await issuer.issue("candidate-job-report-owner", { scope: "jobs:write" });
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/jobs/${catalog.job.id}/reports`,
      headers: {
        authorization: `Bearer ${readToken}`,
        "idempotency-key": "job-report-gateway-forbidden-0001",
      },
      payload: { reason: "job_closed" },
    });
    const created = await app.inject({
      method: "POST",
      url: `/v1/jobs/${catalog.job.id}/reports`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        "idempotency-key": "job-report-gateway-create-0001",
      },
      payload: { reason: "job_closed" },
    });

    expect(forbidden.statusCode).toBe(403);
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json()).toMatchObject({
      requestedJobId: catalog.job.id,
      canonicalJobId: catalog.job.id,
      reason: "job_closed",
    });
    expect(created.json()).not.toHaveProperty("ownerUserId");
    expect(jobReports.lastCommand).toMatchObject({
      requestedJobId: catalog.job.id,
      reason: "job_closed",
      idempotencyKey: "job-report-gateway-create-0001",
    });
    expect(jobReports.lastCommand?.ownerUserId).toMatch(/-7/);
  });

  it("rejects report query, owner injection, free text, malformed identity, and missing idempotency", async () => {
    const token = await issuer.issue("candidate-job-report-invalid", { scope: "jobs:write" });
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "job-report-gateway-invalid-0001",
    };
    for (const request of [
      { url: `/v1/jobs/${catalog.job.id}/reports?source=user`, payload: { reason: "job_closed" } },
      {
        url: `/v1/jobs/${catalog.job.id}/reports`,
        payload: { reason: "job_closed", ownerUserId: uuidv7() },
      },
      {
        url: `/v1/jobs/${catalog.job.id}/reports`,
        payload: { reason: "other", detail: "candidate text" },
      },
      { url: `/v1/jobs/${crypto.randomUUID()}/reports`, payload: { reason: "job_closed" } },
    ]) {
      const response = await app.inject({ method: "POST", headers, ...request });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const missingKey = await app.inject({
      method: "POST",
      url: `/v1/jobs/${catalog.job.id}/reports`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "job_closed" },
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it.each([
    [new JobReportTargetUnavailableError(), 404, "job_report_target_unavailable"],
    [new JobReportIdempotencyConflictError(), 409, "idempotency_conflict"],
    [new JobAlreadyReportedError(), 409, "job_already_reported"],
    [new JobReportLimitError(), 409, "job_report_limit_reached"],
    [new JobReportServiceUnavailableError(), 503, "job_reporting_unavailable"],
  ])("maps private job-report failures to stable problems", async (failure, status, code) => {
    jobReports.failure = failure;
    const token = await issuer.issue(`candidate-job-report-${code}`, { scope: "jobs:write" });
    const response = await app.inject({
      method: "POST",
      url: `/v1/jobs/${catalog.job.id}/reports`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": `job-report-gateway-${code}-0001`,
      },
      payload: { reason: "job_inaccurate" },
    });
    jobReports.failure = undefined;

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code, status });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("fails closed when a report implementation adds private fields", async () => {
    jobReports.malformed = {
      id: uuidv7(),
      requestedJobId: catalog.job.id,
      canonicalJobId: catalog.job.id,
      reason: "job_closed",
      createdAt: "2026-08-16T12:00:00.000Z",
      reporterUserId: uuidv7(),
    } as unknown as JobReport;
    const token = await issuer.issue("candidate-job-report-malformed", { scope: "jobs:write" });
    const response = await app.inject({
      method: "POST",
      url: `/v1/jobs/${catalog.job.id}/reports`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "job-report-gateway-malformed-0001",
      },
      payload: { reason: "job_closed" },
    });
    jobReports.malformed = undefined;

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("reporterUserId");
  });

  it("keeps human moderation behind jobs:moderate and excludes operator identities", async () => {
    const subject = "auth0|synthetic-moderator";
    const moderateToken = await issuer.issue(subject, { scope: "jobs:moderate" });
    const candidateToken = await issuer.issue("candidate-not-moderator", { scope: "jobs:write" });
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/admin/moderation/cases",
      headers: { authorization: `Bearer ${candidateToken}` },
      payload: {
        target: { kind: "job", jobId: catalog.job.id },
        reasonCode: "candidate_reports",
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const opened = await app.inject({
      method: "POST",
      url: "/v1/admin/moderation/cases",
      headers: { authorization: `Bearer ${moderateToken}` },
      payload: {
        target: { kind: "job", jobId: catalog.job.id },
        reasonCode: "candidate_reports",
      },
    });
    expect(opened.statusCode).toBe(201);
    expect(opened.headers["cache-control"]).toBe("no-store");
    expect(opened.json()).toMatchObject({
      target: { kind: "job", jobId: catalog.job.id },
      status: "open",
      version: 0,
    });
    expect(opened.json()).not.toHaveProperty("openedBy");
    expect(moderation.lastOperatorId).toMatch(/^oidc:[a-f0-9]{64}$/);
    expect(moderation.lastOperatorId).not.toContain(subject);

    const searched = await app.inject({
      method: "POST",
      url: "/v1/admin/moderation/cases/search",
      headers: { authorization: `Bearer ${moderateToken}` },
      payload: { status: "open", pageSize: 25 },
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().items).toHaveLength(1);
    expect(JSON.stringify(searched.json())).not.toContain("openedBy");

    const summary = await app.inject({
      method: "GET",
      url: `/v1/admin/moderation/jobs/${catalog.job.id}/report-summary`,
      headers: { authorization: `Bearer ${moderateToken}` },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ canonicalJobId: catalog.job.id, total: 2 });

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/admin/moderation/cases/${opened.json().id}/resolve`,
      headers: { authorization: `Bearer ${moderateToken}` },
      payload: {
        expectedVersion: 0,
        resolution: "block_job",
        reasonCode: "report_confirmed",
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: "resolved", version: 1 });
    expect(resolved.json()).not.toHaveProperty("resolvedBy");
  });

  it("rejects mismatched moderation reasons and actions before persistence", async () => {
    const token = await issuer.issue("synthetic-moderator-invalid", { scope: "jobs:moderate" });
    const headers = { authorization: `Bearer ${token}` };
    const invalidOpen = await app.inject({
      method: "POST",
      url: "/v1/admin/moderation/cases",
      headers,
      payload: {
        target: {
          kind: "source",
          sourceId: "synthetic-generated",
          adapterVersion: "v1",
          adapterConfigSha256: "1".repeat(64),
        },
        reasonCode: "candidate_reports",
      },
    });
    expect(invalidOpen.statusCode).toBe(400);

    const invalidResolution = await app.inject({
      method: "POST",
      url: `/v1/admin/moderation/cases/${uuidv7()}/resolve`,
      headers,
      payload: {
        expectedVersion: 0,
        resolution: "pause_source",
        reasonCode: "report_confirmed",
      },
    });
    expect(invalidResolution.statusCode).toBe(400);
  });

  it("creates, replays, reads, and deletes a private capture with exact owner isolation", async () => {
    const subject = "candidate-private-capture-owner";
    const readToken = await issuer.issue(subject, { scope: "jobs:read" });
    const writeToken = await issuer.issue(subject, { scope: "jobs:write" });
    const otherReadToken = await issuer.issue("candidate-private-capture-other", {
      scope: "jobs:read",
    });
    const otherWriteToken = await issuer.issue("candidate-private-capture-other", {
      scope: "jobs:write",
    });
    const captureId = uuidv7();
    const payload: CreatePrivateSavedPageCaptureRequest = {
      schemaVersion: 1,
      captureId,
      source: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        sourceUrl: `https://jobs.eu.lever.co/synthetic/${captureId}`,
        adapterVersion: "d2-job-page-v1",
      },
      snapshot: {
        title: "Synthetic Software Engineer",
        company: "Synthetic Company",
        location: "Remote",
        description: "Generated test fixture.",
        externalJobId: captureId,
      },
      capturedAt: "2026-08-16T11:59:00.000Z",
    };
    const headers = {
      authorization: `Bearer ${writeToken}`,
      "idempotency-key": "private-capture-gateway-create-0001",
    };

    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/saved-job-captures",
      headers: {
        authorization: `Bearer ${readToken}`,
        "idempotency-key": "private-capture-gateway-forbidden-0001",
      },
      payload,
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/saved-job-captures",
      headers,
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json()).toMatchObject({
      schemaVersion: 1,
      id: captureId,
      source: payload.source,
      snapshot: payload.snapshot,
      capturedAt: payload.capturedAt,
    });
    expect(created.json()).not.toHaveProperty("captureId");
    expect(created.json()).not.toHaveProperty("ownerUserId");
    expect(created.json()).not.toHaveProperty("verificationEvidenceId");

    const replayed = await app.inject({
      method: "POST",
      url: "/v1/saved-job-captures",
      headers,
      payload,
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toEqual(created.json());

    const ownerRead = await app.inject({
      method: "GET",
      url: `/v1/saved-job-captures/${captureId}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.headers["cache-control"]).toBe("no-store");
    expect(ownerRead.json()).toEqual(created.json());

    const crossOwnerRead = await app.inject({
      method: "GET",
      url: `/v1/saved-job-captures/${captureId}`,
      headers: { authorization: `Bearer ${otherReadToken}` },
    });
    expect(crossOwnerRead.statusCode).toBe(404);
    expect(crossOwnerRead.json().code).toBe("not_found");

    const crossOwnerDelete = await app.inject({
      method: "DELETE",
      url: `/v1/saved-job-captures/${captureId}`,
      headers: { authorization: `Bearer ${otherWriteToken}` },
    });
    expect(crossOwnerDelete.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/saved-job-captures/${captureId}`,
          headers: { authorization: `Bearer ${readToken}` },
        })
      ).statusCode,
    ).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/saved-job-captures/${captureId}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers["cache-control"]).toBe("no-store");
    const absent = await app.inject({
      method: "GET",
      url: `/v1/saved-job-captures/${captureId}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(absent.statusCode).toBe(404);
  });

  it("keeps saved-job mutations behind jobs:write and reads owner-scoped with jobs:read", async () => {
    const readToken = await issuer.issue("candidate-saved-owner", { scope: "jobs:read" });
    const writeToken = await issuer.issue("candidate-saved-owner", { scope: "jobs:write" });
    const createPayload = { jobId: catalog.job.id };
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs",
      headers: {
        authorization: `Bearer ${readToken}`,
        "idempotency-key": "saved-job-gateway-forbidden-0001",
      },
      payload: createPayload,
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "idempotency-key": ["saved-job-gateway-create-0001"],
      },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json()).toMatchObject({ requestedJobId: catalog.job.id });
    expect(created.json()).not.toHaveProperty("ownerUserId");

    const listed = await app.inject({
      method: "POST",
      url: "/v1/saved-jobs/search",
      headers: { authorization: `Bearer ${readToken}` },
      payload: { pageSize: 25 },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().items).toHaveLength(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/saved-jobs/${created.json().id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    const repeated = await app.inject({
      method: "DELETE",
      url: `/v1/saved-jobs/${created.json().id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers["cache-control"]).toBe("no-store");
    expect(repeated.statusCode).toBe(204);
    expect(repeated.headers["cache-control"]).toBe("no-store");

    for (const [failure, code] of [
      [new SavedJobLimitError(), "saved_job_limit_reached"],
      [new SavedJobIdempotencyLimitError(), "saved_job_command_limit_reached"],
    ] as const) {
      savedJobs.createFailure = failure;
      const limited = await app.inject({
        method: "POST",
        url: "/v1/saved-jobs",
        headers: {
          authorization: `Bearer ${writeToken}`,
          "idempotency-key": `saved-job-gateway-limit-${code}`,
        },
        payload: createPayload,
      });
      expect(limited.statusCode).toBe(409);
      expect(limited.headers["cache-control"]).toBe("no-store");
      expect(limited.json()).toMatchObject({ code });
    }
    savedJobs.createFailure = undefined;
  });

  it("registers and lists resume uploads without proxying candidate bytes", async () => {
    const token = await issuer.issue("candidate-resume", {
      scope: "documents:read documents:write",
    });
    const authorization = { authorization: `Bearer ${token}` };
    const payload: CreateResumeUploadRequest = {
      fileName: "synthetic-resume.pdf",
      mediaType: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/resumes/uploads",
      headers: { ...authorization, "idempotency-key": "resume-upload-test-0001" },
      payload,
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/resumes",
      headers: authorization,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      document: { ...payload, status: "awaiting_upload" },
      upload: { method: "POST" },
    });
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json().document).not.toHaveProperty("sourceObjectKey");
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().documents).toHaveLength(1);

    const missingScope = await issuer.issue("candidate-resume-no-scope", {
      scope: "profile:read",
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/resumes",
      headers: { authorization: `Bearer ${missingScope}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("enforces read and write scopes at the application boundary", async () => {
    const readOnlyToken = await issuer.issue("candidate-read-only", { scope: "profile:read" });
    const writeOnlyToken = await issuer.issue("candidate-write-only", { scope: "profile:write" });
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };

    const write = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: {
        authorization: `Bearer ${readOnlyToken}`,
        "idempotency-key": "scope-denial-test-0001",
      },
      payload,
    });
    const read = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${writeOnlyToken}` },
    });

    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe("forbidden");
    expect(write.headers["cache-control"]).toBe("no-store");
    expect(read.statusCode).toBe(403);
    expect(read.json().code).toBe("forbidden");
    expect(read.headers["cache-control"]).toBe("no-store");
  });

  it("rejects conflicting idempotency replays and incomplete command metadata", async () => {
    const token = await issuer.issue("candidate-idempotency");
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "conflict-test-key-0001",
    };
    const payload = {
      targetRoles: ["Software Engineer"],
      locations: [],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const accepted = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload,
    });
    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers,
      payload: { ...payload, targetRoles: ["Platform Engineer"] },
    });
    const missingKey = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(accepted.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("idempotency_conflict");
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().code).toBe("invalid_request");
  });

  it("rejects removed post-submission fields", async () => {
    const token = await issuer.issue("candidate-1");
    const response = await app.inject({
      method: "PUT",
      url: "/v1/me/job-preferences",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "foundation-test-key-0002",
      },
      payload: {
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        interviewStatus: "scheduled",
      },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("Phase 2 Trust routes", () => {
  const caseId = "019c0000-0000-8000-8000-000000000201";
  const contributionId = "019c0000-0000-7000-8000-000000000202";
  const reviewerCase: TrustCase = {
    id: caseId,
    contributionId,
    contributorUserId: "019c0000-0000-7000-8000-000000000203",
    policyVersion: "d2-synthetic-policy.v1",
    appealWindowMilliseconds: 86_400_000,
    state: "accepted",
    version: 2,
    appealCount: 0,
    adverseDecision: null,
    pendingAppealEvidenceDigestSha256: null,
    independentEvidenceDigestSha256: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T13:00:00.000Z"),
  };

  function fakeTrust(observedOwners: string[]): TrustApplicationService {
    const ownerView = {
      id: caseId,
      contributionId,
      state: "accepted" as const,
      policyVersion: "d2-synthetic-policy.v1",
      version: 2,
      appealed: false,
      appealDeadlineAt: null,
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T13:00:00.000Z",
    };
    return {
      async readOwnerCase(input: { contributorUserId: string; contributionId: string }) {
        observedOwners.push(input.contributorUserId);
        if (input.contributionId !== contributionId) {
          throw new TrustApplicationError("not_found");
        }
        return ownerView;
      },
      async withdrawOwnerContribution() {
        return { ...ownerView, state: "withdrawn" as const, version: 3 };
      },
      async appealOwnerDecision() {
        return { ...ownerView, state: "appeal_pending" as const, version: 3, appealed: true };
      },
      async readReviewerCase() {
        return reviewerCase;
      },
      async listReviewerCases() {
        return { items: [{ ...reviewerCase, state: "needs_review" }] };
      },
      async readReviewerEvidence() {
        return {
          caseId,
          caseVersion: 2,
          evidence: {
            contributionId,
            evidenceDigestSha256: "a".repeat(64),
            verifiedAt: "2026-09-05T12:00:00.000Z",
            provider: "greenhouse",
            sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
            title: "Synthetic role",
            companyName: "Synthetic company",
            locations: [],
            description: "Complete independently verified public content.",
          },
        };
      },
      async openReview() {
        return { ...reviewerCase, state: "needs_review" as const, version: 1 };
      },
      async decideInitialReview() {
        return reviewerCase;
      },
      async takeDownAcceptedContribution() {
        return { ...reviewerCase, state: "taken_down" as const, version: 3 };
      },
      async resolveAppeal() {
        return { ...reviewerCase, version: 4 };
      },
    } as unknown as TrustApplicationService;
  }

  it("derives the candidate owner and returns only the fixed owner projection", async () => {
    const observedOwners: string[] = [];
    const setup = await createApp({ trust: fakeTrust(observedOwners) });
    try {
      const token = await setup.issuer.issue("trust-owner", { scope: "jobs:contribute" });
      const response = await setup.app.inject({
        method: "GET",
        url: `/v1/trust/contributions/${contributionId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(observedOwners).toHaveLength(1);
      expect(response.json()).not.toHaveProperty("contributorUserId");
      expect(response.json()).not.toHaveProperty("reviewerId");
      expect(response.json()).not.toHaveProperty("evidenceDigestSha256");

      const missing = await setup.app.inject({
        method: "GET",
        url: "/v1/trust/contributions/019c0000-0000-7000-8000-000000000299",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers["cache-control"]).toBe("no-store");
      expect(missing.json()).toEqual(
        expect.objectContaining({ code: "trust_case_not_found", title: "Trust case not found" }),
      );
      expect(JSON.stringify(missing.json())).not.toContain(caseId);
    } finally {
      await setup.app.close();
    }
  });

  it("requires both exact OIDC scopes and explicit reviewer roles", async () => {
    const reviewerSubject = "synthetic-trust-reviewer";
    const setup = await createApp({
      trust: fakeTrust([]),
      trustReviewerAssignments: [
        {
          issuer: "https://test-issuer.invalid/",
          subject: reviewerSubject,
          roles: ["case_reader", "initial_reviewer", "takedown_reviewer"],
        },
      ],
    });
    try {
      const readOnly = await setup.issuer.issue(reviewerSubject, { scope: "trust:review" });
      const deniedDecision = await setup.app.inject({
        method: "POST",
        url: `/v1/admin/trust/cases/${caseId}/decision`,
        headers: { authorization: `Bearer ${readOnly}` },
        payload: {
          expectedVersion: 1,
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256: "a".repeat(64),
        },
      });
      expect(deniedDecision.statusCode).toBe(403);
      expect(deniedDecision.json().code).toBe("trust_access_denied");

      const decisionToken = await setup.issuer.issue(reviewerSubject, {
        scope: "trust:review trust:case:decide",
      });
      const accepted = await setup.app.inject({
        method: "POST",
        url: `/v1/admin/trust/cases/${caseId}/decision`,
        headers: { authorization: `Bearer ${decisionToken}` },
        payload: {
          expectedVersion: 1,
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256: "a".repeat(64),
        },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).not.toHaveProperty("contributorUserId");
      expect(accepted.json()).not.toHaveProperty("reviewerId");
    } finally {
      await setup.app.close();
    }
  });

  it("requires exact case-reader authority for bounded queues and readable evidence", async () => {
    const subject = "synthetic-trust-case-reader";
    const setup = await createApp({
      trust: fakeTrust([]),
      trustReviewerAssignments: [
        { issuer: "https://test-issuer.invalid/", subject, roles: ["case_reader"] },
      ],
    });
    try {
      const token = await setup.issuer.issue(subject, { scope: "trust:review" });
      for (const url of [
        "/v1/admin/trust/cases?state=needs_review&pageSize=25",
        `/v1/admin/trust/cases/${caseId}/evidence`,
      ]) {
        const response = await setup.app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).not.toContain("contributorUserId");
        expect(response.body).not.toContain("reviewerId");
        const unassigned = await setup.issuer.issue("unassigned-reviewer", {
          scope: "trust:review",
        });
        expect(
          (
            await setup.app.inject({
              method: "GET",
              url,
              headers: { authorization: `Bearer ${unassigned}` },
            })
          ).statusCode,
        ).toBe(403);
      }
      for (const query of [
        "pageSize=26",
        "query=unrestricted",
        "pageSize=01",
        "state=accepted",
        "state=needs_review&state=appeal_pending",
      ])
        expect(
          (
            await setup.app.inject({
              method: "GET",
              url: `/v1/admin/trust/cases?${query}`,
              headers: { authorization: `Bearer ${token}` },
            })
          ).statusCode,
        ).toBe(400);
    } finally {
      await setup.app.close();
    }
  });

  it("adds a separate verified-requester scope before the Trust authority recheck", async () => {
    const reviewerSubject = "synthetic-takedown-reviewer";
    const setup = await createApp({
      trust: fakeTrust([]),
      trustReviewerAssignments: [
        {
          issuer: "https://test-issuer.invalid/",
          subject: reviewerSubject,
          roles: ["takedown_reviewer"],
        },
      ],
    });
    try {
      const base = "trust:review trust:case:takedown";
      const payload = {
        expectedVersion: 2,
        reasonCode: "verified_requester_takedown",
        evidenceDigestSha256: "b".repeat(64),
      };
      const withoutRequester = await setup.issuer.issue(reviewerSubject, { scope: base });
      const denied = await setup.app.inject({
        method: "POST",
        url: `/v1/admin/trust/cases/${caseId}/takedown`,
        headers: { authorization: `Bearer ${withoutRequester}` },
        payload,
      });
      expect(denied.statusCode).toBe(403);

      const verified = await setup.issuer.issue(reviewerSubject, {
        scope: `${base} trust:requester:takedown`,
      });
      const accepted = await setup.app.inject({
        method: "POST",
        url: `/v1/admin/trust/cases/${caseId}/takedown`,
        headers: { authorization: `Bearer ${verified}` },
        payload,
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().state).toBe("taken_down");
    } finally {
      await setup.app.close();
    }
  });
});

describe("Applications routes", () => {
  const owner = "candidate-applications";
  const applicationId = "019d04cf-1f80-7000-8000-000000000101";
  const attemptId = "019d04cf-1f80-7000-8000-000000000102";
  const jobId = "019d04cf-1f80-7000-8000-000000000103";
  const hash = "a".repeat(64);
  const now = "2026-09-18T12:00:00.000Z";
  const application = {
    id: applicationId,
    canonicalJobId: jobId,
    status: "review_required",
    revision: 2,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: now,
    updatedAt: now,
  } as const;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let failure: Error | undefined;

  function record<T>(method: string, value: T) {
    return async (...args: unknown[]): Promise<T> => {
      calls.push({ method, args });
      if (failure) throw failure;
      return value;
    };
  }

  const applications: ApplicationsApi = {
    temporaryMaterialLocation: record("temporaryMaterialLocation", {
      schemaVersion: 1,
      packetId: jobId,
      packetHash: hash,
      temporaryMaterial: {
        schemaVersion: 1,
        kind: "cover_letter",
        generationId: attemptId,
        version: 1,
        contentSha256: hash,
        completedAtMs: 1000,
        expiresAtMs: 1_801_000,
      },
      origin: `https://${attemptId}.materials.example.test:8443`,
    } as const),
    resumeMaterialLocation: record("resumeMaterialLocation", {
      schemaVersion: 1,
      packetId: jobId,
      packetHash: hash,
      temporaryMaterial: {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: attemptId,
        version: 1,
        contentSha256: hash,
        completedAtMs: 1000,
        expiresAtMs: 1_801_000,
      },
      origin: `https://${attemptId}.materials.example.test:8443`,
    } as const),
    temporaryMaterialAuthorization: record("temporaryMaterialAuthorization", {
      schemaVersion: 1,
      packetId: jobId,
      packetHash: hash,
      temporaryMaterial: {
        schemaVersion: 1,
        kind: "cover_letter",
        generationId: attemptId,
        version: 1,
        contentSha256: hash,
        completedAtMs: 1000,
        expiresAtMs: 1_801_000,
      },
    } as const),
    resumeMaterialAuthorization: record("resumeMaterialAuthorization", {
      schemaVersion: 1,
      packetId: jobId,
      packetHash: hash,
      temporaryMaterial: {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: attemptId,
        version: 1,
        contentSha256: hash,
        completedAtMs: 1000,
        expiresAtMs: 1_801_000,
      },
    } as const),
    create: record("create", application),
    search: record("search", { items: [application] }),
    get: record("get", application),
    history: record("history", { entries: [], hasMore: false }),
    preparePacket: record("preparePacket", application),
    prepareCoverLetter: record("prepareCoverLetter", {
      id: attemptId,
      applicationId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    } as const),
    preparation: record("preparation", {
      id: attemptId,
      applicationId,
      state: "succeeded",
      result: { packetId: jobId, revision: 3 },
      createdAt: now,
      updatedAt: now,
    } as const),
    coverLetterPreview: record("coverLetterPreview", {
      status: "no_cover_letter",
      matchesPacket: false,
    } as const),
    coverLetterFile: record("coverLetterFile", {
      format: "pdf",
      mediaType: "application/pdf",
      fileName: "cover-letter.pdf",
      sha256: hash,
      sizeBytes: 4,
      contentSha256: hash,
      contentBase64: "dGVzdA==",
    } as const),
    uploadedResumeFile: record("uploadedResumeFile", {
      documentId: jobId,
      fileName: "Candidate Resume.pdf",
      format: "pdf",
      mediaType: "application/pdf",
      sha256: hash,
      sizeBytes: 4,
      contentBase64: "dGVzdA==",
    } as const),
    resumeFile: record("resumeFile", {
      format: "pdf",
      mediaType: "application/pdf",
      fileName: "tailored.pdf",
      sha256: hash,
      sizeBytes: 4,
      contentSha256: hash,
      contentBase64: "dGVzdA==",
    } as const),
    approve: record("approve", application),
    reopen: record("reopen", application),
    cancel: record("cancel", application),
    startSubmission: record("startSubmission", { outcome: "started", application }),
    startManualSubmission: record("startManualSubmission", {
      outcome: "started",
      attemptId,
      application,
    }),
    dispatchAttempt: record("dispatchAttempt", {
      id: attemptId,
      sequence: 1,
      status: "dispatched",
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
      startedAt: now,
    }),
    recordResult: record("recordResult", application),
    reconcile: record("reconcile", application),
    narrativeAnswer: record("narrativeAnswer", {
      status: "ready",
      text: "I build reliable TypeScript services.",
      promptVersion: "1.1.0",
    } as const),
  } as unknown as ApplicationsApi;

  let app: Awaited<ReturnType<typeof createApp>>["app"];
  let issuer: Awaited<ReturnType<typeof createApp>>["issuer"];

  beforeAll(async () => {
    ({ app, issuer } = await createApp({ applications }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    calls.length = 0;
    failure = undefined;
  });

  const token = (scope: string) => issuer.issue(owner, { scope });
  const key = "applications-route-key-0001";

  it("forwards explicit saved-answer selection under the authenticated owner with no-store", async () => {
    const selection = {
      id: jobId,
      version: 1,
      fieldKey: "authorization.us_authorized",
      context: "us",
      questionHash: "a".repeat(64),
      meaningConfirmed: true,
    };
    const payload = {
      expectedRevision: 2,
      form: { adapterId: "greenhouse", variantId: "synthetic", formHash: "b".repeat(64) },
      vaultSelections: [selection],
    };
    const response = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/packets`,
      headers: {
        authorization: `Bearer ${await token("applications:write")}`,
        "idempotency-key": key,
      },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(calls[0]).toMatchObject({
      method: "preparePacket",
      args: [expect.any(String), applicationId, payload, key],
    });
  });

  describe("narrative answers", () => {
    const url = `/v1/applications/${applicationId}/narrative-answers`;
    const payload = { question: "What interests you about this role?" };

    it("drafts under the authenticated owner, with no-store, and never trusts a body owner", async () => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${await token("applications:write")}` },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({ status: "ready", promptVersion: "1.1.0" });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: "narrativeAnswer",
        args: [expect.any(String), applicationId, payload],
      });
      const rejected = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${await token("applications:write")}` },
        payload: { ...payload, ownerUserId: "someone-else" },
      });
      expect(rejected.statusCode).toBe(400);
      expect(calls).toHaveLength(1);
    });

    it.each([
      ["no token", undefined],
      ["a read-only token", "applications:read"],
    ])("refuses %s", async (_name, scope) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: scope ? { authorization: `Bearer ${await token(scope)}` } : {},
        payload,
      });
      expect([401, 403]).toContain(response.statusCode);
      expect(calls).toHaveLength(0);
    });

    it.each([
      ["a missing question", {}],
      ["a too short question", { question: "ab" }],
      ["an oversized question", { question: "q".repeat(1001) }],
      ["an oversized guidance", { question: "What interests you?", guidance: "g".repeat(1001) }],
    ])("rejects %s before the service", async (_name, body) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${await token("applications:write")}` },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it.each([
      [new NarrativeAnswerLimitError(30), 429, "narrative_answer_limit"],
      [new NarrativeAnswersUnavailableError(), 503, "narrative_answers_unavailable"],
      [new NarrativeAnswerStateError(), 409, "application_state_conflict"],
    ])("maps %o to fixed, value-free problem details", async (error, status, code) => {
      error.message = "synthetic-private-provider-text";
      failure = error;
      const response = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${await token("applications:write")}` },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code });
      expect(response.body).not.toContain("synthetic-private-provider-text");
    });
  });

  it("returns fixed private saved-answer guidance when dispatch refuses a changed selection", async () => {
    const changed = new StalePacketError(["vault_answer_changed"]);
    changed.message = "synthetic-private-vault-value";
    failure = changed;
    const response = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/attempts/${attemptId}/dispatch`,
      headers: { authorization: `Bearer ${await token("applications:read applications:write")}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      code: "application_packet_stale",
      title: "Saved answer changed",
    });
    expect(response.body).not.toContain(changed.message);
  });

  it("returns a sanitized no-store conflict when dispatch approval expired", async () => {
    const expired = new StalePacketError(["approval_expired"]);
    expired.message = "synthetic-private-expired-dispatch";
    failure = expired;
    const response = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/attempts/${attemptId}/dispatch`,
      headers: { authorization: `Bearer ${await token("applications:read applications:write")}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      code: "application_packet_stale",
      title: "Approval expired",
      detail: "The packet approval expired; review and approve it again",
    });
    expect(response.body).not.toContain(expired.message);
    expect(calls.map((call) => call.method)).toEqual(["dispatchAttempt"]);
  });

  it("accepts opted-in Prepare as 202 without falling through to synchronous packet creation", async () => {
    const request = {
      expectedRevision: 2,
      coverLetter: { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true } },
    };
    const response = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/packets`,
      headers: {
        authorization: `Bearer ${await token("applications:write")}`,
        "idempotency-key": key,
      },
      payload: request,
    });
    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ id: attemptId, state: "queued" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "prepareCoverLetter",
      args: [expect.any(String), applicationId, request, key],
    });
    calls.length = 0;
    const synchronous = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/packets`,
      headers: {
        authorization: `Bearer ${await token("applications:write")}`,
        "idempotency-key": key,
      },
      payload: { expectedRevision: 2 },
    });
    expect(synchronous.statusCode).toBe(201);
    expect(synchronous.json().id).toBe(applicationId);
    expect(calls[0]?.method).toBe("preparePacket");
  });

  it("serves owner-scoped preparation status, preview and selected file with no-store", async () => {
    const headers = { authorization: `Bearer ${await token("applications:read")}` };
    for (const [suffix, method, result] of [
      [
        `packet-preparations/${attemptId}`,
        "preparation",
        { state: "succeeded", result: { packetId: jobId, revision: 3 } },
      ],
      ["cover-letter", "coverLetterPreview", { status: "no_cover_letter", matchesPacket: false }],
      ["cover-letter/file?format=pdf", "coverLetterFile", { format: "pdf", contentSha256: hash }],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/applications/${applicationId}/${suffix}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject(result);
      expect(calls.at(-1)).toMatchObject({
        method,
        args: [
          expect.any(String),
          applicationId,
          ...(method === "preparation" ? [attemptId] : method === "coverLetterFile" ? ["pdf"] : []),
          ...(method === "coverLetterPreview" || method === "coverLetterFile"
            ? [expect.any(AbortSignal)]
            : []),
        ],
      });
    }
  });

  it.each([
    "cover-letter/authorization",
    "cover-letter/location",
    "resume/authorization",
    "resume/location",
  ])("serves scalar native %s with resolved owner and no-store", async (route) => {
    const result = await app.inject({
      method: "GET",
      url: `/v1/applications/${applicationId}/${route}?generationId=${attemptId}`,
      headers: { authorization: `Bearer ${await token("applications:read")}` },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.json().packetHash).toBe(hash);
    expect(result.json()).not.toHaveProperty("data");
    expect(calls).toEqual([
      {
        method:
          route === "cover-letter/location"
            ? "temporaryMaterialLocation"
            : route === "resume/location"
              ? "resumeMaterialLocation"
              : route === "resume/authorization"
                ? "resumeMaterialAuthorization"
                : "temporaryMaterialAuthorization",
        args: [expect.any(String), applicationId, attemptId, expect.any(AbortSignal)],
      },
    ]);
  });

  it.each([
    "cover-letter/authorization",
    "cover-letter/location",
    "resume/authorization",
    "resume/location",
  ])("rejects malformed scalar %s queries before owner service access", async (route) => {
    for (const suffix of [
      "",
      "?generationId=bad",
      `?generationId=${attemptId}&owner=other`,
      `?generationId=${attemptId}&generationId=${jobId}`,
    ]) {
      const result = await app.inject({
        method: "GET",
        url: `/v1/applications/${applicationId}/${route}${suffix}`,
        headers: { authorization: `Bearer ${await token("applications:read")}` },
      });
      expect(result.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    "cover-letter/authorization",
    "cover-letter/location",
    "resume/authorization",
    "resume/location",
  ])("requires authenticated read scope for scalar %s", async (route) => {
    const url = `/v1/applications/${applicationId}/${route}?generationId=${attemptId}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${await token("profile:read")}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown, repeated and missing cover-letter read inputs before service access", async () => {
    const headers = { authorization: `Bearer ${await token("applications:read")}` };
    for (const suffix of [
      "cover-letter?owner=other",
      "cover-letter/file",
      "cover-letter/file?format=txt",
      "cover-letter/file?format=pdf&format=docx",
      "cover-letter/file?format=pdf&owner=other",
      `packet-preparations/${attemptId}?debug=1`,
      "packet-preparations/not-a-uuid",
    ]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/applications/${applicationId}/${suffix}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("requires applications read for cover-letter/status reads and write for opted-in Prepare", async () => {
    for (const suffix of [
      "cover-letter",
      "cover-letter/file?format=pdf",
      `packet-preparations/${attemptId}`,
    ]) {
      const url = `/v1/applications/${applicationId}/${suffix}`;
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: "GET",
            url,
            headers: { authorization: `Bearer ${await token("profile:read applications:write")}` },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/applications/${applicationId}/packets`,
          headers: {
            authorization: `Bearer ${await token("applications:read")}`,
            "idempotency-key": key,
          },
          payload: {
            expectedRevision: 2,
            coverLetter: {
              disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
            },
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects missing keys and non-affirmative or overridden disclosure before acceptance", async () => {
    const headers = {
      authorization: `Bearer ${await token("applications:write")}`,
      "idempotency-key": key,
    };
    for (const coverLetter of [
      {},
      { disclosure: { noticeVersion: "old", acknowledged: true } },
      { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: false } },
      {
        disclosure: {
          noticeVersion: "openai-cover-letter.v1",
          acknowledged: true,
          approvedAt: now,
        },
      },
      {
        disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
        model: "other",
      },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/applications/${applicationId}/packets`,
            headers,
            payload: { expectedRevision: 2, coverLetter },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/applications/${applicationId}/packets`,
          headers: { authorization: headers.authorization },
          payload: {
            expectedRevision: 2,
            coverLetter: {
              disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
            },
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("serves the candidate's own uploaded resume to its owner only, with no query and no-store", async () => {
    const read = { authorization: `Bearer ${await token("applications:read")}` };
    const response = await app.inject({
      method: "GET",
      url: `/v1/applications/${applicationId}/resume/uploaded`,
      headers: read,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      documentId: jobId,
      format: "pdf",
      mediaType: "application/pdf",
      sha256: hash,
    });
    // The owner is the authenticated candidate's resolved identity, never a request value.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("uploadedResumeFile");
    expect(calls[0]?.args[1]).toBe(applicationId);
    expect(calls[0]?.args[0]).not.toBe(applicationId);
    calls.length = 0;
    // The route takes no query, no body, and a malformed id never reaches the service.
    for (const request of [
      { method: "GET", url: `/v1/applications/${applicationId}/resume/uploaded?format=pdf` },
      { method: "GET", url: `/v1/applications/${applicationId}/resume/uploaded?owner=other` },
      { method: "GET", url: "/v1/applications/not-a-uuid/resume/uploaded" },
    ] as const) {
      expect(
        (await app.inject({ ...request, headers: read } as never)).statusCode,
        request.url,
      ).toBe(400);
    }
    expect(calls).toHaveLength(0);
    // A write-only token cannot read it, and an anonymous caller is refused.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/applications/${applicationId}/resume/uploaded`,
          headers: { authorization: `Bearer ${await token("applications:write")}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/applications/${applicationId}/resume/uploaded`,
        })
      ).statusCode,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("maps uploaded-resume failures to stable value-free problems", async () => {
    const read = { authorization: `Bearer ${await token("applications:read")}` };
    for (const [error, status, code] of [
      [new ApplicationNotFoundError(), 404, "application_not_found"],
      [new StalePacketError(["resume_changed"]), 409, "application_packet_stale"],
      [new ApplicationsUnavailableError(), 503, "applications_unavailable"],
    ] as const) {
      failure = error;
      const response = await app.inject({
        method: "GET",
        url: `/v1/applications/${applicationId}/resume/uploaded`,
        headers: read,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code });
      expect(response.body).not.toContain("Candidate Resume");
    }
  });

  it("serves a generated resume only as PDF", async () => {
    const read = { authorization: `Bearer ${await token("applications:read")}` };
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/applications/${applicationId}/resume/file?format=pdf`,
          headers: read,
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "resumeFile" });
    expect(calls.at(-1)?.args.slice(-2)).toEqual([applicationId, "pdf"]);
    calls.length = 0;
    for (const format of ["docx", "exe", ""]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/applications/${applicationId}/resume/file?format=${format}`,
            headers: read,
          })
        ).statusCode,
        format,
      ).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("accepts the uploaded-resume option and maps an oversized file to its own code", async () => {
    const write = {
      authorization: `Bearer ${await token("applications:write")}`,
      "idempotency-key": key,
    };
    const url = `/v1/applications/${applicationId}/packets`;
    const ok = await app.inject({
      method: "POST",
      url,
      headers: write,
      payload: { expectedRevision: 2, resume: "uploaded" },
    });
    expect(ok.statusCode).toBe(201);
    expect(calls.at(-1)).toMatchObject({ method: "preparePacket" });
    expect(JSON.stringify(calls.at(-1)?.args)).toContain('"resume":"uploaded"');
    for (const resume of ["docx", "tailored", 1, null]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: write,
            payload: { expectedRevision: 2, resume },
          })
        ).statusCode,
        String(resume),
      ).toBe(400);
    }
    failure = new UploadedResumeTooLargeError();
    const tooLarge = await app.inject({
      method: "POST",
      url,
      headers: write,
      payload: { expectedRevision: 2, resume: "uploaded" },
    });
    expect(tooLarge.statusCode).toBe(409);
    expect(tooLarge.json()).toMatchObject({ code: "application_resume_too_large" });
    expect(JSON.stringify(tooLarge.json().detail)).not.toMatch(/bytes|\d{6,}/u);
  });

  it("maps a foreign or missing preparation to the same non-reflecting owner failure", async () => {
    failure = new PreparationNotFoundError();
    const response = await app.inject({
      method: "GET",
      url: `/v1/applications/${applicationId}/packet-preparations/${attemptId}`,
      headers: { authorization: `Bearer ${await token("applications:read")}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "application_not_found" });
    expect(response.body).not.toContain(attemptId);
  });

  it("fails all new endpoints closed when Applications is unavailable", async () => {
    const setup = await createApp();
    try {
      const read = {
        authorization: `Bearer ${await setup.issuer.issue(owner, { scope: "applications:read" })}`,
      };
      for (const suffix of [
        "cover-letter",
        "cover-letter/file?format=pdf",
        `packet-preparations/${attemptId}`,
      ]) {
        expect(
          (
            await setup.app.inject({
              method: "GET",
              url: `/v1/applications/${applicationId}/${suffix}`,
              headers: read,
            })
          ).statusCode,
        ).toBe(503);
      }
      const response = await setup.app.inject({
        method: "POST",
        url: `/v1/applications/${applicationId}/packets`,
        headers: {
          authorization: `Bearer ${await setup.issuer.issue(owner, { scope: "applications:write" })}`,
          "idempotency-key": key,
        },
        payload: {
          expectedRevision: 2,
          coverLetter: {
            disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
          },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "applications_unavailable" });
    } finally {
      await setup.app.close();
    }
  });

  it("requires the exact applications scope and rejects a profile or jobs scope", async () => {
    for (const wrong of ["profile:read profile:write", "jobs:read jobs:write"]) {
      const bearer = await token(wrong);
      const read = await app.inject({
        method: "GET",
        url: `/v1/applications/${applicationId}`,
        headers: { authorization: `Bearer ${bearer}` },
      });
      const write = await app.inject({
        method: "POST",
        url: "/v1/applications",
        headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key },
        payload: { jobId },
      });
      expect(read.statusCode).toBe(403);
      expect(write.statusCode).toBe(403);
    }
    // A read scope cannot mutate.
    const readOnly = await token("applications:read");
    const denied = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/cancel`,
      headers: { authorization: `Bearer ${readOnly}`, "idempotency-key": key },
      payload: { expectedRevision: 2 },
    });
    expect(denied.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
    expect(
      (await app.inject({ method: "GET", url: `/v1/applications/${applicationId}` })).statusCode,
    ).toBe(401);
  });

  it("serves owner-scoped reads and commands with no-store and validated bodies", async () => {
    const write = { authorization: `Bearer ${await token("applications:write")}` };
    const read = { authorization: `Bearer ${await token("applications:read")}` };

    const created = await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { ...write, "idempotency-key": key },
      payload: { jobId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json()).toMatchObject({ id: applicationId, status: "review_required" });

    for (const [url, method, payload, headers] of [
      ["/v1/applications/search", "POST", { limit: 10 }, read],
      ["/v1/applications/search", "POST", { jobId, limit: 5 }, read],
      [`/v1/applications/${applicationId}`, "GET", undefined, read],
      [`/v1/applications/${applicationId}/history?afterSeq=1&limit=5`, "GET", undefined, read],
      [`/v1/applications/${applicationId}/packets`, "POST", { expectedRevision: 2 }, write],
      [
        `/v1/applications/${applicationId}/approval`,
        "POST",
        { expectedRevision: 2, packetHash: hash, acknowledgedFieldKeys: [] },
        write,
      ],
      [`/v1/applications/${applicationId}/reopen`, "POST", { expectedRevision: 2 }, write],
      [`/v1/applications/${applicationId}/cancel`, "POST", { expectedRevision: 2 }, write],
      [
        `/v1/applications/${applicationId}/submissions`,
        "POST",
        {
          expectedRevision: 2,
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          observedFormHash: hash,
        },
        write,
      ],
      [
        `/v1/applications/${applicationId}/manual-submissions`,
        "POST",
        { expectedRevision: 2 },
        write,
      ],
      [
        `/v1/applications/${applicationId}/attempts/${attemptId}/dispatch`,
        "POST",
        undefined,
        write,
      ],
      [
        `/v1/applications/${applicationId}/attempts/${attemptId}/result`,
        "POST",
        { kind: "timeout" },
        write,
      ],
      [
        `/v1/applications/${applicationId}/attempts/${attemptId}/reconciliation`,
        "POST",
        { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true },
        write,
      ],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: method === "POST" && payload ? { ...headers, "idempotency-key": key } : headers,
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBeLessThan(300);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    // The authenticated owner, never a caller-supplied one, reaches the service.
    const owners = new Set(calls.map((call) => call.args[0]));
    expect(owners.size).toBe(1);
    expect(calls.find((call) => call.method === "history")?.args[2]).toEqual({
      afterSeq: 1,
      limit: 5,
    });
    // The job filter reaches the service exactly as sent.
    expect(calls.filter((call) => call.method === "search").map((call) => call.args[1])).toEqual([
      { limit: 10 },
      { jobId, limit: 5 },
    ]);
    for (const payload of [{ jobId: "not-a-uuid" }, { jobId, canonicalJobId: jobId }]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/v1/applications/search",
        headers: read,
        payload,
      });
      expect(rejected.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("starts a candidate-attested manual submission with the exact owner-scoped command", async () => {
    const bearer = await token("applications:write");
    const response = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/manual-submissions`,
      headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key },
      payload: { expectedRevision: 2 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ outcome: "started", attemptId });
    expect(calls).toEqual([
      {
        method: "startManualSubmission",
        args: [expect.any(String), applicationId, { expectedRevision: 2 }, key],
      },
    ]);
  });

  it("requires applications:write and a strict body for manual submission starts", async () => {
    const readOnly = await token("applications:read");
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/manual-submissions`,
      headers: { authorization: `Bearer ${readOnly}`, "idempotency-key": key },
      payload: { expectedRevision: 2 },
    });
    expect(forbidden.statusCode).toBe(403);

    const write = await token("applications:write");
    for (const payload of [{}, { expectedRevision: 2, adapterId: "manual" }]) {
      const invalid = await app.inject({
        method: "POST",
        url: `/v1/applications/${applicationId}/manual-submissions`,
        headers: { authorization: `Bearer ${write}`, "idempotency-key": key },
        payload,
      });
      expect(invalid.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects missing idempotency keys, malformed bodies, unknown fields, and bad identifiers", async () => {
    const write = { authorization: `Bearer ${await token("applications:write")}` };
    const read = { authorization: `Bearer ${await token("applications:read")}` };
    const cases = [
      { method: "POST", url: "/v1/applications", headers: write, payload: { jobId } },
      {
        method: "POST",
        url: "/v1/applications",
        headers: { ...write, "idempotency-key": key },
        payload: { jobId, status: "applied" },
      },
      {
        method: "POST",
        url: "/v1/applications",
        headers: { ...write, "idempotency-key": key },
        payload: { jobId: "not-a-uuid" },
      },
      {
        method: "POST",
        url: `/v1/applications/${applicationId}/approval`,
        headers: { ...write, "idempotency-key": key },
        payload: {
          expectedRevision: 2,
          packetHash: hash,
          acknowledgedFieldKeys: [],
          acknowledgeAll: true,
        },
      },
      {
        method: "POST",
        url: `/v1/applications/${applicationId}/attempts/${attemptId}/result`,
        headers: { ...write, "idempotency-key": key },
        payload: { kind: "interview_invited" },
      },
      { method: "GET", url: "/v1/applications/not-a-uuid", headers: read },
      { method: "GET", url: `/v1/applications/${applicationId}/history?limit=999`, headers: read },
      {
        method: "GET",
        url: `/v1/applications/${applicationId}/history?owner=other`,
        headers: read,
      },
      { method: "GET", url: `/v1/applications/${applicationId}?debug=1`, headers: read },
    ] as const;
    for (const request of cases) {
      const response = await app.inject(request as never);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("maps Applications failures to stable value-free problem details", async () => {
    const write = { authorization: `Bearer ${await token("applications:write")}` };
    const cancel = () =>
      app.inject({
        method: "POST",
        url: `/v1/applications/${applicationId}/cancel`,
        headers: { ...write, "idempotency-key": key },
        payload: { expectedRevision: 2 },
      });
    for (const [error, status, code] of [
      [new ApplicationNotFoundError(), 404, "application_not_found"],
      [new ApplicationRevisionConflictError(), 409, "application_revision_conflict"],
      [
        new ApprovalRefusedError("UNACKNOWLEDGED_FIELD", ["authorization.us_authorized"]),
        409,
        "application_approval_refused",
      ],
      [new AttemptRefusedError("AMBIGUOUS_UNRECONCILED"), 409, "application_attempt_refused"],
      [new ApplicationsUnavailableError(), 503, "applications_unavailable"],
      [new RestrictedPacketStoreUnavailableError(), 503, "applications_unavailable"],
    ] as const) {
      failure = error;
      const response = await cancel();
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code });
      // Field keys and candidate values are never echoed.
      expect(response.body).not.toContain("authorization.us_authorized");
    }
  });

  it("fails closed with 503 when no Applications store is wired", async () => {
    const { app: unwired, issuer: unwiredIssuer } = await createApp();
    const bearer = await unwiredIssuer.issue(owner, { scope: "applications:read" });
    const response = await unwired.inject({
      method: "GET",
      url: `/v1/applications/${applicationId}`,
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "applications_unavailable" });
    await unwired.close();
  });

  it("fails a manual submission start closed when no Applications store is wired", async () => {
    const { app: unwired, issuer: unwiredIssuer } = await createApp();
    const bearer = await unwiredIssuer.issue(owner, { scope: "applications:write" });
    const response = await unwired.inject({
      method: "POST",
      url: `/v1/applications/${applicationId}/manual-submissions`,
      headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key },
      payload: { expectedRevision: 2 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "applications_unavailable" });
    await unwired.close();
  });
});

const applicationsDatabaseUrl = process.env.DATABASE_URL;

(applicationsDatabaseUrl ? describe : describe.skip)(
  "Applications end to end over HTTP with PostgreSQL",
  () => {
    const hash = "b".repeat(64);
    const jobId = "019d04cf-1f80-7000-8000-0000000000e1";
    const client = postgres(applicationsDatabaseUrl ?? "postgres://invalid", {
      max: 4,
      onnotice: () => undefined,
    });
    let jobTitle = "Backend Engineer";
    // The Documents runtime is faked at its wire boundary: the Gateway only ever sees this contract.
    type TailoringBehavior =
      | { kind: "ready"; contentSha256: string }
      | { kind: "no_resume" }
      | { kind: "down" };
    let tailoringBehavior: TailoringBehavior = { kind: "ready", contentSha256: "c".repeat(64) };
    const tailoringCalls: Array<Record<string, unknown>> = [];
    let app: Awaited<ReturnType<typeof createApp>>["app"];
    let issuer: Awaited<ReturnType<typeof createApp>>["issuer"];

    beforeAll(async () => {
      const execFileAsync = promisify(execFile);
      await execFileAsync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../services/applications/dist/src/migrate.js", import.meta.url),
          ),
        ],
        { env: { ...process.env, DATABASE_URL: applicationsDatabaseUrl } },
      );
      const taxonomy = JSON.parse(
        await readFile(
          fileURLToPath(
            new URL("../../../data/taxonomies/application-fields.v1.json", import.meta.url),
          ),
          "utf8",
        ),
      );
      const applications = createApplicationsRuntime({
        client,
        definitions: loadFieldDefinitions(taxonomy),
        profile: {
          async listGroundingFacts() {
            return [
              {
                id: "019d04cf-1f80-7000-8000-0000000000f1",
                kind: "identity",
                key: "email",
                value: "synthetic.candidate@example.test",
                verification: "confirmed" as const,
                sensitivity: "confidential" as const,
                source: {
                  type: "user" as const,
                  reference: "profile-entry:personal:019d04cf-1f80-7000-8000-0000000000f2:v1",
                },
                version: 1,
              },
            ];
          },
        },
        tailoring: {
          async tailor(request) {
            tailoringCalls.push(request as unknown as Record<string, unknown>);
            if (tailoringBehavior.kind === "down") throw new Error("runtime unavailable");
            if (tailoringBehavior.kind === "no_resume") {
              return { schema: "resume-tailoring-result.v1", status: "no_resume" };
            }
            return {
              schema: "resume-tailoring-result.v1",
              status: "ready",
              baseDocument: {
                id: "019d04cf-1f80-7000-8000-0000000000d1",
                fileName: "synthetic-resume.pdf",
                version: 1,
                sha256: "d".repeat(64),
              },
              tailoringVersion: "tailoring.v1",
              contentSha256: tailoringBehavior.contentSha256,
              ...((request as { mode?: string }).mode === "artifact"
                ? {
                    artifact: {
                      format: "pdf" as const,
                      mediaType: "application/pdf" as const,
                      sha256: "f".repeat(64),
                      sizeBytes: 11,
                      contentBase64: Buffer.from("synthetic!!").toString("base64"),
                    },
                  }
                : {}),
              matchedTerms: ["typescript"],
              sections: [
                {
                  kind: "experience",
                  heading: "Experience",
                  entries: [
                    {
                      lines: ["Senior Engineer - Acme Corp"],
                      bullets: [
                        {
                          text: "Built a payments API in TypeScript serving 40 partners",
                          change: "moved_up",
                          matchedTerms: ["typescript"],
                        },
                        { text: "Maintained PostgreSQL clusters", change: "omitted" },
                      ],
                    },
                  ],
                },
              ],
            };
          },
        },
        catalog: {
          async getActiveJob() {
            return {
              id: jobId,
              company: { id: "019d04cf-1f80-7000-8000-0000000000e2", name: "Synthetic Co" },
              title: jobTitle,
              locations: ["Remote - US"],
              description: "Build payments APIs in TypeScript with PostgreSQL.",
              status: "active",
              firstObservedAt: new Date(),
              lastVerifiedAt: new Date(),
              expiresAt: new Date(Date.now() + 86_400_000),
              sources: [],
            } as never;
          },
          async resolveActiveJobSummaries() {
            return {
              catalogRevision: "r1",
              items: [
                {
                  requestedJobId: jobId,
                  job: {
                    id: jobId,
                    company: { id: "019d04cf-1f80-7000-8000-0000000000e2", name: "Synthetic Co" },
                    title: jobTitle,
                    locations: ["Remote - US"],
                    firstObservedAt: new Date(),
                    lastVerifiedAt: new Date(),
                    expiresAt: new Date(Date.now() + 86_400_000),
                  },
                },
              ],
            } as never;
          },
        },
      });
      ({ app, issuer } = await createApp({ applications }));
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await client.end({ timeout: 5 });
    });

    it("attaches the tailored resume, shows what changed, and expires approval when it changes", async () => {
      tailoringBehavior = { kind: "ready", contentSha256: "c".repeat(64) };
      tailoringCalls.length = 0;
      const bearer = await issuer.issue("candidate-e2e-resume", {
        scope: "applications:read applications:write",
      });
      const other = await issuer.issue("candidate-e2e-resume-other", {
        scope: "applications:read applications:write",
      });
      const send = async (
        token: string,
        method: "GET" | "POST",
        url: string,
        key: string,
        payload?: unknown,
      ) => {
        const response = await app.inject({
          method,
          url,
          headers:
            method === "POST"
              ? { authorization: `Bearer ${token}`, "idempotency-key": key }
              : { authorization: `Bearer ${token}` },
          ...(payload === undefined ? {} : { payload: payload as never }),
        });
        return {
          status: response.statusCode,
          body: response.json() as ReturnType<typeof JSON.parse>,
        };
      };
      const unique = (label: string) =>
        `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`.padEnd(20, "x");
      const form = { adapterId: "greenhouse", variantId: "board-v1", formHash: hash };

      const created = await send(bearer, "POST", "/v1/applications", unique("rc"), { jobId });
      const id = created.body.id as string;
      const prepared = await send(bearer, "POST", `/v1/applications/${id}/packets`, unique("rp"), {
        expectedRevision: created.body.revision,
        form,
      });
      expect(prepared.status).toBe(201);
      // The packet carries the tailored content hash, not the base document hash.
      expect(prepared.body.currentPacket.artifactHashes).toEqual({ resume: "c".repeat(64) });
      // Only the owner identity and the public job text cross to the Documents runtime.
      expect(tailoringCalls.at(-1)).toMatchObject({
        kind: "resume-tailoring-v1",
        mode: "hash",
        job: { title: jobTitle, description: "Build payments APIs in TypeScript with PostgreSQL." },
      });
      expect(Object.keys(tailoringCalls.at(-1) ?? {}).sort()).toEqual([
        "job",
        "kind",
        "mode",
        "ownerUserId",
      ]);

      const preview = await send(bearer, "GET", `/v1/applications/${id}/resume`, "unused");
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        status: "ready",
        matchesPacket: true,
        contentSha256: "c".repeat(64),
        baseDocument: { fileName: "synthetic-resume.pdf" },
        sections: [{ kind: "experience", heading: "Experience" }],
      });
      expect(
        preview.body.sections[0].entries[0].bullets.map((b: { change: string }) => b.change),
      ).toEqual(["moved_up", "omitted"]);

      // The candidate can download exactly the resume the packet carries, as a PDF.
      const pdf = await send(bearer, "GET", `/v1/applications/${id}/resume/file?format=pdf`, "u");
      expect(pdf.status).toBe(200);
      expect(pdf.body).toMatchObject({
        format: "pdf",
        mediaType: "application/pdf",
        fileName: "synthetic-resume-tailored.pdf",
        contentSha256: "c".repeat(64),
        sizeBytes: 11,
      });
      expect(Buffer.from(pdf.body.contentBase64, "base64").toString()).toBe("synthetic!!");
      // Generated resumes are delivered only as PDF.
      expect(
        (await send(bearer, "GET", `/v1/applications/${id}/resume/file?format=docx`, "u")).status,
      ).toBe(400);
      // Only the strict `format` query is accepted.
      for (const bad of ["", "?format=exe", "?format=pdf&extra=1", "?other=pdf"]) {
        const refused = await send(bearer, "GET", `/v1/applications/${id}/resume/file${bad}`, "u");
        expect(refused.status, bad).toBe(400);
      }
      expect(
        (await send(other, "GET", `/v1/applications/${id}/resume/file?format=pdf`, "u")).status,
      ).toBe(404);

      // A different candidate can neither see this application nor its tailored resume.
      const foreign = await send(other, "GET", `/v1/applications/${id}/resume`, "unused");
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain("synthetic-resume");

      const approved = await send(bearer, "POST", `/v1/applications/${id}/approval`, unique("ra"), {
        expectedRevision: prepared.body.revision,
        packetHash: prepared.body.currentPacket.packetHash,
        acknowledgedFieldKeys: [],
      });
      expect(approved.status).toBe(200);

      // The resume the runtime would now produce differs: the preview says so, and submission refuses.
      tailoringBehavior = { kind: "ready", contentSha256: "e".repeat(64) };
      const changed = await send(bearer, "GET", `/v1/applications/${id}/resume`, "unused");
      expect(changed.body).toMatchObject({ status: "ready", matchesPacket: false });
      // A file is never served for a resume the packet does not carry: it must be prepared again.
      const stale = await send(bearer, "GET", `/v1/applications/${id}/resume/file?format=pdf`, "u");
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("application_packet_stale");
      const blocked = await send(
        bearer,
        "POST",
        `/v1/applications/${id}/submissions`,
        unique("rs"),
        {
          expectedRevision: approved.body.revision,
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          observedFormHash: hash,
        },
      );
      expect(blocked.body).toMatchObject({
        outcome: "approval_invalidated",
        invalidationReasons: ["resume_changed"],
      });

      // An unreachable Documents runtime is a 503, never a silent "no resume".
      tailoringBehavior = { kind: "down" };
      const down = await send(bearer, "GET", `/v1/applications/${id}/resume`, "unused");
      expect(down.status).toBe(503);

      // A candidate with no parsed resume gets an honest, empty packet slot.
      tailoringBehavior = { kind: "no_resume" };
      const none = await send(bearer, "GET", `/v1/applications/${id}/resume`, "unused");
      expect(none.body).toEqual({ status: "no_resume", matchesPacket: false });
    });

    it("prepares, approves, refuses a changed job, then submits exactly once", async () => {
      const bearer = await issuer.issue("candidate-e2e-applications", {
        scope: "applications:read applications:write",
      });
      const headers = (key: string) => ({
        authorization: `Bearer ${bearer}`,
        "idempotency-key": key,
      });
      const call = async (method: "GET" | "POST", url: string, key: string, payload?: unknown) => {
        const response = await app.inject({
          method,
          url,
          headers: method === "POST" ? headers(key) : { authorization: `Bearer ${bearer}` },
          ...(payload === undefined ? {} : { payload: payload as never }),
        });
        return {
          status: response.statusCode,
          body: response.json() as ReturnType<typeof JSON.parse>,
        };
      };
      const unique = (label: string) =>
        `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`.padEnd(20, "x");
      const form = { adapterId: "greenhouse", variantId: "board-v1", formHash: hash };

      const created = await call("POST", "/v1/applications", unique("create"), { jobId });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const prepared = await call("POST", `/v1/applications/${id}/packets`, unique("packet"), {
        expectedRevision: created.body.revision,
        form,
        userEntries: [{ fieldKey: "job.notice_period", value: "2 weeks" }],
      });
      expect(prepared.status).toBe(201);
      const fields = prepared.body.currentPacket.fields as Array<Record<string, unknown>>;
      expect(fields.find((f) => f.fieldKey === "contact.email")).toMatchObject({
        origin: "confirmed_fact",
        disposition: "auto",
        value: "synthetic.candidate@example.test",
      });
      expect(fields.find((f) => f.fieldKey === "job.notice_period")).toMatchObject({
        origin: "user_entered",
        requiresReview: true,
      });

      // Approval without acknowledging the candidate-entered field is refused.
      const refused = await call("POST", `/v1/applications/${id}/approval`, unique("approve-bad"), {
        expectedRevision: prepared.body.revision,
        packetHash: prepared.body.currentPacket.packetHash,
        acknowledgedFieldKeys: [],
      });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("application_approval_refused");

      const approved = await call("POST", `/v1/applications/${id}/approval`, unique("approve"), {
        expectedRevision: prepared.body.revision,
        packetHash: prepared.body.currentPacket.packetHash,
        acknowledgedFieldKeys: ["job.notice_period"],
      });
      expect(approved.status).toBe(200);
      expect(approved.body.currentAction).toBe("ready_to_submit");

      // The posting changes after approval: submission must not proceed.
      jobTitle = "Staff Backend Engineer";
      const blocked = await call("POST", `/v1/applications/${id}/submissions`, unique("start"), {
        expectedRevision: approved.body.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: hash,
      });
      expect(blocked.body).toMatchObject({
        outcome: "approval_invalidated",
        invalidationReasons: ["job_changed"],
      });
      expect(blocked.body.application.status).toBe("review_required");

      // Re-prepare against the changed posting, approve again, and submit.
      const again = await call("POST", `/v1/applications/${id}/packets`, unique("packet2"), {
        expectedRevision: blocked.body.application.revision,
        form,
        userEntries: [{ fieldKey: "job.notice_period", value: "2 weeks" }],
      });
      const approvedAgain = await call(
        "POST",
        `/v1/applications/${id}/approval`,
        unique("approve2"),
        {
          expectedRevision: again.body.revision,
          packetHash: again.body.currentPacket.packetHash,
          acknowledgedFieldKeys: ["job.notice_period"],
        },
      );
      const started = await call("POST", `/v1/applications/${id}/submissions`, unique("start2"), {
        expectedRevision: approvedAgain.body.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: hash,
      });
      expect(started.body.outcome).toBe("started");
      const attemptId = started.body.attemptId as string;

      // A second start while one is in flight is refused.
      const duplicate = await call("POST", `/v1/applications/${id}/submissions`, unique("start3"), {
        expectedRevision: started.body.application.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: hash,
      });
      expect(duplicate.status).toBe(409);

      const dispatched = await call(
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/dispatch`,
        "n/a",
      );
      expect(dispatched.status).toBe(200);
      const repeatedDispatch = await call(
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/dispatch`,
        "n/a",
      );
      expect(repeatedDispatch.status).toBe(409);

      const applied = await call(
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/result`,
        unique("result"),
        {
          kind: "confirmed",
          confirmation: {
            kind: "provider_confirmation_page",
            observedAt: new Date().toISOString(),
            fingerprintSha256: hash,
          },
        },
      );
      expect(applied.body.status).toBe("applied");

      const history = await call("GET", `/v1/applications/${id}/history`, "n/a");
      const kinds = (history.body.entries as Array<{ kind: string }>).map((entry) => entry.kind);
      expect(kinds.at(-1)).toBe("submission_confirmed");
      expect(kinds).toContain("approval_invalidated");
      expect(JSON.stringify(history.body)).not.toMatch(
        /interview|offer|recruiter|hired|synthetic\.candidate/iu,
      );

      // Another candidate cannot see it.
      const stranger = await issuer.issue("someone-else", { scope: "applications:read" });
      const foreign = await app.inject({
        method: "GET",
        url: `/v1/applications/${id}`,
        headers: { authorization: `Bearer ${stranger}` },
      });
      expect(foreign.statusCode).toBe(404);
    });

    // Mirrors the deployed acceptance operator (scripts/operate-development-applications-acceptance.ps1)
    // step for step, so its expected statuses are proven here rather than assumed.
    it("follows the exact statuses the deployed acceptance operator expects", async () => {
      const run = Date.now().toString(16);
      const owner = {
        full: await issuer.issue(`acceptance-owner-${run}`, {
          scope: "applications:read applications:write profile:read",
        }),
        noScope: await issuer.issue(`acceptance-owner-${run}`, { scope: "profile:read" }),
        readOnly: await issuer.issue(`acceptance-owner-${run}`, {
          scope: "applications:read profile:read",
        }),
      };
      const other = await issuer.issue(`acceptance-other-${run}`, {
        scope: "applications:read applications:write profile:read",
      });
      const key = (label: string) => `d3apps-${run}-${label}`.padEnd(16, "x");
      const call = async (
        token: string,
        method: "GET" | "POST",
        url: string,
        idempotencyKey?: string,
        payload?: unknown,
      ) => {
        const response = await app.inject({
          method,
          url,
          headers: {
            authorization: `Bearer ${token}`,
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(payload === undefined ? {} : { payload: payload as never }),
        });
        return {
          status: response.statusCode,
          body: response.json() as ReturnType<typeof JSON.parse>,
        };
      };
      const form = { adapterId: "synthetic-acceptance", variantId: "v1", formHash: hash };
      const changedForm = "c".repeat(64);
      const cases: string[] = [];
      const expectStep = (name: string, actual: { status: number }, expected: number) => {
        expect(actual.status, name).toBe(expected);
        cases.push(`${name}:${actual.status}`);
      };
      const start = (
        token: string,
        id: string,
        label: string,
        revision: number,
        observed: string,
      ) =>
        call(token, "POST", `/v1/applications/${id}/submissions`, key(label), {
          expectedRevision: revision,
          adapterId: "synthetic-acceptance",
          adapterVersion: "1.0.0",
          observedFormHash: observed,
        });

      expectStep(
        "create-no-scope",
        await call(owner.noScope, "POST", "/v1/applications", key("c0"), { jobId }),
        403,
      );
      expectStep(
        "create-read-only",
        await call(owner.readOnly, "POST", "/v1/applications", key("c1"), { jobId }),
        403,
      );
      const created = await call(owner.full, "POST", "/v1/applications", key("create"), { jobId });
      expectStep("create", created, 201);
      const id = created.body.id as string;
      const replay = await call(owner.full, "POST", "/v1/applications", key("create"), { jobId });
      expectStep("create-replay", replay, 201);
      expect(replay.body.id).toBe(id);
      const foreignGet = await call(other, "GET", `/v1/applications/${id}`);
      expectStep("foreign-get", foreignGet, 404);
      expect(foreignGet.body.code).toBe("application_not_found");
      expectStep(
        "foreign-packet",
        await call(other, "POST", `/v1/applications/${id}/packets`, key("fp"), {
          expectedRevision: created.body.revision,
        }),
        404,
      );
      const packet = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/packets`,
        key("packet"),
        {
          expectedRevision: created.body.revision,
          form,
        },
      );
      expectStep("packet", packet, 201);
      expect(packet.body.status).toBe("review_required");
      const badHash = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/approval`,
        key("bad"),
        {
          expectedRevision: packet.body.revision,
          packetHash: "0".repeat(64),
          acknowledgedFieldKeys: [],
        },
      );
      expectStep("approve-wrong-hash", badHash, 409);
      const approved = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/approval`,
        key("appr"),
        {
          expectedRevision: packet.body.revision,
          packetHash: packet.body.currentPacket.packetHash,
          acknowledgedFieldKeys: [],
        },
      );
      expectStep("approve", approved, 200);
      expect(approved.body.status).toBe("approved");
      const changed = await start(owner.full, id, "chg", approved.body.revision, changedForm);
      expectStep("start-changed-form", changed, 200);
      expect(changed.body).toMatchObject({
        outcome: "approval_invalidated",
        invalidationReasons: ["form_changed"],
      });
      expect(changed.body.application.status).toBe("review_required");
      const packetAgain = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/packets`,
        key("packet2"),
        { expectedRevision: changed.body.application.revision, form },
      );
      expectStep("packet-again", packetAgain, 201);
      const approvedAgain = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/approval`,
        key("appr2"),
        {
          expectedRevision: packetAgain.body.revision,
          packetHash: packetAgain.body.currentPacket.packetHash,
          acknowledgedFieldKeys: [],
        },
      );
      expectStep("approve-again", approvedAgain, 200);
      const started = await start(owner.full, id, "start", approvedAgain.body.revision, hash);
      expectStep("start", started, 200);
      expect(started.body.outcome).toBe("started");
      const attemptId = started.body.attemptId as string;
      expectStep(
        "start-duplicate",
        await start(owner.full, id, "dup", started.body.application.revision, hash),
        409,
      );
      const dispatched = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/dispatch`,
      );
      expectStep("dispatch", dispatched, 200);
      expect(dispatched.body.status).toBe("dispatched");
      expectStep(
        "dispatch-repeat",
        await call(owner.full, "POST", `/v1/applications/${id}/attempts/${attemptId}/dispatch`),
        409,
      );
      const ambiguous = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/result`,
        key("timeout"),
        { kind: "timeout" },
      );
      expectStep("result-timeout", ambiguous, 200);
      expect(ambiguous.body.status).toBe("reconciliation_required");
      expectStep(
        "start-after-ambiguous",
        await start(owner.full, id, "blind", ambiguous.body.revision, hash),
        409,
      );
      const applied = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/attempts/${attemptId}/reconciliation`,
        key("recon"),
        {
          kind: "user_attested_submitted",
          observedAt: new Date().toISOString(),
          fingerprintSha256: hash,
        },
      );
      expectStep("reconcile-attested", applied, 200);
      expect(applied.body.status).toBe("applied");
      const history = await call(owner.full, "GET", `/v1/applications/${id}/history`);
      expectStep("history", history, 200);
      const kinds = (history.body.entries as Array<{ kind: string }>).map((entry) => entry.kind);
      expect(kinds.at(-1)).toBe("submission_confirmed");
      expect(kinds).toContain("approval_invalidated");
      expect(history.body.hasMore).toBe(false);
      expect(JSON.stringify(history.body)).not.toMatch(/interview|offer|recruiter|hired/iu);
      expectStep(
        "start-after-applied",
        await start(owner.full, id, "late", applied.body.revision, hash),
        409,
      );
      expectStep(
        "foreign-history",
        await call(other, "GET", `/v1/applications/${id}/history`),
        404,
      );
      const final = await call(owner.full, "GET", `/v1/applications/${id}`);
      expectStep("get-final", final, 200);
      expect(final.body.attempts[0]).toMatchObject({ status: "confirmed" });
      expect(final.body.attempts[0].confirmation.kind).toBe("user_attested");
      const conflict = await call(
        owner.full,
        "POST",
        `/v1/applications/${id}/packets`,
        key("packet"),
        { expectedRevision: 1, form: { ...form, formHash: changedForm } },
      );
      expectStep("idempotency-conflict", conflict, 409);
      expect(conflict.body.code).toBe("idempotency_conflict");
      expect(cases).toHaveLength(24);
    });
  },
);

describe("resume upload refusals (ADR-032)", () => {
  const payload: CreateResumeUploadRequest = {
    fileName: "synthetic-resume.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  };
  const refusing = (error: Error): DocumentStore => ({
    async listResumeDocuments() {
      return { documents: [] };
    },
    async createResumeUpload() {
      throw error;
    },
    async deleteResume() {
      throw error;
    },
    async close() {},
  });

  it.each([
    [new ResumeUploadInProgressError(), 409, "resume_upload_in_progress"],
    [new ResumeDocumentLimitError(1), 409, "resume_document_limit"],
    [new EntitlementUnavailableError(), 503, "entitlement_unavailable"],
  ])("maps %s to a stable problem without leaking detail", async (error, status, code) => {
    const { app, issuer } = await createApp({ documents: refusing(error) });
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "documents:read documents:write",
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/resumes/uploads",
        headers: { authorization: `Bearer ${token}`, "idempotency-key": "resume-upload-test-0001" },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code, status });
      expect(response.headers["content-type"]).toMatch(/problem\+json/);
      expect(response.body).not.toMatch(/synthetic-resume|aaaaaaaa/);
    } finally {
      await app.close();
    }
  });
});

describe("resume deletion (ADR-033)", () => {
  const documentId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
  const payload: CreateResumeUploadRequest = {
    fileName: "synthetic-resume.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  };

  it("deletes the caller's resume with no body and no caching, and it leaves the list", async () => {
    const { app, issuer } = await createApp();
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "documents:read documents:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      const created = await app.inject({
        method: "POST",
        url: "/v1/resumes/uploads",
        headers: { ...headers, "idempotency-key": "resume-delete-test-0001" },
        payload,
      });
      const id = created.json().document.id as string;
      const removed = await app.inject({ method: "DELETE", url: `/v1/resumes/${id}`, headers });
      expect(removed.statusCode).toBe(204);
      expect(removed.headers["cache-control"]).toBe("no-store");
      expect(removed.body).toBe("");
      const listed = await app.inject({ method: "GET", url: "/v1/resumes", headers });
      expect(listed.json()).toEqual({ documents: [] });
    } finally {
      await app.close();
    }
  });

  it("requires the documents:write scope and a bearer token", async () => {
    const { app, issuer } = await createApp();
    try {
      const readOnly = await issuer.issue("candidate-resume", { scope: "documents:read" });
      const forbidden = await app.inject({
        method: "DELETE",
        url: `/v1/resumes/${documentId}`,
        headers: { authorization: `Bearer ${readOnly}` },
      });
      expect(forbidden.statusCode).toBe(403);
      const anonymous = await app.inject({ method: "DELETE", url: `/v1/resumes/${documentId}` });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["a malformed identifier", "/v1/resumes/not-a-uuid"],
    ["a version 4 identifier", "/v1/resumes/6f9619ff-8b86-4011-b42d-00c04fc964ff"],
    ["a query string", `/v1/resumes/${documentId}?force=true`],
  ])("rejects %s before touching the store", async (_name, url) => {
    let touched = false;
    const documents: DocumentStore = {
      async listResumeDocuments() {
        return { documents: [] };
      },
      async createResumeUpload() {
        throw new Error("unexpected");
      },
      async deleteResume() {
        touched = true;
      },
      async close() {},
    };
    const { app, issuer } = await createApp({ documents });
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "documents:read documents:write",
      });
      const response = await app.inject({
        method: "DELETE",
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(400);
      expect(touched).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("passes only the authenticated owner to the store, never an identifier from the caller", async () => {
    const calls: unknown[][] = [];
    const documents: DocumentStore = {
      async listResumeDocuments() {
        return { documents: [] };
      },
      async createResumeUpload() {
        throw new Error("unexpected");
      },
      async deleteResume(...args: unknown[]) {
        calls.push(args);
      },
      async close() {},
    };
    const { app, issuer } = await createApp({ documents });
    try {
      const first = await issuer.issue("candidate-one", { scope: "documents:write" });
      const second = await issuer.issue("candidate-two", { scope: "documents:write" });
      for (const token of [first, second]) {
        await app.inject({
          method: "DELETE",
          url: `/v1/resumes/${documentId}`,
          headers: { authorization: `Bearer ${token}` },
        });
      }
      expect(calls).toHaveLength(2);
      expect(calls[0]?.[0]).not.toBe(calls[1]?.[0]);
      expect(calls.map((call) => call[1])).toEqual([documentId, documentId]);
    } finally {
      await app.close();
    }
  });

  it("erases the caller's unreviewed suggestions from the deleted resume, for that owner and document only", async () => {
    const { app, issuer, store } = await createApp();
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "documents:read documents:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      const created = await app.inject({
        method: "POST",
        url: "/v1/resumes/uploads",
        headers: { ...headers, "idempotency-key": "resume-retire-test-0001" },
        payload,
      });
      const id = created.json().document.id as string;
      const removed = await app.inject({ method: "DELETE", url: `/v1/resumes/${id}`, headers });
      expect(removed.statusCode).toBe(204);
      expect(store.retiredResumeProposals).toHaveLength(1);
      expect(store.retiredResumeProposals[0]).toMatchObject({ documentId: id });
    } finally {
      await app.close();
    }
  });

  it("does not retire anything when the delete itself is refused", async () => {
    const documents: DocumentStore = {
      async listResumeDocuments() {
        return { documents: [] };
      },
      async createResumeUpload() {
        throw new Error("unexpected");
      },
      async deleteResume() {
        throw new ResumeNotDeletableError();
      },
      async close() {},
    };
    const { app, issuer, store } = await createApp({ documents });
    try {
      const token = await issuer.issue("candidate-resume", { scope: "documents:write" });
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/resumes/${documentId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(409);
      expect(store.retiredResumeProposals).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("still answers 204 when retiring the suggestions fails, because the purge sweep repeats it", async () => {
    const { app, issuer, store } = await createApp();
    store.retireFailure = new Error("synthetic profile outage private-canary");
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "documents:read documents:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      const created = await app.inject({
        method: "POST",
        url: "/v1/resumes/uploads",
        headers: { ...headers, "idempotency-key": "resume-retire-test-0002" },
        payload,
      });
      const id = created.json().document.id as string;
      const removed = await app.inject({ method: "DELETE", url: `/v1/resumes/${id}`, headers });
      expect(removed.statusCode).toBe(204);
      expect(removed.body).toBe("");
      const listed = await app.inject({ method: "GET", url: "/v1/resumes", headers });
      expect(listed.json()).toEqual({ documents: [] });
      expect(JSON.stringify(errors)).toContain("resume_proposal_retirement_deferred");
      expect(JSON.stringify(errors)).not.toContain("private-canary");
    } finally {
      console.error = original;
      await app.close();
    }
  });

  it("maps a resume that is still processing to a stable 409 without detail", async () => {
    const documents: DocumentStore = {
      async listResumeDocuments() {
        return { documents: [] };
      },
      async createResumeUpload() {
        throw new Error("unexpected");
      },
      async deleteResume() {
        throw new ResumeNotDeletableError();
      },
      async close() {},
    };
    const { app, issuer } = await createApp({ documents });
    try {
      const token = await issuer.issue("candidate-resume", { scope: "documents:write" });
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/resumes/${documentId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "resume_not_deletable", status: 409 });
      expect(response.headers["content-type"]).toMatch(/problem\+json/);
    } finally {
      await app.close();
    }
  });
});

class MemoryRestrictedAnswerVaultStore implements RestrictedAnswerVaultStore {
  private nextId = 1;
  private readonly entries = new Map<
    string,
    {
      id: string;
      userId: string;
      fieldKey: string;
      context: string;
      version: number;
      state: "active" | "deleted";
      valueType: string;
      sensitivity: string;
      confirmedAt: string;
      createdAt: string;
      expiresAt?: string;
    }
  >();
  private readonly idempotency = new Map<string, { id: string; version: number }>();
  saveCalls: unknown[] = [];
  removeByFieldCalls: unknown[] = [];

  private key(userId: string, fieldKey: string, context: string) {
    return `${userId}\u0000${fieldKey}\u0000${context}`;
  }

  async save(command: Parameters<RestrictedAnswerVaultStore["save"]>[0]) {
    this.saveCalls.push(command);
    const context = command.context ?? "";
    const idemKey = `${command.userId}\u0000${command.idempotencyKey}`;
    const priorIdem = this.idempotency.get(idemKey);
    if (priorIdem) return priorIdem;
    const key = this.key(command.userId, command.fieldKey, context);
    const existing = this.entries.get(key);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== command.expectedVersion) {
      throw new RestrictedAnswerVaultConflictError();
    }
    const id = existing?.id ?? `restricted-answer-${this.nextId++}`;
    const version = currentVersion + 1;
    this.entries.set(key, {
      id,
      userId: command.userId,
      fieldKey: command.fieldKey,
      context,
      version,
      state: "active",
      valueType: command.valueType,
      sensitivity: command.sensitivity,
      confirmedAt: command.confirmedAt.toISOString(),
      createdAt: existing?.createdAt ?? "2026-09-28T12:00:01.123456+00:00",
      ...(command.expiresAt ? { expiresAt: command.expiresAt.toISOString() } : {}),
    });
    const result = { id, version };
    this.idempotency.set(idemKey, result);
    return result;
  }

  async list(userId: string) {
    return [...this.entries.values()]
      .filter((entry) => entry.userId === userId)
      .map((entry) => ({
        id: entry.id,
        fieldKey: entry.fieldKey,
        ...(entry.context ? { context: entry.context } : {}),
        valueType: entry.valueType as never,
        sensitivity: entry.sensitivity as never,
        state: entry.state,
        version: entry.version,
        confirmedAt: entry.confirmedAt,
        createdAt: entry.createdAt,
        ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
      }));
  }

  async remove(command: Parameters<RestrictedAnswerVaultStore["remove"]>[0]) {
    for (const entry of this.entries.values()) {
      if (entry.id === command.id) {
        entry.state = "deleted";
        entry.version += 1;
        return { version: entry.version };
      }
    }
    return { version: command.expectedVersion };
  }

  async removeByField(command: Parameters<RestrictedAnswerVaultStore["removeByField"]>[0]) {
    this.removeByFieldCalls.push(command);
    const context = command.context ?? "";
    const key = this.key(command.userId, command.fieldKey, context);
    const entry = this.entries.get(key);
    if (!entry || entry.state === "deleted") return { deleted: false };
    entry.state = "deleted";
    entry.version += 1;
    return { deleted: true };
  }
}

describe("restricted answer vault routes (D3-001)", () => {
  it("fails closed with a clean 503 when no vault is configured, never a generic 500", async () => {
    const { app, issuer } = await createApp();
    try {
      const token = await issuer.issue("candidate-resume", { scope: "profile:read" });
      const response = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "restricted_answer_vault_unavailable" });
    } finally {
      await app.close();
    }
  });

  it("creates an entry, lists its metadata only, corrects it, and deletes it", async () => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "profile:read profile:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      const created = await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/authorization.us_authorized",
        headers: { ...headers, "idempotency-key": "restricted-answer-test-0001" },
        payload: {
          expectedVersion: 0,
          valueType: "boolean",
          value: "true",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T12:00:00.000Z",
        },
      });
      expect(created.statusCode).toBe(200);
      expect(created.headers["cache-control"]).toBe("no-store");
      const body = created.json();
      expect(body).toMatchObject({
        fieldKey: "authorization.us_authorized",
        valueType: "boolean",
        sensitivity: "restricted",
        state: "active",
        version: 1,
      });
      expect(JSON.stringify(body)).not.toContain(`"value"`);
      expect(JSON.stringify(body)).not.toContain("true");
      expect(body).not.toHaveProperty("createdAt");

      const listed = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
        headers,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.headers["cache-control"]).toBe("no-store");
      expect(listed.json().answers).toHaveLength(1);
      expect(listed.json().answers[0].createdAt).toBe("2026-09-28T12:00:01.123456+00:00");
      expect(JSON.stringify(listed.json())).not.toContain("true");

      const corrected = await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/authorization.us_authorized",
        headers: { ...headers, "idempotency-key": "restricted-answer-test-0002" },
        payload: {
          expectedVersion: 1,
          valueType: "boolean",
          value: "false",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T13:00:00.000Z",
        },
      });
      expect(corrected.statusCode).toBe(200);
      expect(corrected.json().version).toBe(2);

      const deleted = await app.inject({
        method: "DELETE",
        url: "/v1/profile/restricted-answers/authorization.us_authorized",
        headers,
      });
      expect(deleted.statusCode).toBe(204);
      expect(deleted.headers["cache-control"]).toBe("no-store");
      expect(deleted.body).toBe("");

      const deletedAgain = await app.inject({
        method: "DELETE",
        url: "/v1/profile/restricted-answers/authorization.us_authorized",
        headers,
      });
      expect(deletedAgain.statusCode).toBe(204);
      const tombstones = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
        headers,
      });
      expect(tombstones.json().answers[0]).toMatchObject({
        state: "deleted",
        version: 3,
        createdAt: "2026-09-28T12:00:01.123456+00:00",
      });
    } finally {
      await app.close();
    }
  });

  it("passes the context query parameter through to the store, isolating one field's contexts", async () => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "profile:read profile:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      for (const context of ["us", "eu"]) {
        const response = await app.inject({
          method: "PUT",
          url: `/v1/profile/restricted-answers/authorization.sponsorship_required?context=${context}`,
          headers: { ...headers, "idempotency-key": `restricted-answer-context-${context}` },
          payload: {
            expectedVersion: 0,
            valueType: "boolean",
            value: "true",
            sensitivity: "restricted",
            sourceReference: "application-review-panel",
            confirmedAt: "2026-09-28T12:00:00.000Z",
          },
        });
        expect(response.statusCode, context).toBe(200);
        expect(response.json().context).toBe(context);
      }
      const listed = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
        headers,
      });
      expect(listed.json().answers).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["a malformed field key", "/v1/profile/restricted-answers/Not-Valid"],
    ["an unknown query key", "/v1/profile/restricted-answers/authorization.us_authorized?other=1"],
  ])("rejects a save with %s as a stable 400", async (_name, path) => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const token = await issuer.issue("candidate-resume", { scope: "profile:write" });
      const response = await app.inject({
        method: "PUT",
        url: path,
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "restricted-answer-bad-input",
        },
        payload: {
          expectedVersion: 0,
          valueType: "boolean",
          value: "true",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T12:00:00.000Z",
        },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("maps a stale expected version to a stable 409 without leaking detail", async () => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const token = await issuer.issue("candidate-resume", { scope: "profile:write" });
      const headers = { authorization: `Bearer ${token}` };
      await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/authorization.export_control",
        headers: { ...headers, "idempotency-key": "restricted-answer-conflict-0001" },
        payload: {
          expectedVersion: 0,
          valueType: "enum",
          value: "eligible",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T12:00:00.000Z",
        },
      });
      const stale = await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/authorization.export_control",
        headers: { ...headers, "idempotency-key": "restricted-answer-conflict-0002" },
        payload: {
          expectedVersion: 0,
          valueType: "enum",
          value: "not_eligible",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T13:00:00.000Z",
        },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: "restricted_answer_version_conflict" });
    } finally {
      await app.close();
    }
  });

  it("requires profile:write for a save and profile:read for a list, and a bearer token for either", async () => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const readOnly = await issuer.issue("candidate-resume", { scope: "profile:read" });
      const forbidden = await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/authorization.us_authorized",
        headers: {
          authorization: `Bearer ${readOnly}`,
          "idempotency-key": "restricted-answer-scope-0001",
        },
        payload: {
          expectedVersion: 0,
          valueType: "boolean",
          value: "true",
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T12:00:00.000Z",
        },
      });
      expect(forbidden.statusCode).toBe(403);
      const anonymous = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
      });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("never sends the answer's plaintext value in the confirmation response or the list", async () => {
    const restrictedAnswerVault = new MemoryRestrictedAnswerVaultStore();
    const { app, issuer } = await createApp({ restrictedAnswerVault });
    try {
      const token = await issuer.issue("candidate-resume", {
        scope: "profile:read profile:write",
      });
      const headers = { authorization: `Bearer ${token}` };
      const secret = "a-very-distinctive-canary-value";
      const saved = await app.inject({
        method: "PUT",
        url: "/v1/profile/restricted-answers/demographic.veteran",
        headers: { ...headers, "idempotency-key": "restricted-answer-canary-0001" },
        payload: {
          expectedVersion: 0,
          valueType: "enum",
          value: secret,
          sensitivity: "restricted",
          sourceReference: "application-review-panel",
          confirmedAt: "2026-09-28T12:00:00.000Z",
        },
      });
      expect(saved.body).not.toContain(secret);
      const listed = await app.inject({
        method: "GET",
        url: "/v1/profile/restricted-answers",
        headers,
      });
      expect(listed.body).not.toContain(secret);
      expect(JSON.stringify(restrictedAnswerVault.saveCalls)).toContain(secret);
    } finally {
      await app.close();
    }
  });
});

describe("bounded privileged moderation audit boundary", () => {
  it("records fixed access/attempt metadata for all four authenticated operations", async () => {
    const record = vi.fn<PrivilegedModerationAuditWriter["record"]>(async () => undefined);
    const f = await createApp({ privilegedModerationAudit: { record } });
    try {
      const rawSubject = "auth0|synthetic-audit-operator";
      const headers = {
        authorization: `Bearer ${await f.issuer.issue(rawSubject, { scope: "jobs:moderate" })}`,
      };
      const opened = await f.app.inject({
        method: "POST",
        url: "/v1/admin/moderation/cases",
        headers,
        payload: {
          target: { kind: "job", jobId: f.catalog.job.id },
          reasonCode: "candidate_reports",
        },
      });
      expect(opened.statusCode).toBe(201);
      const caseId = opened.json().id;
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/v1/admin/moderation/cases/search",
            headers,
            payload: { status: "open" },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: `/v1/admin/moderation/jobs/${f.catalog.job.id}/report-summary`,
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: `/v1/admin/moderation/cases/${caseId}/resolve`,
            headers,
            payload: {
              expectedVersion: 0,
              resolution: "no_action",
              reasonCode: "insufficient_evidence",
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(record.mock.calls.map(([r]) => r.action)).toEqual([
        "jobs.moderation.case_open.attempt",
        "jobs.moderation.case_search.access",
        "jobs.moderation.report_summary.access",
        "jobs.moderation.case_resolve.attempt",
      ]);
      for (const [r] of record.mock.calls) {
        expect(Object.keys(r).sort()).toEqual(["action", "operatorId", "resourceId"]);
        expect(r.operatorId).toMatch(/^oidc:[a-f0-9]{64}$/);
        expect(JSON.stringify(r)).not.toContain(rawSubject);
      }
    } finally {
      await f.app.close();
    }
  });
  it("does not record unauthorized or invalid requests and denies work when audit fails", async () => {
    const record = vi.fn<PrivilegedModerationAuditWriter["record"]>(async () => {
      throw Error("synthetic private audit failure");
    });
    const f = await createApp({ privilegedModerationAudit: { record } });
    try {
      const url = "/v1/admin/moderation/cases/search";
      expect(
        (await f.app.inject({ method: "POST", url, payload: { status: "open" } })).statusCode,
      ).toBe(401);
      const headers = {
        authorization: `Bearer ${await f.issuer.issue("auth0|synthetic-audit", { scope: "jobs:moderate" })}`,
      };
      expect(
        (await f.app.inject({ method: "POST", url, headers, payload: { status: "invalid" } }))
          .statusCode,
      ).toBe(400);
      expect(record).not.toHaveBeenCalled();
      const response = await f.app.inject({
        method: "POST",
        url,
        headers,
        payload: { status: "open" },
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("synthetic private audit failure");
      expect(record).toHaveBeenCalledOnce();
      const openCase = vi.spyOn(f.moderation, "openCase");
      const blockedWrite = await f.app.inject({
        method: "POST",
        url: "/v1/admin/moderation/cases",
        headers,
        payload: {
          target: { kind: "job", jobId: f.catalog.job.id },
          reasonCode: "candidate_reports",
        },
      });
      expect(blockedWrite.statusCode).toBe(503);
      expect(openCase).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
});

describe("structured Profile section routes (ADR-052)", () => {
  const entryId = "019d04cf-1f80-7000-8000-000000000002";
  const key = "profile-sections-test-0001";
  const record = {
    id: entryId,
    school: "Synthetic University",
    version: 1,
    origin: "entered",
    displayOrder: 0,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  };

  function fakeStore(overrides: Partial<Record<keyof ProfileSectionStore, unknown>> = {}) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const track =
      (method: string, result: unknown) =>
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (result instanceof Error) throw result;
        return result;
      };
    const results: Record<string, unknown> = {
      getPersonal: null,
      putPersonal: {
        version: 1,
        origin: "entered",
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
      listEntries: [record],
      createEntry: record,
      updateEntry: { ...record, version: 2 },
      deleteEntry: undefined,
      reorderEntries: [record],
      listDrafts: [],
      createDraft: undefined,
      discardDraft: undefined,
      saveDraft: { section: "education", entryId, version: 1 },
      ...overrides,
    };
    const store = Object.fromEntries(
      Object.entries(results).map(([method, result]) => [method, track(method, result)]),
    ) as unknown as ProfileSectionStore;
    return { store, calls };
  }

  type Sent = { statusCode: number; headers: Record<string, unknown>; json: () => unknown };

  async function withApp<T>(
    profileSections: ProfileSectionStore | undefined,
    scope: string,
    run: (
      send: (
        method: string,
        url: string,
        extra?: { headers?: Record<string, string>; payload?: object },
      ) => Promise<Sent>,
    ) => Promise<T>,
  ): Promise<T> {
    const { app, issuer } = await createApp(profileSections ? { profileSections } : {});
    try {
      const token = await issuer.issue("candidate-profile-sections", { scope });
      return await run(
        (method, url, extra = {}) =>
          app.inject({
            method: method as "GET",
            url,
            headers: { authorization: `Bearer ${token}`, ...extra.headers },
            ...(extra.payload === undefined ? {} : { payload: extra.payload }),
          }) as unknown as Promise<Sent>,
      );
    } finally {
      await app.close();
    }
  }

  it("fails closed with 503 when the store is not configured", async () => {
    await withApp(undefined, "profile:read", async (send) => {
      expect((await send("GET", "/v1/profile/education-entries")).statusCode).toBe(503);
    });
  });

  it("scopes reads and writes and never lets a read token write", async () => {
    const { store, calls } = fakeStore();
    await withApp(store, "profile:read", async (send) => {
      expect((await send("GET", "/v1/profile/education-entries")).statusCode).toBe(200);
      const write = await send("POST", "/v1/profile/education-entries", {
        headers: { "idempotency-key": key },
        payload: { school: "Synthetic University" },
      });
      expect(write.statusCode).toBe(403);
    });
    expect(calls.map((call) => call.method)).toEqual(["listEntries"]);
  });

  it("returns no-store lists keyed by the authenticated owner, with sections named per contract", async () => {
    const { store, calls } = fakeStore();
    await withApp(store, "profile:read", async (send) => {
      const education = await send("GET", "/v1/profile/education-entries");
      expect(education.headers["cache-control"]).toBe("no-store");
      expect(education.json()).toEqual({ entries: [record] });
      const answers = await send("GET", "/v1/profile/application-answers");
      expect(answers.json()).toEqual({ answers: [record] });
      expect((await send("GET", "/v1/profile/personal")).statusCode).toBe(404);
    });
    expect(calls[0]?.args[1]).toBe("education");
    expect(calls[1]?.args[1]).toBe("applicationAnswer");
    expect(typeof calls[0]?.args[0]).toBe("string");
  });

  it("requires an idempotency key and strict bodies on every write", async () => {
    const { store, calls } = fakeStore();
    await withApp(store, "profile:read profile:write", async (send) => {
      const noKey = await send("POST", "/v1/profile/skill-entries", { payload: { name: "Go" } });
      expect(noKey.statusCode).toBe(400);
      for (const payload of [
        { name: "Go", sensitivity: "restricted" },
        { name: "Go", userId: "019d04cf-1f80-7000-8000-000000000009" },
        { name: "" },
        {},
      ]) {
        const response = await send("POST", "/v1/profile/skill-entries", {
          headers: { "idempotency-key": key },
          payload,
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      }
      const ok = await send("POST", "/v1/profile/skill-entries", {
        headers: { "idempotency-key": key },
        payload: { name: "Go" },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.headers["cache-control"]).toBe("no-store");
    });
    expect(calls.filter((call) => call.method === "createEntry")).toHaveLength(1);
  });

  it("updates, reorders and deletes with versions, and refuses malformed identifiers and queries", async () => {
    const { store, calls } = fakeStore();
    await withApp(store, "profile:read profile:write", async (send) => {
      const headers = { "idempotency-key": key };
      const patch = (url: string, payload: object) => send("PATCH", url, { headers, payload });
      expect(
        (
          await patch(`/v1/profile/education-entries/${entryId}`, {
            expectedVersion: 1,
            degree: "BS",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await patch(`/v1/profile/education-entries/${entryId}`, { degree: "BS" })).statusCode,
      ).toBe(400);
      expect(
        (
          await patch("/v1/profile/education-entries/not-a-uuid", {
            expectedVersion: 1,
            degree: "BS",
          })
        ).statusCode,
      ).toBe(400);
      const reorder = (path: string) =>
        send("POST", `/v1/profile/${path}/reorder`, {
          headers,
          payload: { orderedEntryIds: [entryId] },
        });
      expect((await reorder("work-experience-entries")).statusCode).toBe(200);
      expect((await reorder("application-answers")).statusCode).toBe(404);
      const deleted = await send(
        "DELETE",
        `/v1/profile/skill-entries/${entryId}?expectedVersion=3`,
        {
          headers,
        },
      );
      expect(deleted.statusCode).toBe(204);
      for (const query of [
        "",
        "?expectedVersion=0",
        "?expectedVersion=x",
        "?expectedVersion=1&extra=1",
        "?other=1",
      ]) {
        const bad = await send("DELETE", `/v1/profile/skill-entries/${entryId}${query}`, {
          headers,
        });
        expect(bad.statusCode, query).toBe(400);
      }
    });
    const deleteCalls = calls.filter((call) => call.method === "deleteEntry");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.args.slice(1, 4)).toEqual(["skill", entryId, 3]);
  });

  it("maps store failures to stable problems without echoing candidate text", async () => {
    const cases: Array<[Error, number, string]> = [
      [new ProfileSectionVersionConflictError(), 409, "version_conflict"],
      [new ProfileSectionNotFoundError(), 404, "profile_record_not_found"],
      [new ProfileSectionDuplicateError(), 409, "profile_record_duplicate"],
      [new ProfileSectionLimitError("skill"), 409, "profile_section_limit"],
      [new ProfileSectionRestrictedQuestionError(), 400, "restricted_question"],
    ];
    for (const [error, status, code] of cases) {
      const { store } = fakeStore({ createEntry: error });
      await withApp(store, "profile:write", async (send) => {
        const response = await send("POST", "/v1/profile/application-answers", {
          headers: { "idempotency-key": key },
          payload: { question: "Why us?", answer: "synthetic-private-canary" },
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toMatchObject({ code });
        expect(JSON.stringify(response.json())).not.toContain("synthetic-private-canary");
      });
    }
  });

  it("saves and discards drafts only by identifier, and saves Personal with a version", async () => {
    const { store, calls } = fakeStore();
    await withApp(store, "profile:read profile:write", async (send) => {
      const headers = { "idempotency-key": key };
      const draftId = "019d04cf-1f80-7000-8000-000000000003";
      expect((await send("GET", "/v1/profile/import-drafts")).json()).toEqual({ drafts: [] });
      const saved = await send("POST", `/v1/profile/import-drafts/${draftId}/save`, {
        headers,
        payload: {},
      });
      expect(saved.statusCode).toBe(201);
      expect(saved.json()).toEqual({ section: "education", entryId, version: 1 });
      const refused = await send("POST", `/v1/profile/import-drafts/${draftId}/save`, {
        headers,
        payload: { sensitivity: "restricted" },
      });
      expect(refused.statusCode).toBe(400);
      expect(
        (await send("DELETE", `/v1/profile/import-drafts/${draftId}`, { headers })).statusCode,
      ).toBe(204);
      const personal = await send("PUT", "/v1/profile/personal", {
        headers,
        payload: { expectedVersion: 0, fullName: "Synthetic Person" },
      });
      expect(personal.statusCode).toBe(200);
      const unversioned = await send("PUT", "/v1/profile/personal", {
        headers,
        payload: { fullName: "x" },
      });
      expect(unversioned.statusCode).toBe(400);
    });
    expect(calls.map((call) => call.method)).toEqual([
      "listDrafts",
      "saveDraft",
      "discardDraft",
      "putPersonal",
    ]);
  });
});

describe("Stripe billing routes (D6-005)", () => {
  const signingSecret = "whsec_gatewaytest";

  it("registers no billing route unless Stripe billing is configured", async () => {
    const { app, issuer } = await createApp();
    const token = await issuer.issue("billing-off", { scope: "profile:read profile:write" });
    for (const url of ["/v1/billing/checkout-sessions", "/v1/billing/portal-sessions"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    }
    const webhook = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(webhook.statusCode).toBe(404);
    await app.close();
  });

  async function configured(overrides: Partial<StripeBillingGateway> = {}) {
    const calls: string[] = [];
    const billing: StripeBillingGateway = {
      async startCheckout(userId) {
        calls.push(`checkout:${userId}`);
        return { url: "https://checkout.stripe.com/c/test" };
      },
      async openPortal(userId) {
        calls.push(`portal:${userId}`);
        return { url: "https://billing.stripe.com/p/test" };
      },
      async syncSubscription(userId) {
        calls.push(`sync:${userId}`);
        return { changed: true };
      },
      async handleWebhook(rawBody, signature) {
        calls.push(`webhook:${rawBody.toString("utf8")}:${signature}`);
      },
      ...overrides,
    };
    const setup = await createApp({ stripeBilling: billing });
    return { ...setup, calls };
  }

  it("requires authentication and refuses request input on checkout and portal", async () => {
    const { app, issuer, calls } = await configured();
    const anonymous = await app.inject({ method: "POST", url: "/v1/billing/checkout-sessions" });
    expect(anonymous.statusCode).toBe(401);
    const readOnly = await issuer.issue("billing-readonly", { scope: "profile:read" });
    const denied = await app.inject({
      method: "POST",
      url: "/v1/billing/portal-sessions",
      headers: { authorization: `Bearer ${readOnly}` },
    });
    expect(denied.statusCode).toBe(403);
    const token = await issuer.issue("billing-owner", { scope: "profile:read profile:write" });
    const withQuery = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout-sessions?price=price_evil",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withQuery.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout-sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ url: "https://checkout.stripe.com/c/test" });
    expect(ok.headers["cache-control"]).toBe("no-store");
    const portal = await app.inject({
      method: "POST",
      url: "/v1/billing/portal-sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(portal.statusCode).toBe(201);
    const sync = await app.inject({
      method: "POST",
      url: "/v1/billing/subscription-syncs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toEqual({ changed: true });
    const anonymousSync = await app.inject({
      method: "POST",
      url: "/v1/billing/subscription-syncs",
    });
    expect(anonymousSync.statusCode).toBe(401);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/^checkout:/u);
    expect(calls[1]).toMatch(/^portal:/u);
    expect(calls[2]).toMatch(/^sync:/u);
    await app.close();
  });

  it("maps billing outcomes to stable problem codes", async () => {
    const { StripeAlreadySubscribedError, StripeNoBillingAccountError, StripeApiError } =
      await import("@ai-job-apply/billing-service");
    for (const [error, status, code] of [
      [new StripeAlreadySubscribedError(), 409, "billing_already_subscribed"],
      [new StripeNoBillingAccountError(), 409, "billing_no_account"],
      [new StripeApiError(500, "api_error"), 503, "billing_unavailable"],
    ] as const) {
      const { app, issuer } = await configured({
        async startCheckout() {
          throw error;
        },
      });
      const token = await issuer.issue("billing-owner", { scope: "profile:read profile:write" });
      const response = await app.inject({
        method: "POST",
        url: "/v1/billing/checkout-sessions",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().code).toBe(code);
      await app.close();
    }
  });

  it("passes the exact raw webhook bytes and signature to the handler without a bearer token", async () => {
    const { app, calls } = await configured();
    const payload = '{"id":"evt_00000001",  "type":"customer.created","data":{"object":{}}}';
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=abc" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(calls).toEqual([`webhook:${payload}:t=1,v1=abc`]);
    await app.close();
  });

  it("rejects a webhook with no signature header, a bad signature or an oversized body", async () => {
    const { StripeSignatureError } = await import("@ai-job-apply/billing-service");
    const { app, calls } = await configured({
      async handleWebhook() {
        throw new StripeSignatureError();
      },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(missing.statusCode).toBe(400);
    const bad = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      payload: "{}",
    });
    expect(bad.statusCode).toBe(400);
    const large = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      payload: JSON.stringify({ pad: "x".repeat(300 * 1024) }),
    });
    expect(large.statusCode).toBe(413);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("does not acknowledge a delivery that failed to process, so Stripe retries", async () => {
    const { app } = await configured({
      async handleWebhook() {
        throw new Error("database unavailable");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      payload: "{}",
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("composes from the environment only when it is complete", () => {
    const base = {
      reader: { readEntitlement: async () => ({ userId: "u", version: 0, plan: "free" }) as never },
      writer: { applyEntitlementChange: async () => ({}) as never },
    };
    expect(createStripeBillingGateway({ env: {}, ...base })).toBeUndefined();
    expect(
      createStripeBillingGateway({
        env: {
          STRIPE_SECRET_KEY: "sk_test_abc123",
          STRIPE_WEBHOOK_SECRETS: signingSecret,
          STRIPE_PRO_PRICE_ID: "price_123",
          BILLING_APP_BASE_URL: "https://app.example.test",
        },
        ...base,
      }),
    ).toBeDefined();
    expect(() =>
      createStripeBillingGateway({ env: { STRIPE_SECRET_KEY: "sk_test_abc123" }, ...base }),
    ).toThrow(/partially/u);
  });
});

describe("Notifications routes (D5-001)", () => {
  const ITEM = "019d04cf-1f80-7000-8000-00000000a111";
  const APPLICATION = "019d04cf-1f80-7000-8000-00000000a222";
  const at = new Date("2026-10-22T12:00:00.000Z");
  const item = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM,
    kind: "application_review_needed" as const,
    urgency: "normal" as const,
    state: "unread" as const,
    applicationId: APPLICATION,
    sourceRevision: 3,
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(at.getTime() + 86_400_000),
    ...overrides,
  });
  const preferences = (version = 0) => ({
    version,
    inAppEnabled: true as const,
    emailEnabled: false,
    quietHours: { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    updatedAt: at,
  });

  function fake(overrides: Partial<NotificationsApi> = {}) {
    const calls: unknown[][] = [];
    const notifications: NotificationsApi = {
      async listInbox(...args) {
        calls.push(["list", ...args]);
        return { items: [item()], unreadCount: 1, nextCursor: "abc_DEF-1" };
      },
      async acknowledge(...args) {
        calls.push(["acknowledge", ...args]);
        return item({ state: "acknowledged" });
      },
      async dismiss(...args) {
        calls.push(["dismiss", ...args]);
        return item({ state: "dismissed" });
      },
      async getPreferences(...args) {
        calls.push(["getPreferences", ...args]);
        return preferences();
      },
      async updatePreferences(...args) {
        calls.push(["updatePreferences", ...args]);
        return preferences(1);
      },
      async getDeliveryStatus(...args) {
        calls.push(["getDeliveryStatus", ...args]);
        return {
          email: { address: "person@example.com", state: "verified" as const },
        };
      },
      async setAccountEmail(...args) {
        calls.push(["setAccountEmail", ...args]);
      },
      async sendTestNotification(...args) {
        calls.push(["sendTestNotification", ...args]);
        return { id: ITEM };
      },
      ...overrides,
    };
    return { notifications, calls };
  }

  it("registers no route unless Notifications is configured", async () => {
    const { app, issuer } = await createApp();
    const token = await issuer.issue("notif-off", { scope: "profile:read profile:write" });
    for (const [method, url] of [
      ["GET", "/v1/notifications"],
      ["GET", "/v1/notifications/preferences"],
      ["POST", `/v1/notifications/${ITEM}/acknowledgement`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    }
    await app.close();
  });

  it("requires authentication and the right scope", async () => {
    const { notifications, calls } = fake();
    const { app, issuer } = await createApp({ notifications });
    expect((await app.inject({ method: "GET", url: "/v1/notifications" })).statusCode).toBe(401);
    const readOnly = await issuer.issue("notif-ro", { scope: "profile:read" });
    const denied = await app.inject({
      method: "POST",
      url: `/v1/notifications/${ITEM}/dismissal`,
      headers: { authorization: `Bearer ${readOnly}` },
    });
    expect(denied.statusCode).toBe(403);
    const none = await issuer.issue("notif-none", { scope: "openid" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/notifications",
          headers: { authorization: `Bearer ${none}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("lists the signed-in candidate's inbox with a bounded query and contract-valid output", async () => {
    const { notifications, calls } = fake();
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-owner", { scope: "profile:read profile:write" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/notifications?state=unread&limit=10&cursor=abc_DEF-1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      items: [
        {
          id: ITEM,
          kind: "application_review_needed",
          urgency: "normal",
          state: "unread",
          applicationId: APPLICATION,
          sourceRevision: 3,
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
          expiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
        },
      ],
      nextCursor: "abc_DEF-1",
      unreadCount: 1,
    });
    expect(calls[0]?.[0]).toBe("list");
    expect(calls[0]?.[2]).toEqual({ states: ["unread"], limit: 10, cursor: "abc_DEF-1" });
    await app.close();
  });

  it.each([
    "state=everything",
    "limit=0",
    "limit=101",
    "limit=abc",
    "cursor=bad%20cursor",
    "unknown=1",
    "state=open&state=unread",
  ])("refuses the list query %s", async (query) => {
    const { notifications, calls } = fake();
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-q", { scope: "profile:read" });
    const response = await app.inject({
      method: "GET",
      url: `/v1/notifications?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("acknowledges and dismisses only through bodyless commands for the caller", async () => {
    const { notifications, calls } = fake();
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-cmd", { scope: "profile:read profile:write" });
    const headers = { authorization: `Bearer ${token}` };
    const ack = await app.inject({
      method: "POST",
      url: `/v1/notifications/${ITEM}/acknowledgement`,
      headers,
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().state).toBe("acknowledged");
    const dismiss = await app.inject({
      method: "POST",
      url: `/v1/notifications/${ITEM}/dismissal`,
      headers,
    });
    expect(dismiss.json().state).toBe("dismissed");
    const withBody = await app.inject({
      method: "POST",
      url: `/v1/notifications/${ITEM}/dismissal`,
      headers: { ...headers, "content-type": "application/json" },
      payload: "{}",
    });
    expect(withBody.statusCode).toBe(400);
    expect(calls.map((call) => call[0])).toEqual(["acknowledge", "dismiss"]);
    expect(calls[0]?.[1]).not.toBe(ITEM);
    await app.close();
  });

  it("maps a missing item to 404 and a service failure to 503", async () => {
    const { notifications } = fake({
      async acknowledge() {
        throw new NotificationsError("not_found");
      },
      async dismiss() {
        throw new Error("database down");
      },
    });
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-err", { scope: "profile:read profile:write" });
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/notifications/${ITEM}/acknowledgement`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const failed = await app.inject({
      method: "POST",
      url: `/v1/notifications/${ITEM}/dismissal`,
      headers,
    });
    expect(failed.statusCode).toBe(503);
    expect(JSON.stringify(failed.json())).not.toContain("database down");
    await app.close();
  });

  it("reads and writes preferences with compare-and-set and strict input", async () => {
    const { notifications } = fake({
      async updatePreferences(_user, expectedVersion) {
        if (expectedVersion === 9) throw new NotificationsError("version_conflict");
        return preferences(expectedVersion + 1);
      },
    });
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-pref", { scope: "profile:read profile:write" });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const read = await app.inject({
      method: "GET",
      url: "/v1/notifications/preferences",
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ version: 0, inAppEnabled: true, emailEnabled: false });
    const body = {
      expectedVersion: 0,
      emailEnabled: true,
      quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    };
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers,
      payload: JSON.stringify(body),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().version).toBe(1);
    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers,
      payload: JSON.stringify({ ...body, expectedVersion: 9 }),
    });
    expect(conflict.statusCode).toBe(409);
    for (const bad of [
      { ...body, extra: true },
      { ...body, emailEnabled: "yes" },
      { ...body, quietHours: { ...body.quietHours, startMinute: 1440 } },
      { expectedVersion: 0 },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/notifications/preferences",
        headers,
        payload: JSON.stringify(bad),
      });
      expect(response.statusCode).toBe(400);
    }
    await app.close();
  });

  it("serves the delivery status and the account email", async () => {
    const { notifications, calls } = fake();
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-email-owner", { scope: "profile:read profile:write" });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const status = await app.inject({ method: "GET", url: "/v1/notifications/delivery", headers });
    expect(status.statusCode).toBe(200);
    expect(status.headers["cache-control"]).toBe("no-store");
    expect(status.json()).toEqual({
      email: { address: "person@example.com", state: "verified" },
    });

    const used = await app.inject({
      method: "PUT",
      url: "/v1/notifications/delivery/email",
      headers: {
        authorization: `Bearer ${token}`,
        "x-ai-job-apply-reauthentication": VERIFIED_EMAIL_ID_TOKEN_PROOF,
      },
    });
    expect(used.statusCode).toBe(204);
    expect(used.body).toBe("");
    expect(used.headers["cache-control"]).toBe("no-store");

    const test = await app.inject({
      method: "POST",
      url: "/v1/notifications/delivery/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(test.statusCode).toBe(201);
    expect(test.json()).toEqual({ id: ITEM });
    expect(test.headers["cache-control"]).toBe("no-store");

    expect(calls.map((call) => call[0])).toEqual([
      "getDeliveryStatus",
      "setAccountEmail",
      "sendTestNotification",
    ]);
    // The address is exactly what the verified ID token carried; the browser names none.
    expect(calls[1]?.slice(1)).toEqual([expect.any(String), "Person@Example.com"]);
    await app.close();
  });

  it("takes the notification address only from a verified ID token for the same candidate", async () => {
    const { notifications, calls } = fake({
      async setAccountEmail(...args) {
        calls.push(["setAccountEmail", ...args]);
        if (args[1] === undefined) throw new NotificationsError("invalid_request");
      },
    });
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-email-owner", { scope: "profile:read profile:write" });
    const put = (extra: Record<string, string>, payload?: unknown) =>
      app.inject({
        method: "PUT",
        url: "/v1/notifications/delivery/email",
        headers: {
          authorization: `Bearer ${token}`,
          ...extra,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      });

    // No proof, or a proof for another candidate, never reaches Notifications.
    expect((await put({})).statusCode).toBe(401);
    expect(
      (await put({ "x-ai-job-apply-reauthentication": MISMATCHED_ID_TOKEN_PROOF })).statusCode,
    ).toBe(401);
    // A browser-supplied address is refused outright, even beside a valid proof.
    expect(
      (
        await put(
          { "x-ai-job-apply-reauthentication": VERIFIED_EMAIL_ID_TOKEN_PROOF },
          { address: "someone-else@example.com" },
        )
      ).statusCode,
    ).toBe(400);
    expect(calls).toEqual([]);
    // A proof whose email the provider did not verify carries no address, so nothing is recorded.
    const unverified = await put({
      "x-ai-job-apply-reauthentication": UNVERIFIED_EMAIL_ID_TOKEN_PROOF,
    });
    expect(unverified.statusCode).toBe(400);
    expect(calls.map((call) => call[0])).toEqual(["setAccountEmail"]);
    expect(calls[0]?.[2]).toBeUndefined();
    await app.close();
  });

  it("requires the right scope for delivery routes and registers none when disabled", async () => {
    const { notifications } = fake();
    const { app, issuer } = await createApp({ notifications });
    const readOnly = await issuer.issue("notif-delivery-ro", { scope: "profile:read" });
    const headers = { authorization: `Bearer ${readOnly}`, "content-type": "application/json" };
    expect(
      (await app.inject({ method: "GET", url: "/v1/notifications/delivery", headers })).statusCode,
    ).toBe(200);
    for (const [method, url, payload] of [
      ["PUT", "/v1/notifications/delivery/email", undefined],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: payload === undefined ? { authorization: headers.authorization } : headers,
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/notifications/delivery/test",
          headers: { authorization: `Bearer ${readOnly}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/v1/notifications/delivery" })).statusCode,
    ).toBe(401);
    await app.close();

    const off = await createApp();
    const token = await off.issuer.issue("notif-delivery-off", { scope: "profile:read" });
    const missing = await off.app.inject({
      method: "GET",
      url: "/v1/notifications/delivery",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
    await off.app.close();
  });

  it("rejects malformed delivery input and maps service errors", async () => {
    const { notifications } = fake({
      async sendTestNotification() {
        throw new NotificationsError("rate_limited");
      },
    });
    const { app, issuer } = await createApp({ notifications });
    const token = await issuer.issue("notif-delivery-err", { scope: "profile:read profile:write" });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const send = (method: "PUT" | "POST", url: string, payload: unknown) =>
      app.inject({ method, url, headers, payload: JSON.stringify(payload) });

    for (const bad of [{}, { address: "person@example.com" }])
      expect((await send("PUT", "/v1/notifications/delivery/email", bad)).statusCode).toBe(400);

    const testLimited = await app.inject({
      method: "POST",
      url: "/v1/notifications/delivery/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(testLimited.statusCode).toBe(429);
    expect(testLimited.json()).toMatchObject({ code: "rate_limited" });
    expect(
      (await send("POST", "/v1/notifications/delivery/test", { unexpected: true })).statusCode,
    ).toBe(400);
    // The code, removal and browser routes no longer exist.
    for (const [method, url] of [
      ["DELETE", "/v1/notifications/delivery/email"],
      ["POST", "/v1/notifications/delivery/email/confirmation"],
      ["POST", "/v1/notifications/delivery/push-subscriptions"],
      ["DELETE", `/v1/notifications/delivery/push-subscriptions/${ITEM}`],
    ] as const)
      expect(
        (await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } }))
          .statusCode,
      ).toBe(404);
    await app.close();
  });
});
