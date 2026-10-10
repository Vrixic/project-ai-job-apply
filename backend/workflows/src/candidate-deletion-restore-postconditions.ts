import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
  validateHistoricalRecoveryEntries,
} from "./candidate-deletion-restore-policy.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

type Sql = Pick<DatabaseHandle["client"], "unsafe">;

// Count the current authoritative deletion ports' owned roots and independent children.
// FK-owned descendants are removed by those ports/cascades; tombstones and deletion audit
// records deliberately remain. Counts expose no candidate payload or raw identity.
export const restoredOwnerCountsQuery = `SELECT jsonb_build_object(
  'identity', (SELECT count(*) FROM identity.external_identities WHERE user_id = $1::uuid),
  'profile', (SELECT count(*) FROM profile.job_preferences WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM profile.restricted_answers WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM profile.profile_facts WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM profile.resume_fact_imports WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM profile.ugc_contribution_consents WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM platform.audit_events WHERE user_id = $1::uuid AND action NOT LIKE 'profile.account-deletion.%') +
    (SELECT count(*) FROM platform.idempotency_keys WHERE user_id = $1::uuid AND scope IN ('ugc_contribution_consent.grant', 'ugc_contribution_consent.revoked', 'ugc_contribution_consent.superseded')),
  'documents', (SELECT count(*) FROM documents.resume_documents WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.cover_letters WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.cover_letter_work_authorizations WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.cover_letter_provider_responses WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.native_material_admission WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.native_material_allocations WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.native_resume_generations WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.audit_events WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM documents.idempotency_keys WHERE user_id = $1::uuid),
  'jobs', (SELECT count(*) FROM jobs.job_contributions WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM jobs.job_reports WHERE reporter_user_id = $1::uuid),
  'matching', (SELECT count(*) FROM matching.saved_jobs WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.audit_events WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.idempotency_keys WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.saved_job_list_state WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.private_saved_page_captures WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.private_saved_page_capture_commands WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM matching.private_saved_page_capture_audit_events WHERE owner_user_id = $1::uuid),
  'billing', (SELECT count(*) FROM billing.entitlement_accounts WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM billing.entitlement_changes WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM billing.entitlement_command_receipts WHERE user_id = $1::uuid) +
    (SELECT count(*) FROM billing.entitlement_outbox WHERE user_id = $1::uuid),
  'trust', (SELECT count(*) FROM trust.contribution_cases WHERE contributor_user_id = $1::uuid),
  'applications', (SELECT count(*) FROM applications.applications WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.packets WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.approvals WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.attempts WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.history WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.command_receipts WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.outbox WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.packet_preparations WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.preparation_outbox WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.preparation_audit WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.native_material_withdrawals WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications.native_material_cleanup_queue WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications_restricted.legacy_receipts WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications_restricted.packet_values WHERE owner_user_id = $1::uuid) +
    (SELECT count(*) FROM applications_restricted.packet_read_audit WHERE owner_user_id = $1::uuid)
) AS "ownerCounts"`;

function rejected(): never {
  throw new Error("CandidateDeletionRestorePostconditionsRejected");
}

