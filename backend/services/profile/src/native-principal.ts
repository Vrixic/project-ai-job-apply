import type postgres from "postgres";

/** Private owning identity projection: no upsert, email, profile content, session or token.
 * Ambiguous issuer bindings refuse rather than inventing or choosing a principal. */
export async function readNativePrincipal(
  client: postgres.Sql,
  ownerUserId: string,
  issuer: string,
  enabled: () => boolean,
): Promise<{ issuer: string; subject: string }> {
  const unavailable = () => Error("NativePrincipalUnavailable");
  try {
    const url = new URL(issuer);
    if (
      !enabled() ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(ownerUserId) ||
      issuer.length > 512 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== issuer
    )
      throw unavailable();
    const result = await client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
      if (!enabled()) throw unavailable();
      const rows = await tx<Array<{ issuer: string; subject: string }>>`SELECT issuer, subject
        FROM identity.external_identities WHERE user_id=${ownerUserId}::uuid AND issuer=${issuer}
        LIMIT 2 FOR SHARE`;
      const principal = rows[0];
      if (
        !enabled() ||
        rows.length !== 1 ||
        !principal ||
        principal.issuer !== issuer ||
        typeof principal.subject !== "string" ||
        !/^[\x21-\x7e]{1,512}$/u.test(principal.subject)
      )
        throw unavailable();
      return { issuer: principal.issuer, subject: principal.subject };
    });
    if (!enabled()) throw unavailable();
    return result as { issuer: string; subject: string };
  } catch {
    throw unavailable();
  }
}
