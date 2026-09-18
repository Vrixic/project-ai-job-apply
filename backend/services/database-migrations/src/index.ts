import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface MigrationRunner {
  owner: string;
  executable: string;
}

export type MigrationExecutor = (runner: MigrationRunner) => Promise<void>;

export const migrationRunners: readonly MigrationRunner[] = [
  { owner: "profile", executable: "profile/dist/src/migrate.js" },
  { owner: "jobs", executable: "jobs/dist/src/migrate.js" },
  { owner: "documents", executable: "documents/dist/src/migrate.js" },
  { owner: "matching", executable: "matching/dist/src/migrate.js" },
  { owner: "billing", executable: "billing/dist/src/migrate.js" },
  { owner: "trust", executable: "trust/dist/src/migrate.js" },
  { owner: "applications", executable: "applications/dist/src/migrate.js" },
];

export async function executeMigrationProcess(runner: MigrationRunner): Promise<void> {
  const executable = resolve(process.cwd(), runner.executable);
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, [executable], {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectProcess);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveProcess();
        return;
      }
      rejectProcess(
        new Error(
          `${runner.owner} migration failed (${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`})`,
        ),
      );
    });
  });
}

export async function runDatabaseMigrations(
  execute: MigrationExecutor = executeMigrationProcess,
): Promise<void> {
  for (const runner of migrationRunners) {
    await execute(runner);
  }
}
