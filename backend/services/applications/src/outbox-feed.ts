import type postgres from "postgres";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ClaimedApplicationEvent {
  /** Stable across retries: the outbox row id. */
  id: string;
  claimToken: string;
  type: "application.status_changed.v1" | "application.applied.v1";
  /** Identifiers and a status only (enforced by a database constraint). */
  data: { applicationId: string; userId: string; revision: number; status: string };
  occurredAt: Date;
}

interface ClaimedRow {
  id: string;
  claim_token: string;
  event_type: ClaimedApplicationEvent["type"];
  payload: ClaimedApplicationEvent["data"];
  occurred_at: Date;
}

/**
 * Applications-owned, owner-scoped reads of the application event outbox, with the table's own
 * claim lifecycle (pending, processing with a lease, published, failed after five attempts). A
 * consumer in another bounded context takes events through this port and never reads the table.
 * It exists so the in-app inbox can be fed with no new infrastructure; a scheduled publisher can
 * use the same lifecycle later.
 */
export class ApplicationEventOutbox {
  constructor(
    private readonly client: postgres.Sql,
    private readonly leaseMilliseconds = 60_000,
  ) {}

  /** Claims up to `limit` pending events for one owner, oldest first. */
  async claimForOwner(
    ownerUserId: string,
    limit: number,
    now: Date,
  ): Promise<ClaimedApplicationEvent[]> {
    if (!UUID_PATTERN.test(ownerUserId)) throw new TypeError("A valid owner is required");
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    const lease = new Date(now.getTime() + this.leaseMilliseconds);
    return this.client.begin(async (tx) => {
      // A lease that ran out counts as one failed attempt: retry, or fail after the fifth.
      await tx`
        UPDATE applications.outbox SET
          status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
          failed_at = CASE WHEN attempt_count >= 5 THEN ${now} ELSE NULL END,
          last_error_code = 'lease_expired', claim_token = NULL, lease_expires_at = NULL
        WHERE owner_user_id = ${ownerUserId}::uuid AND status = 'processing'
          AND lease_expires_at <= ${now}
      `;
      const rows = await tx<ClaimedRow[]>`
        WITH due AS (
          SELECT id FROM applications.outbox
          WHERE owner_user_id = ${ownerUserId}::uuid AND status = 'pending'
            AND available_at <= ${now}
          ORDER BY occurred_at, application_revision, id
          LIMIT ${bounded}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE applications.outbox AS event SET
          status = 'processing', claim_token = gen_random_uuid(), lease_expires_at = ${lease},
          attempt_count = event.attempt_count + 1, last_error_code = NULL
        FROM due WHERE event.id = due.id
        RETURNING event.id, event.claim_token, event.event_type, event.payload, event.occurred_at
      `;
      return rows
        .map((row) => ({
          id: row.id,
          claimToken: row.claim_token,
          type: row.event_type,
          data: row.payload,
          occurredAt: row.occurred_at,
        }))
        .sort(
          (left, right) =>
            left.occurredAt.getTime() - right.occurredAt.getTime() ||
            left.data.revision - right.data.revision ||
            left.id.localeCompare(right.id),
        );
    });
  }

  /** Marks a claimed event delivered. A stale or foreign claim token changes nothing. */
  async markPublished(event: { id: string; claimToken: string }, now: Date): Promise<boolean> {
    const rows = await this.client`
      UPDATE applications.outbox SET status = 'published', claim_token = NULL,
        lease_expires_at = NULL, published_at = ${now}
      WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid
        AND status = 'processing'
      RETURNING id
    `;
    return rows.length === 1;
  }

  /** Releases a claimed event after a failed delivery: retried later, or failed after five. */
  async markFailed(event: { id: string; claimToken: string }, now: Date): Promise<boolean> {
    const retryAt = new Date(now.getTime() + 30_000);
    const rows = await this.client`
      UPDATE applications.outbox SET
        status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
        failed_at = CASE WHEN attempt_count >= 5 THEN ${now} ELSE NULL END,
        last_error_code = 'transient', claim_token = NULL, lease_expires_at = NULL,
        available_at = GREATEST(available_at, ${retryAt})
      WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid
        AND status = 'processing'
      RETURNING id
    `;
    return rows.length === 1;
  }
}
