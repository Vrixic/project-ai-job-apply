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
  const [application] = await query<
    Array<{ status: string }>
  >`SELECT status FROM applications.applications
    WHERE owner_user_id = ${ownerUserId} AND id = ${applicationId} FOR UPDATE`;
  if (!application || !["preparing", "review_required"].includes(application.status))
    throw Error("NativeApplicationAdmissionUnavailable");
}
