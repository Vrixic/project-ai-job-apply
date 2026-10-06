import postgres from "postgres";
import { PostgresJobReportRetentionStore } from "./persistence/reporting.js";

// Dedicated maintenance composition, never a candidate request or default development task.
if (process.env.JOB_REPORT_RETENTION_ENABLED !== "true") {
  throw new Error("Job report retention maintenance is disabled");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const configuredBatch = process.env.JOB_REPORT_RETENTION_BATCH_LIMIT ?? "100";
if (!/^[1-9][0-9]{0,3}$/u.test(configuredBatch) || Number(configuredBatch) > 1_000) {
  throw new Error("The report retention batch limit is invalid");
}
const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try {
  const deleted = await new PostgresJobReportRetentionStore(client).purgeExpired(
    Number(configuredBatch),
  );
  console.log(JSON.stringify({ owner: "jobs", reportsExpired: deleted }));
} catch {
  // Native database exceptions may contain query context; emit no row or connection values.
  throw new Error("Job report retention maintenance failed");
} finally {
  await client.end();
}
