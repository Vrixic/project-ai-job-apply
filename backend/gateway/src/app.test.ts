import "reflect-metadata";
import { createHash } from "node:crypto";
import type {
  AccountDeletionRequest,
  CandidateDataExport,
  CreateProfileFactRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CurrentUser,
  JobPreferenceSet,
  JobReport,
  JobContribution,
  MatchAssessment,
  Operation,
  ProfileFact,
  ProfileFactCollection,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  ResumeDocument,
  ResumeDocumentCollection,
  SavedJob,
  SavedJobPage,
  SavedJobSearchRequest,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal, IdTokenVerifier } from "@ai-job-apply/auth";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import {
  BillingEntitlementService,
  type BillingEntitlementStore,
  EntitlementCache,
  type EntitlementEvaluation,
  type EntitlementReadService,
  type EntitlementSchedule,
} from "@ai-job-apply/billing-service";
import { type DocumentStore, ResumeUploadRegistrationError } from "@ai-job-apply/documents-service";
import {
  type ActiveJobRecord,
  type ActiveJobSearchInput,
  type CreateJobReportCommand,
  type CreateJobContributionCommand,
  type ModerationCase as DomainModerationCase,
  JobAlreadyReportedError,
  type JobCatalogReader,
  type JobModeration,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  JobReportServiceUnavailableError,
  type JobReports,
  type JobContributions,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
  JobReportTargetUnavailableError,
  JobSearchCatalogChangedError,
} from "@ai-job-apply/jobs-service";
import {
  MatchAssessmentServiceUnavailableError,
  type MatchAssessments,
  MatchAssessmentTargetUnavailableError,
  MatchAssessmentUnavailableError,
  MatchPreferencesRequiredError,
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
  type SavedJobs,
} from "@ai-job-apply/matching-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import {
  assertCandidateRightsAuthentication,
  type CandidateRightsPolicy,
} from "@ai-job-apply/profile-service/candidate-rights";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privacySafeRequestFailure } from "./app.module.js";
import { createGatewayApplication } from "./application.js";
import {
  type AuthorizedHttpApiEvent,
  createApiGatewayHandler,
  createInvocationPrincipalBridge,
} from "./lambda.js";

const FRESH_ID_TOKEN_PROOF = "fresh-header-segment.fresh-payload-segment.fresh-signature-segment";
const RECENT_PASSWORD_ID_TOKEN_PROOF =
  "password-header-segment.password-payload-segment.password-signature-segment";
const STALE_ID_TOKEN_PROOF = "stale-header-segment.stale-payload-segment.stale-signature-segment";
const FUTURE_ID_TOKEN_PROOF =
  "future-header-segment.future-payload-segment.future-signature-segment";
const MISMATCHED_ID_TOKEN_PROOF =
  "mismatch-header-segment.mismatch-payload-segment.mismatch-signature-segment";

class MemoryProfileStore implements ProfileStore {
  resolveUserCalls = 0;
  candidateRightsPrincipals: AuthPrincipal[] = [];
  private readonly users = new Map<string, CurrentUser>();
  private preferences: JobPreferenceSet | undefined;
  private readonly operations = new Map<string, Operation>();
  private readonly facts = new Map<string, ProfileFact>();
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

