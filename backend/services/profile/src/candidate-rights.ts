import type { AuthPrincipal } from "@ai-job-apply/auth";

export const candidateRightsOwnerInventory = [
  "identity",
  "profile",
  "documents",
  "jobs",
  "matching",
  "billing",
] as const;

export type CandidateRightsOwner = (typeof candidateRightsOwnerInventory)[number];
export type CandidateDataExportState = "queued" | "building" | "ready" | "expired" | "failed";
export type CandidateDataExportFailureCode =
  | "owner_unavailable"
  | "inventory_incomplete"
  | "artifact_write_failed";
export type AccountDeletionState =
  | "requested"
  | "quarantined"
  | "active_systems_deleted"
  | "subprocessors_pending"
  | "completed"
  | "backup_expired";

export interface CandidateRightsPolicy {
  version: string;
  accountablePolicySha256: string;
  exportArtifactLifetimeSeconds: number;
  downloadGrantLifetimeSeconds: number;
  backupRetentionDays: number;
  recentAuthenticationMaxAgeSeconds: number;
  ownerInventory: readonly CandidateRightsOwner[];
  subprocessorInventory: readonly string[];
}

export interface CandidateDataExportRecord {
  id: string;
  userId: string;
  operationId: string;
  policyVersion: string;
  state: CandidateDataExportState;
  requestedAt: Date;
  updatedAt: Date;
  artifact?: {
    objectKey: string;
    objectVersion: string;
    sha256: string;
    expiresAt: Date;
  };
  failureCode?: CandidateDataExportFailureCode;
}

export interface AccountDeletionRecord {
  id: string;
  userId: string;
  operationId?: string;
  policyVersion: string;
  state: AccountDeletionState;
  version: number;
  requestedAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  completedAt?: Date;
  backupExpiresAt?: Date;
  backupExpiredAt?: Date;
}

const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROCESSOR_ID = /^[a-z][a-z0-9-]{1,62}$/;
const SECONDS_PER_DAY = 86_400;

export class CandidateRightsPolicyError extends Error {
  readonly code = "CANDIDATE_RIGHTS_POLICY_INVALID";

  constructor() {
    super("Candidate rights policy is unavailable");
    this.name = "CandidateRightsPolicyError";
  }
}

export class CandidateRightsAuthenticationError extends Error {
  readonly code = "RECENT_AUTHENTICATION_REQUIRED";

  constructor() {
    super("Recent authentication is required");
    this.name = "CandidateRightsAuthenticationError";
  }
}

export class CandidateRightsMfaError extends Error {
  readonly code = "MFA_AUTHENTICATION_REQUIRED";

  constructor() {
    super("MFA authentication is required");
    this.name = "CandidateRightsMfaError";
  }
}

export class CandidateRightsTransitionError extends Error {
  readonly code = "CANDIDATE_RIGHTS_STATE_CONFLICT";

  constructor() {
    super("Candidate rights state conflicts with the requested transition");
    this.name = "CandidateRightsTransitionError";
  }
}

function exactPositiveInteger(value: string | undefined, minimum: number, maximum: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new CandidateRightsPolicyError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CandidateRightsPolicyError();
  }
  return parsed;
}

function exactCsv(value: string | undefined): string[] {
  if (!value) throw new CandidateRightsPolicyError();
  const values = value.split(",");
  if (
    values.length === 0 ||
    values.length > 32 ||
    values.some((item) => !PROCESSOR_ID.test(item)) ||
    new Set(values).size !== values.length
  ) {
    throw new CandidateRightsPolicyError();
  }
  return values;
}

function exactSubprocessorInventory(value: string | undefined): string[] {
  if (value === "none") return [];
  const inventory = exactCsv(value);
  if (inventory.includes("none")) throw new CandidateRightsPolicyError();
  return inventory;
}

/**
 * Loads an activation policy with no defaults. Synthetic tests must provide the same complete
 * boundary as a deployment; absence or ambiguity always disables the capability.
 */
export function loadCandidateRightsPolicy(environment: NodeJS.ProcessEnv): CandidateRightsPolicy {
  const version = environment.CANDIDATE_RIGHTS_POLICY_VERSION;
  const accountablePolicySha256 = environment.CANDIDATE_RIGHTS_POLICY_SHA256;
  if (!version || !POLICY_VERSION.test(version) || !accountablePolicySha256) {
    throw new CandidateRightsPolicyError();
  }
  if (!SHA256.test(accountablePolicySha256)) throw new CandidateRightsPolicyError();

  const owners = exactCsv(environment.CANDIDATE_RIGHTS_OWNER_INVENTORY);
  if (owners.join(",") !== candidateRightsOwnerInventory.join(",")) {
    throw new CandidateRightsPolicyError();
  }
  const subprocessors = exactSubprocessorInventory(
    environment.CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY,
  );

  return Object.freeze({
    version,
    accountablePolicySha256,
    exportArtifactLifetimeSeconds: exactPositiveInteger(
      environment.CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS,
      300,
      604_800,
    ),
    downloadGrantLifetimeSeconds: exactPositiveInteger(
      environment.CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS,
      60,
      900,
    ),
    backupRetentionDays: exactPositiveInteger(
      environment.CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS,
      1,
      35,
    ),
    recentAuthenticationMaxAgeSeconds: exactPositiveInteger(
      environment.CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS,
      60,
      900,
    ),
    ownerInventory: candidateRightsOwnerInventory,
    subprocessorInventory: Object.freeze(subprocessors),
  });
}

