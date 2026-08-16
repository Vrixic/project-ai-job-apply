import type { JobPreferenceSet } from "@ai-job-apply/api-contracts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATALOG_REVISION_PATTERN = /^[1-9][0-9]{0,18}$/;
const CATALOG_REVISION_MAX = 9_223_372_036_854_775_807n;
const PREFERENCE_VERSION_MAX = 2_147_483_647;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CANONICAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WORK_MODES = ["remote", "hybrid", "on_site"] as const;
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;

export type MatchWorkMode = (typeof WORK_MODES)[number];
export type MatchEmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export interface MatchPreferenceSnapshot {
  readonly id: JobPreferenceSet["id"];
  readonly version: JobPreferenceSet["version"];
  readonly updatedAt: JobPreferenceSet["updatedAt"];
  readonly targetRoles: readonly string[];
  readonly locations: readonly string[];
  readonly workModes: readonly MatchWorkMode[];
  readonly employmentTypes: readonly MatchEmploymentType[];
  readonly salaryMinimum?: number;
  readonly salaryCurrency?: string;
  readonly requiresSponsorship?: boolean;
}

export interface MatchableJobSnapshot {
  readonly id: string;
  readonly catalogRevision: string;
  readonly eligibleThrough: string;
  readonly title: string;
  readonly locations: readonly string[];
  readonly workMode?: MatchWorkMode | "unknown";
  readonly employmentType?: MatchEmploymentType | "unknown";
}

export interface MatchAssessmentInput {
  readonly preferences: MatchPreferenceSnapshot;
  readonly job: MatchableJobSnapshot;
}

export type MatchConstraint =
  | "work_mode"
  | "employment_type"
  | "target_role"
  | "location"
  | "compensation"
  | "authorization_sponsorship"
  | "seniority"
  | "blocked_company"
  | "qualifications";

export type MatchEvidenceState = "satisfied" | "conflict" | "unknown";

export type MatchEvidenceReasonCode =
  | "work_mode_selected"
  | "work_mode_conflict"
  | "work_mode_unavailable"
  | "employment_type_selected"
  | "employment_type_conflict"
  | "employment_type_unavailable"
  | "target_role_exact_overlap"
  | "target_role_not_established"
  | "location_exact_overlap"
  | "location_not_established"
  | "compensation_semantics_unavailable"
  | "authorization_sponsorship_unavailable"
  | "seniority_semantics_unavailable"
  | "blocked_company_preferences_unavailable"
  | "qualification_evidence_unavailable";

export interface MatchConstraintEvidence {
  readonly constraint: MatchConstraint;
  readonly state: MatchEvidenceState;
  readonly reasonCode: MatchEvidenceReasonCode;
}

export interface MatchAssessment {
  readonly schemaVersion: 1;
  readonly preferenceSetId: string;
  readonly preferenceVersion: number;
  readonly preferenceUpdatedAt: string;
  readonly jobId: string;
  readonly catalogRevision: string;
  readonly gate: "excluded" | "review_required";
  readonly evidence: readonly MatchConstraintEvidence[];
}

export class MatchAssessmentInputRejectedError extends Error {
  constructor() {
    super("Match assessment input was rejected");
    this.name = "MatchAssessmentInputRejectedError";
  }
}

export class MatchAssessmentUnavailableError extends Error {
  readonly code = "restricted_preference_requires_review" as const;

  constructor() {
    super("Match assessment is unavailable pending restricted-preference review");
    this.name = "MatchAssessmentUnavailableError";
  }
}

function rejectInput(): never {
  throw new MatchAssessmentInputRejectedError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length > 0 &&
    Array.from(value).length <= maximum &&
    value.trim().length > 0
  );
}

function isUniqueBoundedStrings(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= maximumItems &&
    value.every((item) => isBoundedString(item, maximumLength)) &&
    new Set(value).size === value.length
  );
}

function isBoundedStrings(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= maximumItems &&
    value.every((item) => isBoundedString(item, maximumLength))
  );
}

function isExactChoiceArray<T extends string>(
  value: unknown,
  choices: readonly T[],
  minimumItems: number,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= choices.length &&
    value.every((item) => typeof item === "string" && choices.includes(item as T)) &&
    new Set(value).size === value.length
  );
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_DATE_TIME_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isCatalogRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CATALOG_REVISION_PATTERN.test(value) &&
    BigInt(value) <= CATALOG_REVISION_MAX
  );
}

