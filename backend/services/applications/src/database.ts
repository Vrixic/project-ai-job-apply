import postgres from "postgres";

export interface ApplicationsDatabaseOptions {
  maxConnections?: number;
}

/**
 * The dedicated client the Applications store requires. The store reads snake_case columns, real
 * `Date` values, and writes JSON through `sql.json`. The gateway's shared client (created for
 * Profile and Drizzle) transforms columns to camelCase, returns timestamps as strings, and installs
 * an identity JSON serializer, so the store must never be handed that client: on it a create fails
 * with `ERR_INVALID_ARG_TYPE`. Compose Applications with this client instead.
 */
export function createApplicationsDatabase(
  databaseUrl: string,
  options: ApplicationsDatabaseOptions = {},
): postgres.Sql {
  return postgres(databaseUrl, {
    max: options.maxConnections ?? 4,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
}
