import postgres from "postgres";
import {
  executeDocumentProcessingAcceptance,
  parseDocumentProcessingAcceptanceEnvironment,
} from "./document-processing-acceptance.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 1,
  connect_timeout: 10,
  onnotice: () => undefined,
});

try {
  const input = parseDocumentProcessingAcceptanceEnvironment(process.env);
  const result = await executeDocumentProcessingAcceptance(client, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    "Document-processing synthetic acceptance action failed without emitting candidate values.\n",
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 });
}
