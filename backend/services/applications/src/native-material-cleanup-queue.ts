import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeMaterialCleanupQueueUnavailable");
export interface NativeMaterialCleanupClaim {
  ownerUserId: string;
  requestId: string;
  claimToken: string;
  afterApplicationId: string | null;
}

/** Applications-owned, leased continuation; never holds a database lock over task I/O. */
export class PostgresNativeMaterialCleanupQueue {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}
  private check() {
    if (!this.enabled()) throw unavailable();
  }
  async read(owner: string, requestId: string) {
    this.check();
    if (!uuid.test(owner) || !uuid.test(requestId)) throw unavailable();
    const [row] = await this.sql<
      Array<{ requested_at: Date; cutoff_epoch_micros: string; state: string }>
    >`
      SELECT w.requested_at,(extract(epoch FROM w.requested_at)*1000000)::bigint::text AS cutoff_epoch_micros,q.state
      FROM applications.native_material_withdrawals w JOIN applications.native_material_cleanup_queue q
        ON q.request_id=w.id AND q.owner_user_id=w.owner_user_id
      WHERE w.id=${requestId} AND w.owner_user_id=${owner}`;
    this.check();
    return row
      ? {
          requestId,
          requestedAtMs: row.requested_at.getTime(),
          cutoffEpochMicros: row.cutoff_epoch_micros,
          state:
            row.state === "native_tasks_settled"
              ? ("native_tasks_settled" as const)
              : ("pending" as const),
        }
      : null;
  }
  async claim(): Promise<NativeMaterialCleanupClaim | null> {
    this.check();
    return this.sql.begin(async (tx) => {
      const token = uuidv7();
      const [row] = await tx<
        Array<{ owner_user_id: string; request_id: string; after_application_id: string | null }>
      >`
        WITH pending AS (
          SELECT request_id FROM applications.native_material_cleanup_queue
          WHERE available_at <= clock_timestamp() AND (state='pending' OR (state='processing' AND lease_expires_at <= clock_timestamp()))
          ORDER BY available_at,request_id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE applications.native_material_cleanup_queue q
          SET state='processing',claim_token=${token},lease_expires_at=clock_timestamp()+interval '5 minutes'
          FROM pending WHERE q.request_id=pending.request_id
          RETURNING q.owner_user_id,q.request_id,q.after_application_id`;
      this.check();
      return row
        ? {
            ownerUserId: row.owner_user_id,
            requestId: row.request_id,
            claimToken: token,
            afterApplicationId: row.after_application_id,
          }
        : null;
    });
  }
  async finish(
    claim: NativeMaterialCleanupClaim,
    result: { state: "pending" | "native_tasks_settled"; nextApplicationId: string | null },
  ): Promise<boolean> {
    this.check();
    const fixed = structuredClone(claim),
      next = structuredClone(result);
    if (
      ![fixed.ownerUserId, fixed.requestId, fixed.claimToken].every((x) => uuid.test(x)) ||
      !["pending", "native_tasks_settled"].includes(next.state) ||
      (next.nextApplicationId !== null && !uuid.test(next.nextApplicationId))
    )
      throw unavailable();
    return this.sql.begin(async (tx) => {
      const rows = await tx`UPDATE applications.native_material_cleanup_queue
        SET state=${next.state},claim_token=NULL,lease_expires_at=NULL,
          after_application_id=${next.state === "native_tasks_settled" ? null : next.nextApplicationId},
          completed_at=CASE WHEN ${next.state}='native_tasks_settled' THEN clock_timestamp() ELSE NULL END,
          available_at=clock_timestamp()+CASE WHEN ${next.nextApplicationId}::uuid IS NULL THEN interval '30 seconds' ELSE interval '0 seconds' END
        WHERE request_id=${fixed.requestId} AND owner_user_id=${fixed.ownerUserId} AND state='processing'
          AND claim_token=${fixed.claimToken} AND lease_expires_at > clock_timestamp() RETURNING request_id`;
      this.check();
      return rows.length === 1;
    });
  }
}
