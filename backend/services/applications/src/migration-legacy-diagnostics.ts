import type postgres from "postgres";

const legacyFailure = "restricted packet migration requires an explicit legacy evidence transition";
const countKeys = [
  "appliedMigrationCount",
  "restrictedMigrationRecorded",
  "packetCount",
  "packetsWithRestrictedValues",
  "packetsWithProtectedMarkers",
  "packetsWithInvalidContainers",
  "createPacketReceipts",
  "queuePreparationReceipts",
  "packetsWithApprovals",
  "ambiguousAttempts",
] as const;

export function isRestrictedPacketLegacyMigrationFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "55000" &&
    "message" in error &&
    error.message === legacyFailure
  );
}

// Diagnostics only: zero counts do not establish migration compatibility or authorize a retry.
// The complete immutable SQL guard remains the authority, including field-shape validation.
export async function readRestrictedPacketLegacyDiagnostics(client: postgres.Sql) {
  return client.begin("isolation level repeatable read read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '10s'`;
    await tx`SET LOCAL lock_timeout = '2s'`;
    const [row] = await tx<Record<(typeof countKeys)[number], string>[]>`
      WITH packet_traits AS MATERIALIZED (
        SELECT packet.id,
          jsonb_typeof(packet.fields) IS DISTINCT FROM 'array'
            OR CASE WHEN jsonb_typeof(packet.fields) = 'array'
              THEN jsonb_array_length(packet.fields) > 200 ELSE false END AS invalid_container,
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(packet.fields) = 'array'
              THEN packet.fields ELSE '[]'::jsonb END) AS field
            WHERE jsonb_typeof(field) = 'object' AND (field->>'fieldKey' IN (
              'authorization.us_authorized', 'authorization.sponsorship_required',
              'authorization.export_control', 'disclosure.non_compete', 'disclosure.conflict_of_interest',
              'demographic.gender', 'demographic.race_ethnicity', 'demographic.veteran',
              'demographic.disability', 'attestation.truthful', 'attestation.terms', 'signature.electronic'
            ) OR field ? 'vaultReference' OR COALESCE(field->'reasons', '[]'::jsonb) ? 'restricted_answer')
              AND field->'value' IS DISTINCT FROM 'null'::jsonb
          ) AS restricted_value,
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(packet.fields) = 'array'
              THEN packet.fields ELSE '[]'::jsonb END) AS field
            WHERE jsonb_typeof(field) = 'object' AND field ? 'protectedValue'
          ) AS protected_marker
        FROM applications.packets AS packet
      )
      SELECT
        (SELECT count(*)::text FROM applications.schema_migrations) AS "appliedMigrationCount",
        (SELECT count(*)::text FROM applications.schema_migrations
          WHERE version = '0009_restricted_packet_values') AS "restrictedMigrationRecorded",
        (SELECT count(*)::text FROM packet_traits) AS "packetCount",
        (SELECT count(*)::text FROM packet_traits WHERE restricted_value) AS "packetsWithRestrictedValues",
        (SELECT count(*)::text FROM packet_traits WHERE protected_marker) AS "packetsWithProtectedMarkers",
        (SELECT count(*)::text FROM packet_traits WHERE invalid_container) AS "packetsWithInvalidContainers",
        (SELECT count(*)::text FROM applications.command_receipts
          WHERE operation = 'create_packet') AS "createPacketReceipts",
        (SELECT count(*)::text FROM applications.command_receipts
          WHERE operation = 'queue_preparation') AS "queuePreparationReceipts",
        (SELECT count(DISTINCT packet_id)::text FROM applications.approvals) AS "packetsWithApprovals",
        (SELECT count(*)::text FROM applications.attempts WHERE status = 'ambiguous') AS "ambiguousAttempts"
    `;
    if (!row) throw new Error("RestrictedPacketLegacyDiagnosticsUnavailable");
    const counts = Object.fromEntries(
      countKeys.map((key) => {
        const value = row[key];
        if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new Error("RestrictedPacketLegacyDiagnosticsUnavailable");
        }
        return [key, Number(value)];
      }),
    );
    return { kind: "applications_restricted_legacy_inventory", schemaVersion: 1, counts };
  });
}

export async function reportRestrictedPacketLegacyFailure(
  error: unknown,
  client: postgres.Sql,
  report: (message: string) => void,
): Promise<void> {
  if (!isRestrictedPacketLegacyMigrationFailure(error)) return;
  let message = "Applications restricted legacy inventory unavailable; migration remains failed.";
  try {
    message = JSON.stringify(await readRestrictedPacketLegacyDiagnostics(client));
  } catch {
    // Preserve the original migration failure; never serialize a diagnostic query/connection error.
  }
  try {
    report(message);
  } catch {
    // An unavailable log sink must not replace the original migration failure either.
  }
}
