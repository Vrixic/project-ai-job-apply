import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type MigrationRunner = (
  executable: string,
  arguments_: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean },
) => Promise<unknown>;

/** Test-only setup; no dotenv, inherited application settings, or order-dependent suite seeding. */
export async function prepareJobsIntegration(
  environment: NodeJS.ProcessEnv,
  runMigration: MigrationRunner = promisify(execFile),
): Promise<void> {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) return;
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("JobsIntegrationDatabaseTargetRejected");
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !/^\/[A-Za-z0-9_-]{1,63}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  ) {
    throw new Error("JobsIntegrationDatabaseTargetRejected");
  }
  const migrationEnvironment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(environment).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    ),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
  };
  for (const owner of ["profile", "jobs"] as const) {
    try {
      await runMigration(
        process.execPath,
        [fileURLToPath(new URL(`../../${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: migrationEnvironment, timeout: 60_000, windowsHide: true },
      );
    } catch {
      // Native errors can contain connection URLs or raw database output. Report only the owner.
      throw new Error(`JobsIntegrationMigrationFailed:${owner}`);
    }
  }
}

export default async function setup(): Promise<void> {
  await prepareJobsIntegration(process.env);
}
