import postgres from "postgres";

/**
 * A client configured like the one the Gateway and workflows share. That client is created with
 * `postgres.camel` (every column name comes back camelCase) and wrapped by Drizzle, which makes
 * timestamp serializers and parsers pass values through unchanged: a bound `Date` throws and a
 * timestamp comes back as the driver's text. Using it here makes a bug of either kind fail these
 * tests instead of production.
 */
export function createSharedStyleClient(url: string, max: number): postgres.Sql {
  const client = postgres(url, { max, onnotice: () => undefined, transform: postgres.camel });
  const options = client.options as unknown as {
    parsers: Record<string, (value: unknown) => unknown>;
    serializers: Record<string, (value: unknown) => unknown>;
  };
  const passThrough = (value: unknown) => value;
  for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
    options.parsers[type] = passThrough;
    options.serializers[type] = passThrough;
  }
  return client;
}
