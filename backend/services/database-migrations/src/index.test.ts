import { describe, expect, it, vi } from "vitest";
import { migrationRunners, runDatabaseMigrations } from "./index.js";

describe("database migration orchestrator", () => {
  it("runs every owner in the declared order", async () => {
    const visited: string[] = [];
    await runDatabaseMigrations(async (runner) => {
      visited.push(runner.owner);
    });
    expect(visited).toEqual(["profile", "jobs", "documents"]);
    expect(migrationRunners.map((runner) => runner.executable)).toEqual([
      "profile/dist/src/migrate.js",
      "jobs/dist/src/migrate.js",
      "documents/dist/src/migrate.js",
    ]);
  });

  it("stops before later owners when one migration fails", async () => {
    const execute = vi.fn(async (runner: (typeof migrationRunners)[number]) => {
      if (runner.owner === "profile") {
        throw new Error("synthetic migration failure");
      }
    });
    await expect(runDatabaseMigrations(execute)).rejects.toThrow("synthetic migration failure");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
