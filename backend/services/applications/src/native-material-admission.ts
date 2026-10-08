export type NativeMaterialAdmissionQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;

/** Applications-owned fixed metadata SQL, executed on the caller's SAME transaction. Never
 * admit against an independently released lock or a point-in-time network response. */
export async function lockNativeMaterialApplicationAdmission(
  ownerUserId: string,
  applicationId: string,
  query: NativeMaterialAdmissionQuery,
): Promise<void> {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if (!uuid.test(ownerUserId) || !uuid.test(applicationId))
    throw Error("NativeApplicationAdmissionUnavailable");
  await query`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`native-material-withdrawal:${ownerUserId}`},0))`;
  const [application] = await query<
    Array<{ status: string }>
  >`SELECT status FROM applications.applications
    WHERE owner_user_id = ${ownerUserId} AND id = ${applicationId} FOR UPDATE`;
  if (!application || !["preparing", "review_required"].includes(application.status))
    throw Error("NativeApplicationAdmissionUnavailable");
}

/** Launch-only proof of the original claimed preparation. Run on the allocation transaction;
 * recovery of an already-recorded launch must not use this authority to launch again. */
export async function lockNativePreparationLaunchAdmission(
  ownerUserId: string,
  applicationId: string,
  generationId: string,
  query: NativeMaterialAdmissionQuery,
): Promise<void> {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if (![ownerUserId, applicationId, generationId].every((value) => uuid.test(value)))
    throw Error("NativePreparationLaunchUnavailable");
  await query`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`native-material-withdrawal:${ownerUserId}`},0))`;
  const [row] = await query<Array<{ admitted: number }>>`
    SELECT 1 AS admitted FROM applications.applications a
    JOIN applications.packet_preparations p ON p.application_id=a.id AND p.owner_user_id=a.owner_user_id
    WHERE a.owner_user_id=${ownerUserId} AND a.id=${applicationId} AND p.id=${generationId}
      AND a.status='review_required' AND a.current_packet_id=p.base_packet_id
      AND a.revision=p.expected_revision AND p.state='running'
      AND p.generation_claimed_at IS NOT NULL AND p.result_packet_id IS NULL AND p.error_code IS NULL
      AND NOT EXISTS (SELECT 1 FROM applications.native_material_withdrawals w
        WHERE w.owner_user_id=${ownerUserId} AND w.requested_at >= p.approved_at)
      AND p.approved_at <= clock_timestamp() AND p.expires_at > clock_timestamp()
    FOR UPDATE OF a FOR SHARE OF p`;
  if (row?.admitted !== 1) throw Error("NativePreparationLaunchUnavailable");
}
