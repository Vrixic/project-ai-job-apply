export const jobReportReasons = [
  "job_closed",
  "job_not_found",
  "job_inaccurate",
  "suspected_scam",
  "duplicate_listing",
  "other_catalog_issue",
] as const;

export type JobReportReason = (typeof jobReportReasons)[number];

export interface JobReport {
  id: string;
  requestedJobId: string;
  canonicalJobId: string;
  reason: JobReportReason;
  createdAt: string;
}

export interface CreateJobReportCommand {
  ownerUserId: string;
  requestedJobId: string;
  reason: JobReportReason;
  idempotencyKey: string;
}

export interface JobReportStore {
  ping(): Promise<void>;
  create(command: CreateJobReportCommand): Promise<JobReport>;
}

export interface JobReports {
  ping(): Promise<void>;
  report(command: CreateJobReportCommand): Promise<JobReport>;
}

export class JobReportTargetUnavailableError extends Error {
  constructor() {
    super("The requested active job is unavailable for reporting");
    this.name = "JobReportTargetUnavailableError";
  }
}

export class JobReportIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different job report");
    this.name = "JobReportIdempotencyConflictError";
  }
}

export class JobAlreadyReportedError extends Error {
  constructor() {
    super("The authenticated owner already reported this canonical job");
    this.name = "JobAlreadyReportedError";
  }
}

export class JobReportLimitError extends Error {
  constructor() {
    super("The authenticated owner reached the retained job-report limit");
    this.name = "JobReportLimitError";
  }
}

export class JobReportServiceUnavailableError extends Error {
  constructor() {
    super("Job reporting is temporarily unavailable");
    this.name = "JobReportServiceUnavailableError";
  }
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactCommand(command: CreateJobReportCommand): CreateJobReportCommand {
  if (!UUID_V7_PATTERN.test(command.ownerUserId)) {
    throw new TypeError("The job-report owner identifier is invalid");
  }
  if (!UUID_V7_PATTERN.test(command.requestedJobId)) {
    throw new TypeError("The reported job identifier is invalid");
  }
  if (!jobReportReasons.includes(command.reason)) {
    throw new TypeError("The job-report reason is invalid");
  }
  if (command.idempotencyKey.length < 16 || command.idempotencyKey.length > 128) {
    throw new TypeError("The job-report idempotency key is invalid");
  }
  return { ...command };
}

function knownReportingError(error: unknown): boolean {
  return (
    error instanceof JobReportTargetUnavailableError ||
    error instanceof JobReportIdempotencyConflictError ||
    error instanceof JobAlreadyReportedError ||
    error instanceof JobReportLimitError
  );
}

export class JobReportingService implements JobReports {
  constructor(private readonly store: JobReportStore) {}

  ping(): Promise<void> {
    return this.store.ping();
  }

  async report(command: CreateJobReportCommand): Promise<JobReport> {
    const normalized = exactCommand(command);
    try {
      const report = await this.store.create(normalized);
      return Object.freeze({ ...report });
    } catch (error) {
      if (knownReportingError(error)) throw error;
      throw new JobReportServiceUnavailableError();
    }
  }
}

export type ModerationTarget =
  | Readonly<{ kind: "job"; jobId: string }>
  | Readonly<{
      kind: "source";
      sourceId: string;
      adapterVersion: string;
      adapterConfigSha256: string;
    }>;

export type ModerationOpenReason = "candidate_reports" | "catalog_integrity" | "source_integrity";
export type ModerationResolution = "no_action" | "block_job" | "pause_source";
export type ModerationResolutionReason =
  | "insufficient_evidence"
  | "report_confirmed"
  | "catalog_policy_violation"
  | "source_integrity_failure";

export interface ModerationCase {
  id: string;
  target: ModerationTarget;
  status: "open" | "resolved";
  version: 0 | 1;
  openedBy: string;
  openReasonCode: ModerationOpenReason;
  openedAt: string;
  resolution?: ModerationResolution;
  resolvedBy?: string;
  resolutionReasonCode?: ModerationResolutionReason;
  resolvedAt?: string;
}

export interface JobReportSummary {
  canonicalJobId: string;
  total: number;
  counts: Readonly<Record<JobReportReason, number>>;
}

export interface JobModerationStore {
  openCase(input: {
    target: ModerationTarget;
    operatorId: string;
    reasonCode: ModerationOpenReason;
  }): Promise<ModerationCase>;
  resolveCase(input: {
    caseId: string;
    expectedVersion: 0;
    resolution: ModerationResolution;
    operatorId: string;
    reasonCode: ModerationResolutionReason;
  }): Promise<ModerationCase>;
  summarizeReports(canonicalJobId: string): Promise<JobReportSummary>;
  isSourcePaused(target: Extract<ModerationTarget, { kind: "source" }>): Promise<boolean>;
}

export class ModerationConflictError extends Error {
  constructor(message = "The moderation case changed") {
    super(message);
    this.name = "ModerationConflictError";
  }
}

export class ModerationTargetUnavailableError extends Error {
  constructor() {
    super("The moderation target is unavailable");
    this.name = "ModerationTargetUnavailableError";
  }
}
