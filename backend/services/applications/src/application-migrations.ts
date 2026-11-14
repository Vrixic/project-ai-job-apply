import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const migrationVersions = [
  "0001_applications_foundation",
  "0002_candidate_rights",
  "0003_manual_submission",
  "0004_packet_preparation",
  "0005_preparation_dispatch",
  "0006_vault_approval_binding",
  "0007_document_field_hashes",
  "0008_temporary_material_bindings",
  "0009_restricted_packet_values",
  "0010_native_resume_requests",
  "0011_native_resume_execution_receipts",
  "0012_native_resume_execution_observation",
  "0013_native_material_withdrawals",
  "0014_native_material_cleanup_queue",
  "0015_legacy_receipt_archive",
  "0016_cover_letter_bedrock_notice",
] as const;
export async function loadApplicationMigrations() {
  return Promise.all(
    migrationVersions.map(async (version) => {
      const migrationPath = fileURLToPath(
        new URL(
          `${import.meta.url.endsWith(".ts") ? "../" : "../../"}migrations/${version}.sql`,
          import.meta.url,
        ),
      );
      const sql = (await readFile(migrationPath, "utf8")).replaceAll("\r\n", "\n");
      return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}
