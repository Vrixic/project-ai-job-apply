/** Identity-owned point-in-time admission for isolated read-only restore diagnostics.
 * This grants no write lease, candidate action or primary-promotion authority. */
export async function verifyRestoreCandidateOwners(
  transaction: { unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> },
  owners: readonly string[],
): Promise<void> {
  const refused = () => Error("RestoreCandidateAdmissionUnavailable");
  try {
    if (
      owners.length < 1 ||
      owners.length > 7 ||
      new Set(owners).size !== owners.length ||
      owners.some(
        (owner) =>
          typeof owner !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(owner),
      )
    )
      throw refused();
    const rows = await transaction.unsafe<{
      count: string;
    }>(`SELECT count(*)::text AS count FROM identity.users
      WHERE id IN (${owners.map((owner) => `'${owner}'::uuid`).join(",")}) AND account_state='active' AND quarantined_at IS NULL`);
    if (rows.length !== 1 || rows[0]?.count !== String(owners.length)) throw refused();
  } catch {
    throw refused();
  }
}
