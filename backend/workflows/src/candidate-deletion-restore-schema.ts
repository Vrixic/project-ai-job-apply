import manifest from "@ai-job-apply/database-migrations/restore-manifest.json" with {
  type: "json",
};
import {
  parseRestoreManifest,
  type RestoreSqlClient,
  verifyRestoreDatabase,
} from "@ai-job-apply/database-migrations/restore-verifier";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { CURRENT_PRIMARY_RESTORE_MANIFEST_SHA256 } from "./candidate-deletion-restore-contract.js";

/** Current migrations/catalog only; no whole-row recovery proof or database mutation. */
export async function verifyDeletionRecoverySchema(
  database: DatabaseHandle,
  signal: AbortSignal,
): Promise<void> {
  const active = () => {
    if (signal.aborted) throw new Error("CandidateDeletionRestoreSchemaRejected");
  };
  active();
  const client: RestoreSqlClient = {
    begin: (options, work) =>
      database.client.begin(options, async (sql) =>
        work({
          unsafe: async <T extends Record<string, unknown>>(query: string): Promise<T[]> => {
            active();
            const pending = sql.unsafe(query);
            const cancel = () => {
              pending.cancel();
            };
            signal.addEventListener("abort", cancel, { once: true });
            try {
              if (signal.aborted) {
                cancel();
                active();
              }
              const rows = await pending;
              active();
              // The owning profile client applies postgres.camel; the migration
              // verifier intentionally consumes SQL column names.
              return rows.map((row) =>
                Object.fromEntries(
                  Object.entries(row).map(([key, value]) => [
                    key.replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`),
                    value,
                  ]),
                ),
              ) as T[];
            } finally {
              signal.removeEventListener("abort", cancel);
            }
          },
        }),
      ) as Promise<Awaited<ReturnType<typeof work>>>,
  };
  await verifyRestoreDatabase(client, {
    manifest: parseRestoreManifest(manifest),
    sha256: CURRENT_PRIMARY_RESTORE_MANIFEST_SHA256,
  });
  active();
}
