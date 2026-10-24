/**
 * The shared database client is wrapped by Drizzle, which sends a bound value through unchanged and
 * hands a timestamp back as the driver's raw text. A bound `Date` then throws inside the driver. So
 * every timestamp is bound as an ISO string with an explicit `::timestamptz` cast and read back
 * through `asDate`, which also accepts a `Date` for a plain client.
 */
export function iso(value: Date): string {
  return value.toISOString();
}

export function asDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}
