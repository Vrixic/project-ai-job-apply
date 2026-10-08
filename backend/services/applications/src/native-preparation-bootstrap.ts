import type postgres from "postgres";

/** Private scalar projection of the immutable, already claimed preparation. No candidate
 * content, packet, approval creation, generation claim, or consent renewal capability. */
export interface NativePreparationBootstrap {
  id: string;
  ownerUserId: string;
  applicationId: string;
  jobContextHash: string;
  confirmedFactsHash: string;
  noticeVersion: "openai-cover-letter.v1";
  approvedAt: string;
  expiresAt: string;
}

export async function readNativePreparationBootstrap(
  sql: postgres.Sql,
  scope: { ownerUserId: string; applicationId: string; generationId: string },
  enabled: () => boolean,
): Promise<NativePreparationBootstrap> {
  const unavailable = () => Error("NativePreparationBootstrapUnavailable");
  const fixed = { ...scope };
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  try {
    if (!enabled() || !Object.values(fixed).every((id) => uuid.test(id))) throw unavailable();
    const result = await sql.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${fixed.ownerUserId}::uuid)`;
      if (!enabled()) throw unavailable();
      const [row] = await tx<
        Array<{
          id: string;
          owner_user_id: string;
          application_id: string;
          job_context_hash: string;
          confirmed_facts_hash: string;
          notice_version: "openai-cover-letter.v1";
          approved_at: Date;
          expires_at: Date;
        }>
      >`SELECT p.id, p.owner_user_id, p.application_id, p.job_context_hash,
          p.confirmed_facts_hash, p.notice_version, p.approved_at, p.expires_at
        FROM applications.packet_preparations p
        JOIN applications.applications a ON a.id=p.application_id AND a.owner_user_id=p.owner_user_id
        WHERE p.id=${fixed.generationId} AND p.owner_user_id=${fixed.ownerUserId}
          AND p.application_id=${fixed.applicationId} AND p.state='running'
          AND p.generation_claimed_at IS NOT NULL AND p.result_packet_id IS NULL AND p.error_code IS NULL
          AND a.status='review_required' AND a.current_packet_id=p.base_packet_id
          AND a.revision=p.expected_revision
          AND p.notice_version='openai-cover-letter.v1' AND p.provider='openai'
          AND p.model='gpt-6-luna' AND p.purpose='cover_letter'
          AND p.categories='["profile_facts","job_posting"]'::jsonb
      AND NOT EXISTS (SELECT 1 FROM applications.native_material_withdrawals w
        WHERE w.owner_user_id=${fixed.ownerUserId} AND w.requested_at >= p.approved_at)
          AND p.approved_at <= clock_timestamp() AND p.expires_at > clock_timestamp()
          AND p.expires_at=p.approved_at + interval '15 minutes'
        FOR SHARE OF p,a`;
      if (!enabled() || !row) throw unavailable();
      return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        applicationId: row.application_id,
        jobContextHash: row.job_context_hash,
        confirmedFactsHash: row.confirmed_facts_hash,
        noticeVersion: row.notice_version,
        approvedAt: row.approved_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      };
    });
    if (!enabled()) throw unavailable();
    return result as NativePreparationBootstrap;
  } catch {
    throw unavailable();
  }
}