  seedFact(fact: ProfileFact): void {
    this.facts.set(fact.id, fact);
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

  async listProfileFacts(): Promise<ProfileFactCollection> {
    const facts = [...this.facts.values()];
    return {
      facts,
      confirmedCount: facts.filter(
        (fact) => fact.verification === "confirmed" && fact.availability?.state !== "invalidated",
      ).length,
      proposedCount: facts.filter(
        (fact) => fact.verification === "proposed" && fact.availability?.state !== "invalidated",
      ).length,
    };
  }

  async createProfileFact(_userId: string, input: CreateProfileFactRequest): Promise<ProfileFact> {
    const timestamp = new Date().toISOString();
    const fact: ProfileFact = {
      id: uuidv7(),
      ...input,
      verification: "confirmed",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.facts.set(fact.id, fact);
    return fact;
  }

  async updateProfileFact(
    _userId: string,
    factId: string,
    input: UpdateProfileFactRequest,
  ): Promise<ProfileFact | null> {
    const current = this.facts.get(factId);
    if (!current) {
      return null;
    }
    if (current.version !== input.expectedVersion) {
      const { ProfileFactVersionConflictError } = await import("@ai-job-apply/profile-service");
      throw new ProfileFactVersionConflictError();
    }
    const next: ProfileFact = {
      ...current,
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.verification ? { verification: input.verification } : {}),
      ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
      ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.facts.set(factId, next);
    return next;
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

  async ping(): Promise<void> {}

  async contribute(command: CreateJobContributionCommand): Promise<JobContribution> {
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

  async close(): Promise<void> {}
}

async function createApp() {
  const issuer = await createTestTokenIssuer();
  const store = new MemoryProfileStore();
  const catalog = new MemoryJobCatalog();
  const documents = new MemoryDocumentStore();
  const savedJobs = new MemorySavedJobs();
  const jobReports = new MemoryJobReports();
  const jobContributions = new MemoryJobContributions();
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
  };
  const app = await createGatewayApplication({
    store,
    catalog,
    savedJobs,
    jobReports,
    jobContributions,
    moderation,
    matchAssessments,
    entitlements,
    documents,
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
    jobReports,
    jobContributions,
    matchAssessments,
    entitlements,
    moderation,
    now,
    idTokenVerificationTokens,
  };
}

describe("candidate API", () => {
  let app: NestFastifyApplication;
  let issuer: Awaited<ReturnType<typeof createTestTokenIssuer>>;
  let catalog: MemoryJobCatalog;
  let store: MemoryProfileStore;
  let savedJobs: MemorySavedJobs;
  let jobReports: MemoryJobReports;
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
      version: 0,
      evaluatedAt: now.toISOString(),
    });
    expect(projected.json()).toEqual({
      plan: "pro",
      accessState: "grace",
      grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
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

  it("creates, lists, and corrects owned profile facts through explicit versions", async () => {
    const token = await issuer.issue("candidate-profile-facts");
    const authorization = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/v1/profile/facts",
      headers: { ...authorization, "idempotency-key": "profile-fact-create-0001" },
      payload: {
        kind: "skill",
        key: "programming_language",
        value: "TypeScript",
        sensitivity: "standard",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      verification: "confirmed",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/profile/facts",
      headers: authorization,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ confirmedCount: 1, proposedCount: 0 });

    const corrected = await app.inject({
      method: "PATCH",
      url: `/v1/profile/facts/${created.json().id}`,
      headers: { ...authorization, "idempotency-key": "profile-fact-update-0001" },
      payload: { expectedVersion: 1, value: "TypeScript and JavaScript" },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ version: 2, value: "TypeScript and JavaScript" });

    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/profile/facts/${created.json().id}`,
      headers: { ...authorization, "idempotency-key": "profile-fact-update-0002" },
      payload: { expectedVersion: 1, value: "stale correction" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("version_conflict");
  });

  it("returns proposal evidence and additive system availability without sensitive source data", async () => {
    const token = await issuer.issue("candidate-profile-proposal");
    const factId = uuidv7();
    const documentId = uuidv7();
    store.seedFact({
      id: factId,
      kind: "skill",
      key: "skill",
      value: "TypeScript",
      verification: "confirmed",
      availability: { state: "invalidated", reasonCode: "source_security_hold" },
      sensitivity: "standard",
      source: { type: "resume", reference: `resume:${documentId}:v1:resume-parser-v1` },
      evidence: {
        supportingSpans: [
          {
            documentId,
            documentVersion: 1,
            parserVersion: "resume-parser-v1",
            blockIndex: 0,
            startOffset: 8,
            endOffset: 18,
            page: 1,
          },
        ],
      },
      version: 2,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:05:00.000Z",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/profile/facts",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      facts: expect.arrayContaining([
        expect.objectContaining({
          id: factId,
          verification: "confirmed",
          availability: { state: "invalidated", reasonCode: "source_security_hold" },
          evidence: { supportingSpans: [expect.objectContaining({ documentId, blockIndex: 0 })] },
        }),
      ]),
    });
    expect(response.body).not.toContain("objectKey");
    expect(response.body).not.toContain("sha256");
    expect(response.body).not.toContain("excerpt");
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
    expect(hidden.statusCode).toBe(404);

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
  });

  it("rejects contribution payload leakage and incomplete preview approval", async () => {
    const token = await issuer.issue("candidate-contribution-invalid", {
      scope: "jobs:contribute",
    });
    const base = {
      schemaVersion: 1,
      contributionId: uuidv7(),
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
    expect(created.json().document).not.toHaveProperty("sourceObjectKey");
    expect(listed.statusCode).toBe(200);
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
