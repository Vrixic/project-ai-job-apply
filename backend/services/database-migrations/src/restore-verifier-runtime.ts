import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { RestoreSqlClient } from "./restore-verifier.js";

export interface PostgresRestoreClient extends RestoreSqlClient {
  end(): Promise<void>;
  unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]>;
}

type PostgresFactory = (
  databaseUrl: string,
  options: {
    connect_timeout: number;
    idle_timeout: number;
    max: number;
    onnotice: () => undefined;
  },
) => PostgresRestoreClient;

export const restoreConnectionOptions = Object.freeze({
  connect_timeout: 15,
  idle_timeout: 30,
  max: 1,
});

function loadPostgres(): PostgresFactory {
  const profilePackages = [
    new URL("../../profile/package.json", import.meta.url),
    new URL("../../../profile/package.json", import.meta.url),
  ];
  const profilePackage = profilePackages.find((candidate) => existsSync(candidate));
  if (!profilePackage) {
    throw new Error("The migration image Profile runtime is unavailable");
  }
  return createRequire(profilePackage)("postgres") as PostgresFactory;
}

export function resolveRestoreDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const source = environment.DATABASE_URL;
  if (!source) {
    throw new Error("DATABASE_URL is required");
  }
  const url = new URL(source);
  const queryKeys = [...url.searchParams.keys()];
  if (
    url.protocol !== "postgres:" ||
    url.username !== "platform" ||
    !url.password ||
    url.port !== "5432" ||
    url.pathname !== "/ai_job_apply" ||
    url.hash ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "sslmode" ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    url.searchParams.get("sslmode") !== "require"
  ) {
    throw new Error("DATABASE_URL must use the exact required PostgreSQL TLS boundary");
  }
  const restoreHost = environment.RESTORE_HOST;
  if (
    !restoreHost ||
    restoreHost.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.rds\.amazonaws\.com$/.test(restoreHost)
  ) {
    throw new Error("RESTORE_HOST is not an exact RDS hostname");
  }
  url.hostname = restoreHost;
  return url.toString();
}

export function createRestoreClient(databaseUrl: string): PostgresRestoreClient {
  return loadPostgres()(databaseUrl, {
    ...restoreConnectionOptions,
    onnotice: () => undefined,
  });
}
