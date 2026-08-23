import postgres from "postgres";
import {
  assertRecentPrivateFeatureMatchingTime,
  executePrivateFeatureMatchingAcceptance,
  parsePrivateFeatureMatchingAcceptanceEnvironment,
} from "./private-feature-acceptance.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 1,
  connect_timeout: 10,
  onnotice: () => undefined,
});
try {
  const input = parsePrivateFeatureMatchingAcceptanceEnvironment(process.env);
  if (input.action === "prepare") assertRecentPrivateFeatureMatchingTime(input.savedAt);
  const result = await executePrivateFeatureMatchingAcceptance(client, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    "Private-feature Matching acceptance failed without emitting candidate values.\n",
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 });
}
