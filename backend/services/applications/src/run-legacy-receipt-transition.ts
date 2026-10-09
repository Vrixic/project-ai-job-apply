import postgres from "postgres";
import {
  legacyReceiptMaintenanceCipher,
  legacyReceiptMaintenanceFromEnvironment,
} from "./legacy-receipt-maintenance.js";
import { transitionLegacyReceipts } from "./legacy-receipt-transition.js";

async function main() {
  const admitted = legacyReceiptMaintenanceFromEnvironment(process.env);
  const cipher = legacyReceiptMaintenanceCipher(admitted);
  const client = postgres(admitted.databaseUrl, { max: 2, onnotice: () => undefined });
  try {
    const result = await transitionLegacyReceipts(client, {
      enabled: admitted.enabled,
      cipher,
      expectedAppliedMigrations: admitted.configuration.expectedAppliedMigrations,
      expectedLegacyReceipts: admitted.configuration.expectedLegacyReceipts,
    });
    console.log(
      JSON.stringify({
        kind: "legacy_receipt_transition_verified",
        schemaVersion: 1,
        runId: admitted.configuration.runId,
        sourceSha: admitted.configuration.sourceSha,
        configurationSha256: admitted.configurationSha256,
        ...result,
      }),
    );
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      kind: "legacy_receipt_transition_failed",
      errorCode: "transition_unavailable",
    }),
  );
  process.exitCode = 1;
});
