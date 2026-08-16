import type {
  CatalogObservation,
  JobEmploymentType,
  JobProvenance,
  JobSourceProvider,
  JobWorkMode,
  RecordObservationResult,
} from "@ai-job-apply/jobs-service";

export const sourceIdentifierPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const adapterVersionPattern = /^[a-z0-9][a-z0-9._-]{2,99}$/;

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
  validThrough?: Date;
}

export interface SourcePollContext {
  observedAt: Date;
  signal: AbortSignal;
}

export type SourceRetryReason = "rate_limited" | "source_unavailable" | "timeout";

export type SourcePollResult =
  | { kind: "success"; observations: readonly SourceJobObservation[] }
  | { kind: "retry"; reason: SourceRetryReason; retryAfterMs?: number };

export interface IngestionSourceAdapter {
  readonly sourceId: string;
  readonly adapterVersion: string;
  poll(context: SourcePollContext): Promise<SourcePollResult>;
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
