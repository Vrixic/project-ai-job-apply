import { createHash } from "node:crypto";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

const owners = [
  "identity",
  "profile",
  "documents",
  "jobs",
  "matching",
  "billing",
  "trust",
] as const;

/** Historical marker provenance, not an activation policy or a new authorization window. */
export const ACCEPTED_CANDIDATE_DELETION_POLICIES = Object.freeze([
  Object.freeze({
    version: "d1-development-synthetic-v1",
    sha256: "d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff",
    backupRetentionDays: 35,
    ownerInventory: Object.freeze(owners.slice(0, 6)),
    subprocessorInventory: Object.freeze([] as string[]),
  }),
  Object.freeze({
    version: "d2-development-synthetic-v1",
    // Exact original aca0762 policy bytes. af95bd4 reformatted arrays without changing
    // meaning; its different file hash must not replace the retained marker identity.
    sha256: "7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf",
    backupRetentionDays: 35,
    ownerInventory: Object.freeze([...owners]),
    subprocessorInventory: Object.freeze([] as string[]),
  }),
]);

export const ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256 = createHash("sha256")
  .update("candidate-deletion-restore-policy-catalog-v1\n")
  .update(JSON.stringify(ACCEPTED_CANDIDATE_DELETION_POLICIES))
  .update("\n")
  .digest("hex");

export const RESTORED_CANDIDATE_RIGHTS_OWNERS = Object.freeze([...owners]);
export const CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION = "d2-development-synthetic-v1";
export const MAX_RESTORED_DELETION_MARKERS = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const entryKeys = [
  "requestId",
  "operationId",
  "userId",
  "policyVersion",
  "policySha256",
  "subjectDigest",
  "confirmedAt",
  "backupExpiresAt",
  "completedAt",
].sort();

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(Date.prototype.getTime.call(value));
}

/** Validate the entire immutable marker set before callers may inspect or mutate a restore. */
export function validateHistoricalRecoveryEntries(
  entries: readonly CandidateDeletionRecoveryEntry[],
  now: Date,
): readonly CandidateDeletionRecoveryEntry[] {
  if (
    !validDate(now) ||
    !Array.isArray(entries) ||
    entries.length > MAX_RESTORED_DELETION_MARKERS
  ) {
    throw new Error("CandidateDeletionRestoreMarkerSetRejected");
  }
  const requests = new Set<string>();
  const operations = new Set<string>();
  const users = new Set<string>();
  const subjects = new Set<string>();
  const result = entries.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== entryKeys.join(",") ||
      typeof entry.requestId !== "string" ||
      typeof entry.operationId !== "string" ||
      typeof entry.userId !== "string" ||
      typeof entry.subjectDigest !== "string" ||
      !UUID.test(entry.requestId) ||
      !UUID.test(entry.operationId) ||
      !UUID.test(entry.userId) ||
      !SHA256.test(entry.subjectDigest) ||
      !validDate(entry.confirmedAt) ||
      !validDate(entry.backupExpiresAt) ||
      !validDate(entry.completedAt) ||
      Date.prototype.getTime.call(entry.completedAt) <
        Date.prototype.getTime.call(entry.confirmedAt) ||
      Date.prototype.getTime.call(entry.completedAt) > Date.prototype.getTime.call(now)
    ) {
      throw new Error("CandidateDeletionRestoreMarkerRejected");
    }
    const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES.find(
      (candidate) =>
        candidate.version === entry.policyVersion && candidate.sha256 === entry.policySha256,
    );
    if (!policy) throw new Error("CandidateDeletionRestoreHistoricalPolicyRejected");
    if (
      Date.prototype.getTime.call(entry.backupExpiresAt) -
        Date.prototype.getTime.call(entry.confirmedAt) !==
      policy.backupRetentionDays * 86_400_000
    ) {
      throw new Error("CandidateDeletionRestoreRetentionRejected");
    }
    // Confirmed deletion is irreversible: two distinct deletion authorities for the
    // same restored user/subject are ambiguous, not independent replay instructions.
    if (
      requests.has(entry.requestId) ||
      operations.has(entry.operationId) ||
      users.has(entry.userId) ||
      subjects.has(entry.subjectDigest)
    ) {
      throw new Error("CandidateDeletionRestoreMarkerCollision");
    }
    requests.add(entry.requestId);
    operations.add(entry.operationId);
    users.add(entry.userId);
    subjects.add(entry.subjectDigest);
    return Object.freeze({
      ...entry,
      confirmedAt: Object.freeze(new Date(Date.prototype.getTime.call(entry.confirmedAt))),
      backupExpiresAt: Object.freeze(new Date(Date.prototype.getTime.call(entry.backupExpiresAt))),
      completedAt: Object.freeze(new Date(Date.prototype.getTime.call(entry.completedAt))),
    });
  });
  return Object.freeze(result.sort((left, right) => left.requestId.localeCompare(right.requestId)));
}
