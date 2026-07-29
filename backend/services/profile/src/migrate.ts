import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = fileURLToPath(
  new URL("../../migrations/0001_foundation.sql", import.meta.url),
);
const migration = await readFile(migrationPath, "utf8");
const client = postgres(databaseUrl, { max: 1 });
try {
  await client.unsafe(migration);
} finally {
  await client.end();
}
