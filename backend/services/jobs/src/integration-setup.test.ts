import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { prepareJobsIntegration } from "./integration-setup.js";

describe("Jobs integration migration setup", () => {
  it.each([undefined, ""])("does nothing without an explicit database URL (%s)", async (url) => {
    const run = vi.fn(async () => undefined);
    await prepareJobsIntegration({ DATABASE_URL: url }, run);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    "postgres://synthetic:local@127.0.0.1:55432/synthetic_jobs",
    "postgresql://synthetic:local@localhost:55432/synthetic_jobs",
    "postgres://synthetic:local@[::1]:55432/synthetic_jobs",
  ])(
    "applies Profile then Jobs using only the explicit loopback target and OS settings",
    async (url) => {
      const run = vi.fn(async () => undefined);
      await prepareJobsIntegration(
        {
          DATABASE_URL: url,
          Path: "synthetic-path",
          SYSTEMROOT: "synthetic-system-root",
          NODE_ENV: "production",
          NODE_OPTIONS: "--import=synthetic-untrusted-module",
          AWS_ACCESS_KEY_ID: "synthetic-cloud-key",
          OIDC_CLIENT_SECRET: "synthetic-client-secret",
          PGHOST: "synthetic-unrelated-host.invalid",
          DOTENV_CONFIG_PATH: "synthetic-unrelated-env-file",
        },
        run,
      );
      expect(run.mock.calls).toEqual(
        ["profile", "jobs"].map((owner) => [
          process.execPath,
          [fileURLToPath(new URL(`../../${owner}/dist/src/migrate.js`, import.meta.url))],
          {
            env: {
              Path: "synthetic-path",
              SYSTEMROOT: "synthetic-system-root",
              NODE_ENV: "test",
              DATABASE_URL: url,
            },
            timeout: 60_000,
            windowsHide: true,
          },
        ]),
      );
    },
  );

  it.each([
    "invalid",
    "https://localhost/synthetic_jobs",
    "postgres://synthetic:local@database.invalid/synthetic_jobs",
    "postgres://synthetic:local@localhost/",
    "postgres://synthetic:local@localhost/synthetic/jobs",
    "postgres://synthetic:local@localhost/synthetic_jobs?host=database.invalid",
    "postgres://synthetic:local@localhost/synthetic_jobs#fragment",
  ])("refuses an ambiguous or nonlocal target before executing any migration", async (url) => {
    const run = vi.fn(async () => undefined);
    await expect(prepareJobsIntegration({ DATABASE_URL: url }, run)).rejects.toThrow(
      "JobsIntegrationDatabaseTargetRejected",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["profile", "jobs"])(
    "fails closed with a sanitized %s migration error",
    async (owner) => {
      const run = vi.fn(async (_executable, arguments_: string[]) => {
        if (
          arguments_[0]?.includes(`${owner}/dist/`) ||
          arguments_[0]?.includes(`${owner}\\dist\\`)
        ) {
          throw new Error("synthetic-private-database-output");
        }
      });
      await expect(
        prepareJobsIntegration(
          { DATABASE_URL: "postgres://synthetic:local@127.0.0.1:55432/synthetic_jobs" },
          run,
        ),
      ).rejects.toThrow(`JobsIntegrationMigrationFailed:${owner}`);
      expect(run).toHaveBeenCalledTimes(owner === "profile" ? 1 : 2);
    },
  );
});
