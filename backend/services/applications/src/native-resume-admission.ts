import type { NativeMaterialAdmissionQuery } from "./native-material-admission.js";

/** Scalar original intent only. No packet values, provider consent or generation authority. */
export interface NativeResumePreparationScope {
  ownerUserId: string;
  applicationId: string;
  canonicalJobId: string;
  expectedRevision: number;
  packetId: string;
  packetHash: string;
  jobRevision: string;
}
const keys = [
  "ownerUserId",
  "applicationId",
  "canonicalJobId",
  "expectedRevision",
  "packetId",
  "packetHash",
  "jobRevision",
] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const unavailable = () => Error("NativeResumeAdmissionUnavailable");

/** Execute on Documents' SAME reservation/completion transaction. Locks remain with its caller.
 * Current canonical job/source proof and original task/generation binding are separate owners. */
export async function lockNativeResumePreparationAdmission(
  input: NativeResumePreparationScope,
  query: NativeMaterialAdmissionQuery,
  enabled: () => boolean = () => false,
): Promise<void> {
  try {
    if (
      !enabled() ||
      !input ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== keys.length
    )
      throw unavailable();
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d?.enumerable || !("value" in d)) throw unavailable();
    }
    const fixed = Object.freeze({ ...input });
    if (
      ![fixed.ownerUserId, fixed.applicationId, fixed.canonicalJobId, fixed.packetId].every(
        (value) => typeof value === "string" && uuid.test(value),
      ) ||
      !Number.isSafeInteger(fixed.expectedRevision) ||
      fixed.expectedRevision < 1 ||
      ![fixed.packetHash, fixed.jobRevision].every(
        (value) => typeof value === "string" && hash.test(value),
      )
    )
      throw unavailable();
    await query`SELECT identity.require_active_candidate(${fixed.ownerUserId}::uuid)`;
    if (!enabled()) throw unavailable();
    const [row] = await query<Array<{ admitted: number }>>`
      SELECT 1 AS admitted FROM applications.applications a
      JOIN applications.packets p ON p.id=a.current_packet_id
        AND p.application_id=a.id AND p.owner_user_id=a.owner_user_id
      WHERE a.id=${fixed.applicationId} AND a.owner_user_id=${fixed.ownerUserId}
        AND a.canonical_job_id=${fixed.canonicalJobId} AND a.revision=${fixed.expectedRevision}
        AND a.status='review_required' AND p.id=${fixed.packetId}
      AND NOT EXISTS (SELECT 1 FROM applications.native_material_withdrawals w
        WHERE w.owner_user_id=${fixed.ownerUserId} AND w.requested_at >= p.created_at)
        AND p.packet_hash=${fixed.packetHash} AND p.job_revision=${fixed.jobRevision}
      FOR UPDATE OF a FOR SHARE OF p`;
    if (!enabled() || row?.admitted !== 1) throw unavailable();
  } catch {
    throw unavailable();
  }
}