/** Strict terminal conditions, never the replay store's active/partial-state preflight. */
export async function inspectReconciledCandidateDeletionRows(
  sql: Sql,
  entries: readonly CandidateDeletionRecoveryEntry[],
  deadline: number,
  signal: AbortSignal,
): Promise<{ restoredSubjectsPresent: number; restoredSubjectsAbsent: number }> {
  const validated = validateHistoricalRecoveryEntries(entries, new Date());
  if (!Number.isFinite(deadline) || deadline > Date.now() + 90_000) rejected();
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) rejected();
  };
  async function query(text: string, values: string[] = []) {
    check();
    const pending = sql.unsafe<Record<string, unknown>[]>(text, values);
    const abort = () => {
      try {
        void Promise.resolve(pending.cancel()).catch(() => undefined);
      } catch {
        /* Refuse regardless of cancellation acknowledgement. */
      }
    };
    let onAbort: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          onAbort = () => {
            abort();
            reject(new Error("CandidateDeletionRestorePostconditionsRejected"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(onAbort, Math.max(1, Math.min(15000, deadline - Date.now())));
          if (signal.aborted) onAbort();
        }),
      ]);
      check();
      return result;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
  await query("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '2s'");
  let restoredSubjectsPresent = 0;
  let restoredSubjectsAbsent = 0;
  const currentInventory = JSON.stringify(
    Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, "completed"])),
  );
  for (const entry of validated) {
    const counts = await query(restoredOwnerCountsQuery, [entry.userId]);
    const ownerCounts = counts[0]?.ownerCounts;
    if (
      counts.length !== 1 ||
      Object.keys(counts[0] ?? {}).join(",") !== "ownerCounts" ||
      !ownerCounts ||
      typeof ownerCounts !== "object" ||
      Array.isArray(ownerCounts) ||
      Object.keys(ownerCounts).sort().join(",") !==
        [...RESTORED_CANDIDATE_RIGHTS_OWNERS].sort().join(",") ||
      Object.values(ownerCounts).some((value) => value !== 0)
    )
      rejected();
    const historicalOwners = ACCEPTED_CANDIDATE_DELETION_POLICIES.find(
      (p) => p.version === entry.policyVersion && p.sha256 === entry.policySha256,
    )?.ownerInventory;
    if (!historicalOwners) rejected();
    // Timestamp comparisons stay inside PostgreSQL; sub-millisecond conflicts cannot be truncated.
    // Only booleans leave SQL. Identifiers and all retained metadata stay in memory.
    const rows = await query(
      `WITH
      u AS (SELECT * FROM identity.users WHERE id=$1::uuid),
      r AS (SELECT * FROM profile.account_deletion_requests WHERE id=$2::uuid OR operation_id=$3::uuid
        OR (user_id=$1::uuid AND state IN ('requested','quarantined','active_systems_deleted','subprocessors_pending'))),
      o AS (SELECT * FROM platform.operations WHERE id=$3::uuid),
      l AS (SELECT * FROM privacy.account_deletion_ledger WHERE request_id=$2::uuid OR subject_digest=$6),
      valid_ledger AS (SELECT * FROM l WHERE request_id=$2::uuid AND subject_digest=$6
        AND policy_version=$4 AND policy_sha256=$5 AND state IN ('completed','backup_expired')
        AND confirmed_at=$7::timestamptz AND backup_expires_at=$8::timestamptz AND completed_at=$9::timestamptz
        AND subprocessor_inventory='{}'::jsonb
        AND (state='completed' AND backup_expired_at IS NULL OR state='backup_expired'
          AND backup_expired_at >= $8::timestamptz AND backup_expired_at <= clock_timestamp()))
      SELECT (SELECT count(*) FROM u)=0 AS absent,
        CASE WHEN (SELECT count(*) FROM u)=0 THEN
          (SELECT count(*) FROM r)=0 AND (SELECT count(*) FROM o)=0
          AND ((SELECT count(*) FROM l)=0 OR (SELECT count(*) FROM l)=1 AND
            EXISTS (SELECT 1 FROM valid_ledger WHERE owner_inventory IN ($10::jsonb,$11::jsonb)))
        ELSE (SELECT count(*) FROM u)=1 AND EXISTS (SELECT 1 FROM u WHERE account_state='quarantined'
          AND created_at <= $7::timestamptz AND quarantined_at <= $9::timestamptz)
          AND (SELECT count(*) FROM r)=1 AND EXISTS (SELECT 1 FROM r WHERE id=$2::uuid
            AND user_id=$1::uuid AND operation_id=$3::uuid AND policy_version=$4
            AND state IN ('completed','backup_expired') AND version > 0 AND requested_at <= $7::timestamptz
            AND confirmed_at=$7::timestamptz AND backup_expires_at=$8::timestamptz AND completed_at=$9::timestamptz
            AND (state='completed' AND backup_expired_at IS NULL OR state='backup_expired'
              AND backup_expired_at >= $8::timestamptz AND backup_expired_at <= clock_timestamp()))
          AND (SELECT count(*) FROM o)=1 AND EXISTS (SELECT 1 FROM o WHERE user_id=$1::uuid
            AND kind='account_deletion' AND state='succeeded' AND error_code IS NULL
            AND result=jsonb_build_object('resourceId',$2::text,'resourceType','account_deletion_request'))
          AND (SELECT count(*) FROM l)=1 AND EXISTS (SELECT 1 FROM valid_ledger
            WHERE owner_inventory IN ($10::jsonb,$11::jsonb) AND state=(SELECT state FROM r)
            AND backup_expired_at IS NOT DISTINCT FROM (SELECT backup_expired_at FROM r))
        END AS valid`,
      [
        entry.userId,
        entry.requestId,
        entry.operationId,
        entry.policyVersion,
        entry.policySha256,
        entry.subjectDigest,
        entry.confirmedAt.toISOString(),
        entry.backupExpiresAt.toISOString(),
        entry.completedAt?.toISOString() ?? rejected(),
        currentInventory,
        JSON.stringify(Object.fromEntries(historicalOwners.map((owner) => [owner, "completed"]))),
      ],
    );
    if (
      rows.length !== 1 ||
      Object.keys(rows[0] ?? {})
        .sort()
        .join(",") !== "absent,valid" ||
      rows[0]?.valid !== true ||
      typeof rows[0]?.absent !== "boolean"
    )
      rejected();
    if (rows[0].absent) restoredSubjectsAbsent++;
    else restoredSubjectsPresent++;
  }
  check();
  return { restoredSubjectsPresent, restoredSubjectsAbsent };
}
