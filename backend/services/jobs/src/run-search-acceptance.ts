import postgres from "postgres";
import {
  assertRecentJobSearchAcceptanceTime,
  executeJobSearchAcceptance,
  parseJobSearchAcceptanceEnvironment,
} from "./search-acceptance.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 1,
  connect_timeout: 10,
  onnotice: () => undefined,
});

try {
  const input = parseJobSearchAcceptanceEnvironment(process.env);
  if (input.at) {
    assertRecentJobSearchAcceptanceTime(input.at);
  }
  const result = await executeJobSearchAcceptance(client, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    "Job-search synthetic acceptance action failed without emitting catalog values.\n",
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 });
}
