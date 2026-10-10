import { collectRestoreDataInventory } from "./restore-data-inventory.js";
import { resolveRestoreDataManifest } from "./restore-data-inventory-manifest.js";
import { createRestoreClient, resolveRestoreDatabaseUrl } from "./restore-verifier-runtime.js";

async function main(): Promise<void> {
  const source = resolveRestoreDataManifest(process.env);
  const client = createRestoreClient(resolveRestoreDatabaseUrl(process.env));
  try {
    const inventory = await collectRestoreDataInventory(client, source);
    console.log(JSON.stringify({ event: "restore_data_inventory", inventory }));
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({ event: "restore_data_inventory_failed", error_code: "verification_failed" }),
  );
  process.exitCode = 1;
});
