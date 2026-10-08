import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

export const privilegedModerationActions = Object.freeze([
  "jobs.moderation.case_search.access",
  "jobs.moderation.report_summary.access",
  "jobs.moderation.case_open.attempt",
  "jobs.moderation.case_resolve.attempt",
] as const);
export interface PrivilegedModerationAuditRecord {
  action: (typeof privilegedModerationActions)[number];
  /** Existing Gateway OIDC fingerprint; never a subject, email or bearer token. */
  operatorId: string;
  resourceId: string | null;
}
export interface PrivilegedModerationAuditWriter {
  record(input: PrivilegedModerationAuditRecord): Promise<void>;
}
const unavailable = () => Error("PrivilegedModerationAuditUnavailable");
function valid(input: PrivilegedModerationAuditRecord) {
  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 3
  )
    return false;
  for (const key of ["action", "operatorId", "resourceId"]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return false;
  }
  return (
    privilegedModerationActions.includes(input.action) &&
    typeof input.operatorId === "string" &&
    /^oidc:[a-f0-9]{64}$/u.test(input.operatorId) &&
    (input.resourceId === null ||
      (typeof input.resourceId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
          input.resourceId,
        )))
  );
}

/** Profile owns the existing platform audit table. No new table, migration or public reader.
 * Access/attempt records precede the protected operation and never assert its success. */
export class PostgresPrivilegedModerationAuditStore implements PrivilegedModerationAuditWriter {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}
  async record(input: PrivilegedModerationAuditRecord): Promise<void> {
    try {
      if (!this.enabled() || !valid(input)) throw unavailable();
      const fixed = Object.freeze({ ...input });
      const id = uuidv7();
      await this.sql.begin(async (tx) => {
        await tx`INSERT INTO platform.audit_events (id,user_id,action,resource_type,resource_id,trace_id,metadata,occurred_at)
          VALUES (${id},NULL,${fixed.action},'job_moderation',${fixed.resourceId},${id},
            jsonb_build_object('schemaVersion',1,'operatorId',${fixed.operatorId}::text),clock_timestamp())`;
        if (!this.enabled()) throw unavailable();
      });
    } catch {
      throw unavailable();
    }
  }
  /** Separate maintenance gate. Delete only this exact format after the accepted 365-day bound. */
  async expire(limit = 100): Promise<number> {
    try {
      if (!this.enabled() || !Number.isInteger(limit) || limit < 1 || limit > 1_000)
        throw unavailable();
      return await this.sql.begin(async (tx) => {
        const [row] = await tx<Array<{ expired: number }>>`
          WITH due AS (
            SELECT id FROM platform.audit_events
            WHERE action = ANY(${[...privilegedModerationActions]}::text[])
              AND user_id IS NULL AND resource_type='job_moderation' AND trace_id=id::text
              AND metadata = jsonb_build_object('schemaVersion',1,'operatorId',metadata->>'operatorId')
              AND metadata->>'operatorId' ~ '^oidc:[a-f0-9]{64}$'
              AND occurred_at <= statement_timestamp() - interval '365 days'
            ORDER BY occurred_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED
          ), removed AS (
            DELETE FROM platform.audit_events audit USING due WHERE audit.id=due.id RETURNING audit.id
          ) SELECT count(*)::integer AS expired FROM removed`;
        if (
          !this.enabled() ||
          !row ||
          !Number.isInteger(row.expired) ||
          row.expired < 0 ||
          row.expired > limit
        )
          throw unavailable();
        return row.expired;
      });
    } catch {
      throw unavailable();
    }
  }
}

/** Gateway receives only the writer; expiry authority stays in separate maintenance. */
export function createPrivilegedModerationAuditRuntime(url: string, enabled: () => boolean) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const store = new PostgresPrivilegedModerationAuditStore(sql, enabled);
  return Object.freeze({
    writer: Object.freeze({ record: store.record.bind(store) }),
    close: () => sql.end(),
  });
}