export function loadCandidateRightsPolicyIfConfigured(
  environment: NodeJS.ProcessEnv,
): CandidateRightsPolicy | undefined {
  const keys = [
    "CANDIDATE_RIGHTS_POLICY_VERSION",
    "CANDIDATE_RIGHTS_POLICY_SHA256",
    "CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS",
    "CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS",
    "CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS",
    "CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS",
    "CANDIDATE_RIGHTS_OWNER_INVENTORY",
    "CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY",
  ] as const;
  if (keys.every((key) => environment[key] === undefined)) return undefined;
  return loadCandidateRightsPolicy(environment);
}

export function assertCandidateRightsAuthentication(
  principal: AuthPrincipal,
  now: Date,
  policy: CandidateRightsPolicy,
  requireMfa: boolean,
): void {
  const authenticatedAt = principal.authenticatedAt;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(authenticatedAt) ||
    !authenticatedAt ||
    authenticatedAt > nowSeconds + 30 ||
    nowSeconds - authenticatedAt > policy.recentAuthenticationMaxAgeSeconds
  ) {
    throw new CandidateRightsAuthenticationError();
  }
  if (requireMfa && !principal.authenticationMethods?.includes("mfa")) {
    throw new CandidateRightsMfaError();
  }
}

export function beginCandidateDataExport(
  record: CandidateDataExportRecord,
  now: Date,
): CandidateDataExportRecord {
  if (record.state === "building") return record;
  if (record.state !== "queued") throw new CandidateRightsTransitionError();
  return { ...record, state: "building", updatedAt: now };
}

export function completeCandidateDataExport(
  record: CandidateDataExportRecord,
  artifact: CandidateDataExportRecord["artifact"],
  now: Date,
): CandidateDataExportRecord {
  if (
    record.state !== "building" ||
    !artifact ||
    !SHA256.test(artifact.sha256) ||
    artifact.objectKey.length === 0 ||
    artifact.objectVersion.length === 0 ||
    artifact.expiresAt.getTime() <= now.getTime()
  ) {
    throw new CandidateRightsTransitionError();
  }
  const { failureCode: _failureCode, ...withoutFailure } = record;
  return { ...withoutFailure, state: "ready", artifact, updatedAt: now };
}

export function failCandidateDataExport(
  record: CandidateDataExportRecord,
  failureCode: CandidateDataExportFailureCode,
  now: Date,
): CandidateDataExportRecord {
  if (record.state !== "queued" && record.state !== "building") {
    throw new CandidateRightsTransitionError();
  }
  const { artifact: _artifact, ...withoutArtifact } = record;
  return { ...withoutArtifact, state: "failed", failureCode, updatedAt: now };
}

export function expireCandidateDataExport(
  record: CandidateDataExportRecord,
  now: Date,
  exactObjectAbsent: boolean,
): CandidateDataExportRecord {
  if (
    record.state !== "ready" ||
    !record.artifact ||
    now.getTime() < record.artifact.expiresAt.getTime() ||
    !exactObjectAbsent
  ) {
    throw new CandidateRightsTransitionError();
  }
  const { artifact: _artifact, ...withoutArtifact } = record;
  return { ...withoutArtifact, state: "expired", updatedAt: now };
}

export function confirmAccountDeletion(
  record: AccountDeletionRecord,
  expectedVersion: number,
  operationId: string,
  now: Date,
  policy: CandidateRightsPolicy,
): AccountDeletionRecord {
  if (
    record.state !== "requested" ||
    record.version !== expectedVersion ||
    record.operationId !== undefined ||
    operationId.length === 0
  ) {
    throw new CandidateRightsTransitionError();
  }
  return {
    ...record,
    operationId,
    state: "quarantined",
    version: record.version + 1,
    confirmedAt: now,
    updatedAt: now,
    backupExpiresAt: new Date(now.getTime() + policy.backupRetentionDays * SECONDS_PER_DAY * 1_000),
  };
}

export function cancelAccountDeletion(
  record: AccountDeletionRecord,
  expectedVersion: number,
): void {
  if (record.state !== "requested" || record.version !== expectedVersion) {
    throw new CandidateRightsTransitionError();
  }
}

export function advanceAccountDeletion(
  record: AccountDeletionRecord,
  nextState: Exclude<AccountDeletionState, "requested" | "quarantined" | "backup_expired">,
  now: Date,
): AccountDeletionRecord {
  const allowed: Partial<Record<AccountDeletionState, AccountDeletionState>> = {
    quarantined: "active_systems_deleted",
    active_systems_deleted: "subprocessors_pending",
    subprocessors_pending: "completed",
  };
  if (allowed[record.state] !== nextState) throw new CandidateRightsTransitionError();
  return {
    ...record,
    state: nextState,
    version: record.version + 1,
    updatedAt: now,
    ...(nextState === "completed" ? { completedAt: now } : {}),
  };
}

export function markAccountDeletionBackupExpired(
  record: AccountDeletionRecord,
  now: Date,
  backupInventoryEmpty: boolean,
): AccountDeletionRecord {
  if (
    record.state !== "completed" ||
    !record.backupExpiresAt ||
    now.getTime() < record.backupExpiresAt.getTime() ||
    !backupInventoryEmpty
  ) {
    throw new CandidateRightsTransitionError();
  }
  return {
    ...record,
    state: "backup_expired",
    version: record.version + 1,
    updatedAt: now,
    backupExpiredAt: now,
  };
}
