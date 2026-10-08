import postgres from "postgres";
import { PostgresJobRetentionStore } from "./persistence/reporting.js";

/** Owning expiry-only connection; preserves raw column names and JSON decoding. */
export function createJobRetentionRuntime(url: string, enabled: () => boolean) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const store = new PostgresJobRetentionStore(sql);
  return Object.freeze({
    async expire(limit: number) {
      if (!enabled()) throw Error("JobRetentionUnavailable");
      const result = await store.purgeExpired(limit);
      if (!enabled()) throw Error("JobRetentionUnavailable");
      return result;
    },
    close: () => sql.end(),
  });
}
