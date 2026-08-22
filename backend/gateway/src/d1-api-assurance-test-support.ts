import type {
  CreateProfileFactRequest,
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  CurrentUser,
  JobPreferenceSet,
  Operation,
  ProfileFact,
  ProfileFactCollection,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  SavedJob,
  SavedJobPage,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import {
  coreCapabilities,
  type EntitlementEvaluation,
  type EntitlementReadService,
} from "@ai-job-apply/billing-service";
import type { DocumentStore } from "@ai-job-apply/documents-service";
import type {
  ActiveJobRecord,
  ActiveJobSearchInput,
  ActiveJobSearchPage,
  ActiveJobSummaryResolutionPage,
  CreateJobReportCommand,
  JobCatalogReader,
  JobModeration,
  JobReportServiceUnavailableError,
  JobReports,
  MatchableJobResolution,
} from "@ai-job-apply/jobs-service";
import type { MatchAssessments, SavedJobs } from "@ai-job-apply/matching-service";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import { createGatewayApplication } from "./application.js";

export const SYNTHETIC_OWNER_A = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
export const SYNTHETIC_OWNER_B = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2";
export const SYNTHETIC_JOB_ID = "018f92b0-4ad7-7b1d-8f44-b7ae694c85d1";
export const SYNTHETIC_PRIVATE_CANARY =
  "synthetic-private-canary@example.test bearer-synthetic-secret";

const FIXED_NOW = new Date("2026-08-16T12:00:00.000Z");

function unused(method: string): never {
  throw new Error(`D1 assurance does not exercise ${method}`);
}

export class SyntheticAssuranceProfileStore implements ProfileStore {
  pingFailure: Error | undefined;

  async resolveUser(principal: AuthPrincipal): Promise<CurrentUser> {
    if (principal.subject === "synthetic-candidate-a") return { id: SYNTHETIC_OWNER_A };
    if (principal.subject === "synthetic-candidate-b") return { id: SYNTHETIC_OWNER_B };
    throw new Error(SYNTHETIC_PRIVATE_CANARY);
  }

  async getPreferences(): Promise<JobPreferenceSet | null> {
    return unused("ProfileStore.getPreferences");
  }

  async putPreferences(
    _userId: string,
    _input: PutJobPreferencesRequest,
    _idempotencyKey: string,
  ): Promise<PutJobPreferencesResponse> {
    return unused("ProfileStore.putPreferences");
  }

  async listProfileFacts(): Promise<ProfileFactCollection> {
    return unused("ProfileStore.listProfileFacts");
  }

  async createProfileFact(_userId: string, _input: CreateProfileFactRequest): Promise<ProfileFact> {
    return unused("ProfileStore.createProfileFact");
  }

  async updateProfileFact(
    _userId: string,
    _factId: string,
    _input: UpdateProfileFactRequest,
  ): Promise<ProfileFact | null> {
    return unused("ProfileStore.updateProfileFact");
  }

  async getOperation(): Promise<Operation | null> {
    return unused("ProfileStore.getOperation");
  }

  async getPreferencesById(): Promise<JobPreferenceSet | null> {
    return unused("ProfileStore.getPreferencesById");
  }

  async markOperationRunning(): Promise<void> {
    return unused("ProfileStore.markOperationRunning");
  }

  async completeReadinessOperation(
    _operationId: string,
    _preferenceSetId: string,
    _readiness: ProfileReadiness,
  ): Promise<void> {
    return unused("ProfileStore.completeReadinessOperation");
  }

  async failReadinessOperation(): Promise<void> {
    return unused("ProfileStore.failReadinessOperation");
  }

  async failDurableReadinessOperation(): Promise<void> {
    return unused("ProfileStore.failDurableReadinessOperation");
  }

  async ping(): Promise<void> {
    if (this.pingFailure) throw this.pingFailure;
  }

  async close(): Promise<void> {}
}

export class SyntheticAssuranceCatalog implements JobCatalogReader {
  pingFailure: Error | undefined;
  searchFailure: Error | undefined;

  readonly job: ActiveJobRecord = {
    id: SYNTHETIC_JOB_ID,
    company: {
      id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85d2",
      name: "Synthetic Assurance Company",
      verifiedDomain: "assurance.example.test",
    },
    title: "Synthetic Platform Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    description: "Synthetic-only detail excluded from search responses.",
    status: "active",
    firstObservedAt: new Date("2026-08-15T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-08-16T11:00:00.000Z"),
    expiresAt: new Date("2026-09-15T12:00:00.000Z"),
    sources: [
      {
        provider: "other",
        provenance: "authorized_fixture",
        canonicalUrl: "https://assurance.example.test/jobs/platform-engineer",
        firstObservedAt: new Date("2026-08-15T12:00:00.000Z"),
        lastVerifiedAt: new Date("2026-08-16T11:00:00.000Z"),
      },
    ],
  };

  async ping(): Promise<void> {
    if (this.pingFailure) throw this.pingFailure;
  }

  async getCatalogRevision(): Promise<string> {
    return "synthetic-assurance-r1";
  }

  async resolveActiveJobSummaries(): Promise<ActiveJobSummaryResolutionPage> {
    return {
      catalogRevision: "synthetic-assurance-r1",
      items: [{ requestedJobId: this.job.id, job: this.job }],
    };
  }

  async getActiveJob(jobId: string): Promise<ActiveJobRecord | null> {
    return jobId === this.job.id ? this.job : null;
  }

  async getMatchableJob(jobId: string): Promise<MatchableJobResolution | null> {
    return jobId === this.job.id
      ? {
          requestedJobId: jobId,
          job: {
            id: this.job.id,
            catalogRevision: "synthetic-assurance-r1",
            eligibleThrough: this.job.expiresAt.toISOString(),
            title: this.job.title,
            locations: [...this.job.locations],
            workMode: "remote",
            employmentType: "full_time",
          },
        }
      : null;
  }

  async searchActiveJobs(_input: ActiveJobSearchInput): Promise<ActiveJobSearchPage> {
    if (this.searchFailure) throw this.searchFailure;
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { items: [this.job] };
  }
}

export class SyntheticAssuranceJobReports implements JobReports {
  pingFailure: Error | undefined;
  reportFailure: JobReportServiceUnavailableError | undefined;
  #sequence = 1;

  async ping(): Promise<void> {
    if (this.pingFailure) throw this.pingFailure;
  }

  async report(command: CreateJobReportCommand) {
    if (this.reportFailure) throw this.reportFailure;
    const suffix = this.#sequence.toString(16).padStart(12, "0");
    this.#sequence += 1;
    return {
      id: `018f92b0-4ad7-7b1d-8f44-${suffix}`,
      requestedJobId: command.requestedJobId,
      canonicalJobId: SYNTHETIC_JOB_ID,
      reason: command.reason,
      createdAt: FIXED_NOW.toISOString(),
    };
  }
}

class SyntheticAssuranceSavedJobs implements SavedJobs {
  async create(): Promise<SavedJob> {
    return unused("SavedJobs.create");
  }

  async list(): Promise<SavedJobPage> {
    return unused("SavedJobs.list");
  }

  async delete(): Promise<void> {
    return unused("SavedJobs.delete");
  }

  async ping(): Promise<void> {}
}

class SyntheticAssuranceMatchAssessments implements MatchAssessments {
  async assess(): Promise<never> {
    return unused("MatchAssessments.assess");
  }
}

class SyntheticAssuranceEntitlements implements EntitlementReadService {
  async evaluate(_userId: string, now: Date): Promise<EntitlementEvaluation> {
    return {
      valid: true,
      plan: "free",
      accessState: "active",
      grants: coreCapabilities,
      version: 0,
      evaluatedAt: now.toISOString(),
    };
  }

  async allows(_userId: string, capability: string): Promise<boolean> {
    return coreCapabilities.includes(capability as (typeof coreCapabilities)[number]);
  }

  async ping(): Promise<void> {}
}

class SyntheticAssuranceDocuments implements DocumentStore {
  async listResumeDocuments() {
    return { documents: [] };
  }

  async createResumeUpload(
    _userId: string,
    _input: CreateResumeUploadRequest,
  ): Promise<CreateResumeUploadResponse> {
    return unused("DocumentStore.createResumeUpload");
  }

  async close(): Promise<void> {}
}

class SyntheticAssuranceModeration implements JobModeration {
  async ping(): Promise<void> {}
  async openCase(): Promise<never> {
    return unused("JobModeration.openCase");
  }
  async resolveCase(): Promise<never> {
    return unused("JobModeration.resolveCase");
  }
  async summarizeReports(): Promise<never> {
    return unused("JobModeration.summarizeReports");
  }
  async searchCases(): Promise<never> {
    return unused("JobModeration.searchCases");
  }
}

export async function createSyntheticAssuranceApplication() {
  const issuer = await createTestTokenIssuer();
  const store = new SyntheticAssuranceProfileStore();
  const catalog = new SyntheticAssuranceCatalog();
  const jobReports = new SyntheticAssuranceJobReports();
  const app = await createGatewayApplication({
    store,
    catalog,
    jobReports,
    moderation: new SyntheticAssuranceModeration(),
    savedJobs: new SyntheticAssuranceSavedJobs(),
    matchAssessments: new SyntheticAssuranceMatchAssessments(),
    entitlements: new SyntheticAssuranceEntitlements(),
    documents: new SyntheticAssuranceDocuments(),
    verifier: issuer.verifier,
    releaseSha: "synthetic-d1-assurance",
    clock: () => new Date(FIXED_NOW.getTime()),
  });
  return { app, issuer, store, catalog, jobReports };
}
