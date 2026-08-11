import { runDatabaseMigrations } from "./index.js";

await runDatabaseMigrations();
console.log("All service-owned database migrations applied and verified.");
