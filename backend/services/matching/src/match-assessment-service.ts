import type {
  JobPreferenceSet,
  MatchAssessment as MatchAssessmentResponse,
} from "@ai-job-apply/api-contracts";
import {
  assessMatch,
  MatchAssessmentInputRejectedError,
  MatchAssessmentUnavailableError,
  type MatchableJobSnapshot,
} from "./match-assessment.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface MatchAssessmentPreferenceReader {
  getPreferences(ownerUserId: string): Promise<JobPreferenceSet | null>;
}

export interface MatchAssessmentJobResolution {
  requestedJobId: string;
  job: MatchableJobSnapshot;
}

export interface MatchAssessmentJobReader {
  getMatchableJob(jobId: string, now: Date): Promise<MatchAssessmentJobResolution | null>;
}

export interface MatchAssessments {
  assess(ownerUserId: string, requestedJobId: string): Promise<MatchAssessmentResponse>;
}

export class MatchPreferencesRequiredError extends Error {
  constructor() {
    super("Save job preferences before requesting a match assessment");
    this.name = "MatchPreferencesRequiredError";
  }
}

export class MatchAssessmentTargetUnavailableError extends Error {
  constructor() {
    super("The job is unavailable");
    this.name = "MatchAssessmentTargetUnavailableError";
  }
}

export class MatchAssessmentServiceUnavailableError extends Error {
  constructor() {
    super("The match assessment is temporarily unavailable");
    this.name = "MatchAssessmentServiceUnavailableError";
  }
}

function exactUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

function immutableResponse(
  requestedJobId: string,
  assessedAt: string,
  assessment: ReturnType<typeof assessMatch>,
): MatchAssessmentResponse {
  const evidence = Object.freeze([...assessment.evidence]) as MatchAssessmentResponse["evidence"];
  return Object.freeze({
    schemaVersion: 1,
    requestedJobId,
    canonicalJobId: assessment.jobId,
    preferenceSetId: assessment.preferenceSetId,
    preferenceVersion: assessment.preferenceVersion,
    preferenceUpdatedAt: assessment.preferenceUpdatedAt,
    catalogRevision: assessment.catalogRevision,
    assessedAt,
    gate: assessment.gate,
    evidence,
  });
}

export class MatchAssessmentService implements MatchAssessments {
  constructor(
    private readonly preferences: MatchAssessmentPreferenceReader,
    private readonly jobs: MatchAssessmentJobReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private timestamp(): Date {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new MatchAssessmentServiceUnavailableError();
    }
    return new Date(value.getTime());
  }

  async assess(ownerUserId: string, requestedJobId: string): Promise<MatchAssessmentResponse> {
    if (!exactUuidV7(ownerUserId) || !exactUuidV7(requestedJobId)) {
      throw new MatchAssessmentServiceUnavailableError();
    }
    const eligibilityAt = this.timestamp();
    let preferences: JobPreferenceSet | null;
    try {
      preferences = await this.preferences.getPreferences(ownerUserId);
    } catch {
      throw new MatchAssessmentServiceUnavailableError();
    }
    if (!preferences) throw new MatchPreferencesRequiredError();
    if (Object.hasOwn(preferences, "requiresSponsorship")) {
      throw new MatchAssessmentUnavailableError();
    }

    let resolution: MatchAssessmentJobResolution | null;
    try {
      resolution = await this.jobs.getMatchableJob(
        requestedJobId,
        new Date(eligibilityAt.getTime()),
      );
    } catch {
      throw new MatchAssessmentServiceUnavailableError();
    }
    if (!resolution) throw new MatchAssessmentTargetUnavailableError();
    if (resolution.requestedJobId !== requestedJobId) {
      throw new MatchAssessmentServiceUnavailableError();
    }

    const assessedAt = this.timestamp();
    if (assessedAt < eligibilityAt) {
      throw new MatchAssessmentServiceUnavailableError();
    }
    const preferenceUpdatedAt = Date.parse(preferences.updatedAt);
    if (!Number.isFinite(preferenceUpdatedAt) || preferenceUpdatedAt > assessedAt.getTime()) {
      throw new MatchAssessmentServiceUnavailableError();
    }
    const eligibleThrough = Date.parse(resolution.job.eligibleThrough);
    if (Number.isFinite(eligibleThrough) && eligibleThrough <= assessedAt.getTime()) {
      throw new MatchAssessmentTargetUnavailableError();
    }

    try {
      return immutableResponse(
        requestedJobId,
        assessedAt.toISOString(),
        assessMatch({ preferences, job: resolution.job }),
      );
    } catch (error) {
      if (error instanceof MatchAssessmentUnavailableError) throw error;
      if (error instanceof MatchAssessmentInputRejectedError) {
        throw new MatchAssessmentServiceUnavailableError();
      }
      throw new MatchAssessmentServiceUnavailableError();
    }
  }
}
