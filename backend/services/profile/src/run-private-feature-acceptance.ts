import postgres from "postgres";
import {
  assertRecentPrivateFeatureAcceptanceTime,
  executePrivateFeatureProfileAcceptance,
  parsePrivateFeatureProfileAcceptanceEnvironment,
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
  const input = parsePrivateFeatureProfileAcceptanceEnvironment(process.env);
  if (input.at) assertRecentPrivateFeatureAcceptanceTime(input.at);
  const result = await executePrivateFeatureProfileAcceptance(client, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    "Private-feature Profile acceptance failed without emitting candidate values.\n",
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 });
}
