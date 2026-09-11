import postgres from "postgres";
import {
  executeSyntheticCatalogRetirement,
  parseSyntheticCatalogRetirementEnvironment,
} from "./synthetic-catalog-retirement.js";

// One fixed internal task entrypoint, not a public API or a general SQL executor.
let client: postgres.Sql | undefined;
try {
  if (process.argv.length !== 2) throw new Error("SyntheticCatalogRetirementRejected");
  const input = parseSyntheticCatalogRetirementEnvironment(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("SyntheticCatalogRetirementRejected");
  client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const result = await executeSyntheticCatalogRetirement(client, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write("Synthetic catalog retirement refused without emitting catalog values.\n");
  process.exitCode = 1;
} finally {
  try {
    await client?.end({ timeout: 1 });
  } catch {
    process.stderr.write("Synthetic catalog retirement connection cleanup failed.\n");
    process.exitCode = 1;
  }
}
