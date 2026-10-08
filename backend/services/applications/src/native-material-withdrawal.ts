import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeMaterialWithdrawalUnavailable");

/** Private Applications admission control. Caller resolves the authenticated owner; no material
 * content, task effects or submission-state changes. Replays retain the original cutoff. */
export class PostgresNativeMaterialWithdrawalStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}

  async withdraw(
    ownerUserId: string,
    requestId: string,
  ): Promise<{ requestId: string; requestedAtMs: number }> {
    const check = () => {
      if (!this.enabled() || !uuid.test(ownerUserId) || !uuid.test(requestId)) throw unavailable();
    };
    check();
    try {
      return await this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`native-material-withdrawal:${ownerUserId}`},0))`;
        check();
        // Wait for existing preparation mutations before timestamping a new withdrawal.
        // Otherwise a completion winning the row lock could publish after an earlier cutoff.
        const [existing] = await tx`SELECT id FROM applications.native_material_withdrawals
          WHERE id=${requestId} AND owner_user_id=${ownerUserId}`;
        if (!existing)
          await tx`SELECT id FROM applications.packet_preparations
          WHERE owner_user_id=${ownerUserId} AND state IN ('queued','running') ORDER BY id FOR UPDATE`;
        await tx`INSERT INTO applications.native_material_withdrawals(id,owner_user_id)
          VALUES (${requestId},${ownerUserId}) ON CONFLICT(id) DO NOTHING`;
        const [request] = await tx<Array<{ requested_at: Date }>>`
          SELECT requested_at FROM applications.native_material_withdrawals
          WHERE id=${requestId} AND owner_user_id=${ownerUserId}`;
        if (!request) throw unavailable();
        // Withdraw current queued/running cover-letter requests without resetting their original
        // launch claims, outbox receipts, provider grants or ambiguous submission evidence.
        const withdrawn = await tx<Array<{ id: string; updated_at: Date }>>`
          UPDATE applications.packet_preparations SET state='failed',error_code='application_changed',
            updated_at=GREATEST(updated_at,clock_timestamp())
          WHERE owner_user_id=${ownerUserId} AND state IN ('queued','running')
            AND approved_at <= ${request.requested_at}
          RETURNING id,updated_at`;
        for (const row of withdrawn)
          await tx`
          INSERT INTO applications.preparation_audit(id,preparation_id,owner_user_id,action,occurred_at)
          VALUES (${uuidv7()},${row.id},${ownerUserId},'failed',${row.updated_at})`;
        check();
        return { requestId, requestedAtMs: request.requested_at.getTime() };
      });
    } catch {
      throw unavailable();
    }
  }
}
