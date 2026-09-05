import { createHash } from "node:crypto";
import type postgres from "postgres";

interface ParkedRow {
  id: string;
  contributionId: string;
  updatedAt: string;
  reason: string | null;
  eventId: string | null;
}

export interface ContributionRecoverySnapshot {
  schemaVersion: 1;
  inspected: number;
  retryable: number;
  unavailable: number;
  mismatch: number;
  closed: number;
  duplicate: number;
  other: number;
  fingerprint: string;
}

const retryReasons = new Set(["provider_temporarily_unavailable", "provider_observation_mismatch"]);

function snapshot(rows: readonly ParkedRow[]): ContributionRecoverySnapshot {
  const counts = { unavailable: 0, mismatch: 0, closed: 0, duplicate: 0, other: 0 };
  for (const row of rows) {
    if (row.reason === "provider_temporarily_unavailable") counts.unavailable++;
    else if (row.reason === "provider_observation_mismatch") counts.mismatch++;
    else if (row.reason === "provider_posting_closed") counts.closed++;
    else if (row.reason === "provider_probable_duplicate") counts.duplicate++;
    else counts.other++;
  }
  return {
    schemaVersion: 1,
    inspected: rows.length,
    retryable: counts.unavailable + counts.mismatch,
    ...counts,
    // Only an opaque digest and fixed counters leave the owning data boundary.
    fingerprint: createHash("sha256")
      .update("d2-provider-recovery-v1\n")
      .update(JSON.stringify(rows))
      .digest("hex"),
  };
}

async function parked(client: postgres.Sql | postgres.TransactionSql, lock: boolean) {
  return client<ParkedRow[]>`
    SELECT queue.id, queue.contribution_id AS "contributionId",
      queue.updated_at::text AS "updatedAt", latest.reason_code AS reason,
      latest.id AS "eventId"
    FROM jobs.job_contribution_processing_queue AS queue
    LEFT JOIN LATERAL (
      SELECT id, reason_code FROM jobs.job_contribution_state_events
      WHERE contribution_id = queue.contribution_id
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) AS latest ON true
    WHERE queue.state = 'parked' AND queue.last_error_code = 'provider_pending'
    ORDER BY CASE WHEN latest.reason_code IN
      ('provider_temporarily_unavailable', 'provider_observation_mismatch') THEN 0 ELSE 1 END,
      queue.id LIMIT 25
    ${lock ? client`FOR UPDATE OF queue` : client``}
  `;
}

/** Operator-only bounded recovery. Never approves, publishes, changes payload, or skips gates. */
export class PostgresContributionRecoveryStore {
  constructor(private readonly client: postgres.Sql) {}

  async inspect(): Promise<ContributionRecoverySnapshot> {
    return snapshot(await parked(this.client, false));
  }

  async retry(expectedFingerprint: string, now: Date): Promise<{ requeued: number }> {
    if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint) || !Number.isFinite(now.getTime())) {
      throw new Error("ContributionRecoveryInputRejected");
    }
    return this.client.begin(async (transaction) => {
      const rows = await parked(transaction, true);
      if (snapshot(rows).fingerprint !== expectedFingerprint) {
        throw new Error("ContributionRecoverySnapshotChanged");
      }
      let requeued = 0;
      for (const row of rows) {
        if (!retryReasons.has(row.reason ?? "")) continue;
        const updated = await transaction`
          UPDATE jobs.job_contribution_processing_queue
          SET state = 'pending', attempt = 0, available_at = ${now.toISOString()},
            last_error_code = NULL, updated_at = ${now.toISOString()}
          WHERE id = ${row.id} AND state = 'parked' AND last_error_code = 'provider_pending'
            AND (SELECT event.id FROM jobs.job_contribution_state_events AS event
              WHERE event.contribution_id = ${row.contributionId}
              ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1) = ${row.eventId}
          RETURNING id
        `;
        if (updated.count !== 1) throw new Error("ContributionRecoveryConflict");
        requeued++;
      }
      return { requeued };
    });
  }
}
