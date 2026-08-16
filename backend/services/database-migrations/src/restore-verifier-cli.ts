import { buildRestoreVerificationEvent, verifyRestoreDatabase } from "./restore-verifier.js";
import { createRestoreClient, resolveRestoreDatabaseUrl } from "./restore-verifier-runtime.js";

async function main(): Promise<void> {
  const client = createRestoreClient(resolveRestoreDatabaseUrl(process.env));
  try {
    const result = await verifyRestoreDatabase(client);
    console.log(JSON.stringify(buildRestoreVerificationEvent(result)));
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({ event: "d1_restore_verification_failed", error_code: "verification_failed" }),
  );
  process.exitCode = 1;
});