function assertPreferences(value: unknown): asserts value is MatchPreferenceSnapshot {
  if (!isRecord(value)) rejectInput();

  if (Object.hasOwn(value, "requiresSponsorship")) {
    throw new MatchAssessmentUnavailableError();
  }

  if (
    !hasExactKeys(
      value,
      ["id", "version", "updatedAt", "targetRoles", "locations", "workModes", "employmentTypes"],
      ["salaryMinimum", "salaryCurrency", "requiresSponsorship"],
    ) ||
    typeof value.id !== "string" ||
    !UUID_V7_PATTERN.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    (value.version as number) > PREFERENCE_VERSION_MAX ||
    !isDateTime(value.updatedAt) ||
    !isUniqueBoundedStrings(value.targetRoles, 1, 10, 100) ||
    !isUniqueBoundedStrings(value.locations, 0, 10, 120) ||
    !isExactChoiceArray(value.workModes, WORK_MODES, 1) ||
    !isExactChoiceArray(value.employmentTypes, EMPLOYMENT_TYPES, 1)
  ) {
    rejectInput();
  }

  const hasSalaryMinimum = Object.hasOwn(value, "salaryMinimum");
  const hasSalaryCurrency = Object.hasOwn(value, "salaryCurrency");
  if (hasSalaryMinimum !== hasSalaryCurrency) rejectInput();
  if (
    hasSalaryMinimum &&
    (!Number.isSafeInteger(value.salaryMinimum) ||
      (value.salaryMinimum as number) < 0 ||
      typeof value.salaryCurrency !== "string" ||
      !CURRENCY_PATTERN.test(value.salaryCurrency))
  ) {
    rejectInput();
  }
}

function assertJob(value: unknown): asserts value is MatchableJobSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["id", "catalogRevision", "eligibleThrough", "title", "locations"],
      ["workMode", "employmentType"],
    ) ||
    typeof value.id !== "string" ||
    !UUID_V7_PATTERN.test(value.id) ||
    !isCatalogRevision(value.catalogRevision) ||
    !isDateTime(value.eligibleThrough) ||
    !isBoundedString(value.title, 240) ||
    !isBoundedStrings(value.locations, 0, 20, 240) ||
    (Object.hasOwn(value, "workMode") && value.workMode === undefined) ||
    (Object.hasOwn(value, "employmentType") && value.employmentType === undefined) ||
    (value.workMode !== undefined &&
      value.workMode !== "unknown" &&
      !WORK_MODES.includes(value.workMode as MatchWorkMode)) ||
    (value.employmentType !== undefined &&
      value.employmentType !== "unknown" &&
      !EMPLOYMENT_TYPES.includes(value.employmentType as MatchEmploymentType))
  ) {
    rejectInput();
  }
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function exactOverlap(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = new Set(left.map(normalized));
  return right.some((value) => normalizedLeft.has(normalized(value)));
}

function evidence(
  constraint: MatchConstraint,
  state: MatchEvidenceState,
  reasonCode: MatchEvidenceReasonCode,
): MatchConstraintEvidence {
  return Object.freeze({ constraint, state, reasonCode });
}

function workModeEvidence(
  preferences: MatchPreferenceSnapshot,
  job: MatchableJobSnapshot,
): MatchConstraintEvidence {
  if (job.workMode === undefined || job.workMode === "unknown") {
    return evidence("work_mode", "unknown", "work_mode_unavailable");
  }
  if (preferences.workModes.includes(job.workMode)) {
    return evidence("work_mode", "satisfied", "work_mode_selected");
  }
  return evidence("work_mode", "conflict", "work_mode_conflict");
}

function employmentTypeEvidence(
  preferences: MatchPreferenceSnapshot,
  job: MatchableJobSnapshot,
): MatchConstraintEvidence {
  if (job.employmentType === undefined || job.employmentType === "unknown") {
    return evidence("employment_type", "unknown", "employment_type_unavailable");
  }
  if (preferences.employmentTypes.includes(job.employmentType)) {
    return evidence("employment_type", "satisfied", "employment_type_selected");
  }
  return evidence("employment_type", "conflict", "employment_type_conflict");
}

export function assessMatch(input: MatchAssessmentInput): MatchAssessment {
  if (!isRecord(input) || !hasExactKeys(input, ["preferences", "job"], [])) rejectInput();
  assertPreferences(input.preferences);
  assertJob(input.job);

  const resultEvidence = [
    workModeEvidence(input.preferences, input.job),
    employmentTypeEvidence(input.preferences, input.job),
    exactOverlap(input.preferences.targetRoles, [input.job.title])
      ? evidence("target_role", "satisfied", "target_role_exact_overlap")
      : evidence("target_role", "unknown", "target_role_not_established"),
    exactOverlap(input.preferences.locations, input.job.locations)
      ? evidence("location", "satisfied", "location_exact_overlap")
      : evidence("location", "unknown", "location_not_established"),
    evidence("compensation", "unknown", "compensation_semantics_unavailable"),
    evidence("authorization_sponsorship", "unknown", "authorization_sponsorship_unavailable"),
    evidence("seniority", "unknown", "seniority_semantics_unavailable"),
    evidence("blocked_company", "unknown", "blocked_company_preferences_unavailable"),
    evidence("qualifications", "unknown", "qualification_evidence_unavailable"),
  ] as const;

  return Object.freeze({
    schemaVersion: 1,
    preferenceSetId: input.preferences.id,
    preferenceVersion: input.preferences.version,
    preferenceUpdatedAt: input.preferences.updatedAt,
    jobId: input.job.id,
    catalogRevision: input.job.catalogRevision,
    gate: resultEvidence.some((entry) => entry.state === "conflict")
      ? "excluded"
      : "review_required",
    evidence: Object.freeze([...resultEvidence]),
  });
}
