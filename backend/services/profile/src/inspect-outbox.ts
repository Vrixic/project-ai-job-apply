import postgres from "postgres";
import {
  buildOutboxInspection,
  MAX_INSPECTABLE_OUTBOX_EVENTS,
  type OutboxInspectionRow,
} from "./outbox-inspection.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const includeEventIds = process.env.OUTBOX_INSPECTION_INCLUDE_EVENT_IDS === "true";
const client = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 1,
  connect_timeout: 10,
});

try {
  const rows = await client.begin("read only", async (transaction) => {
    const result = await transaction<OutboxInspectionRow[]>`
      select id, created_at as "createdAt", attempts
      from platform.outbox_events
      where published_at is null
      order by created_at asc, id asc
      limit ${MAX_INSPECTABLE_OUTBOX_EVENTS + 1}
    `;
    return [...result];
  });
  process.stdout.write(`${JSON.stringify(buildOutboxInspection(rows, includeEventIds))}\n`);
} catch {
  process.stderr.write("Outbox inspection failed without emitting database or event content.\n");
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 });
}
