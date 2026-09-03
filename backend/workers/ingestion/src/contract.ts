import type {
  CatalogObservation,
  CatalogWithdrawal,
  JobEmploymentType,
  JobProvenance,
  JobSourceProvider,
  JobStructuredLocation,
  JobWorkMode,
  RecordObservationResult,
  RecordWithdrawalResult,
} from "@ai-job-apply/jobs-service";

export const sourceIdentifierPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const adapterVersionPattern = /^[a-z0-9][a-z0-9._-]{2,99}$/;
export const maximumSourcePollAttempt = 5;

export function assertSourcePollAttempt(attempt: unknown): asserts attempt is number {
  if (
    !Number.isSafeInteger(attempt) ||
    Number(attempt) < 1 ||
    Number(attempt) > maximumSourcePollAttempt
  ) {
    throw new Error(
      `The source poll attempt must be a whole number from 1 through ${maximumSourcePollAttempt}`,
    );
  }
}

export interface SourceJobObservation {
  companyName: string;
  title: string;
  locations: readonly string[];
  description: string;
  sourceUrl: string;
  atsTenant?: string;
  externalJobId?: string;
  employerRequisitionId?: string;
  verifiedCompanyDomain?: string;
  department?: string;
  workMode?: JobWorkMode;
  employmentType?: JobEmploymentType;
  datePosted?: Date;
  applicationUrl?: string;
  structuredLocations?: readonly JobStructuredLocation[];
  validThrough?: Date;
}

export interface SourceJobWithdrawal {
  sourceUrl: string;
  atsTenant: string;
  externalJobId: string;
}

export interface SourcePollContext {
  readonly observedAt: Date;
  readonly signal: AbortSignal;
  readonly attempt: number;
}

export interface SourceExactPollContext extends SourcePollContext {
  readonly externalJobId: string;
}

export type SourceRetryReason = "rate_limited" | "source_unavailable" | "timeout";

export type SourcePollResult =
  | {
      kind: "success";
      observations: readonly SourceJobObservation[];
      withdrawals?: readonly SourceJobWithdrawal[];
    }
  | { kind: "retry"; reason: SourceRetryReason; retryAfterMs?: number };

export interface IngestionSourceAdapter {
  readonly sourceId: string;
  readonly adapterVersion: string;
  poll(context: SourcePollContext): Promise<SourcePollResult>;
  pollExact?(context: SourceExactPollContext): Promise<SourcePollResult>;
}

export interface SourceRegistration {
  sourceId: string;
  provider: JobSourceProvider;
  provenance: JobProvenance;
  adapter: IngestionSourceAdapter;
  enabled?: boolean;
}

export type SourceRuntimeGate = (sourceId: string) => boolean;

export interface SourceExecutionIdentity {
  sourceId: string;
  adapterVersion: string;
}

export type SourceExecutionGate = (identity: Readonly<SourceExecutionIdentity>) => Promise<boolean>;

export interface JobCatalogIngestionPort {
  recordObservation(input: CatalogObservation): Promise<RecordObservationResult>;
  recordWithdrawal?(input: CatalogWithdrawal): Promise<RecordWithdrawalResult>;
}

export interface IngestionRunSuccess {
  sourceId: string;
  status: "succeeded";
  observationCount: number;
  createdCount: number;
  updatedCount: number;
}

export interface IngestionRunRetry {
  sourceId: string;
  status: "retry";
  observationCount: 0;
  createdCount: 0;
  updatedCount: 0;
  reason: SourceRetryReason;
  retryAfterMs: number;
}

export interface IngestionRunAborted {
  sourceId: string;
  status: "aborted";
  observationCount: number;
  createdCount: number;
  updatedCount: number;
}

export type IngestionRunResult = IngestionRunSuccess | IngestionRunRetry | IngestionRunAborted;
