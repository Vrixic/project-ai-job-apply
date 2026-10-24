import type postgres from "postgres";

/**
 * The Gateway and workflows share one Drizzle-wrapped client. Drizzle makes timestamp serializers and
 * parsers pass values through unchanged, so a bound `Date` throws and a timestamp comes back as the
 * driver's text. Mirror that here so a bug of that kind fails these tests instead of production.
 */
export function mirrorSharedClient(client: postgres.Sql): void {
  const options = client.options as unknown as {
    parsers: Record<string, (value: unknown) => unknown>;
    serializers: Record<string, (value: unknown) => unknown>;
  };
  const passThrough = (value: unknown) => value;
  for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
    options.parsers[type] = passThrough;
    options.serializers[type] = passThrough;
  }
}
