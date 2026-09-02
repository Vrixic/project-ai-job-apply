import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type {
  ClaimedContributionProcessingEvent,
  ContributionProcessingEvent,
  ContributionProcessingEventDeliveryStore,
} from "../contribution-processing-event-delivery.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface CandidateRow {
  eventId: string;
  eventType: ContributionProcessingEvent["type"];
  subject: string;
  data: unknown;
  attempt: number;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

function event(row: CandidateRow): ContributionProcessingEvent {
  if (!identifier(row.eventId) || !identifier(row.subject) || typeof row.data !== "object") {
    throw new Error("Malformed contribution processing event identity");
  }
  const data = row.data as Record<string, unknown>;
  if (
    row.eventType === "job.normalized.v1" &&
    exactKeys(data, ["contributionId", "normalizationId"]) &&
    data.contributionId === row.subject &&
    identifier(data.contributionId) &&
    identifier(data.normalizationId)
  ) {
    return Object.freeze({
      id: row.eventId,
      type: row.eventType,
      subject: row.subject,
      data: Object.freeze({
        contributionId: data.contributionId,
        normalizationId: data.normalizationId,
      }),
    });
  }
  if (
    row.eventType === "job.verified.v1" &&
    exactKeys(data, ["jobId", "sourceId", "verificationId"]) &&
    identifier(data.jobId) &&
    identifier(data.sourceId) &&
    identifier(data.verificationId)
  ) {
    return Object.freeze({
      id: row.eventId,
      type: row.eventType,
      subject: row.subject,
      data: Object.freeze({
        jobId: data.jobId,
        sourceId: data.sourceId,
        verificationId: data.verificationId,
      }),
    });
  }
  throw new Error("Malformed contribution processing event payload");
}

export class ContributionProcessingEventDeliveryClaimLostError extends Error {
  constructor() {
    super("The contribution processing event delivery claim is no longer current");
    this.name = "ContributionProcessingEventDeliveryClaimLostError";
  }
}

export class PostgresContributionProcessingEventDeliveryStore
  implements ContributionProcessingEventDeliveryStore
{
  constructor(private readonly client: postgres.Sql) {}

  async claim(
    input: Parameters<ContributionProcessingEventDeliveryStore["claim"]>[0],
  ): Promise<ClaimedContributionProcessingEvent[]> {
    return this.client.begin(async (transaction) => {
      await transaction`
        WITH expired AS (
          SELECT event_id
          FROM jobs.job_contribution_processing_event_deliveries
          WHERE state = 'claimed' AND claim_expires_at <= ${input.now}
          ORDER BY claim_expires_at, event_id
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE jobs.job_contribution_processing_event_deliveries AS delivery SET
          state = CASE WHEN delivery.attempt >= ${input.maxAttempts} THEN 'dead' ELSE 'pending' END,
          available_at = ${input.now}, claim_token = NULL, claimed_at = NULL,
          claim_expires_at = NULL, claimed_by = NULL, last_error_code = 'lease_expired',
          updated_at = ${input.now}
        FROM expired WHERE delivery.event_id = expired.event_id
      `;
      const candidates = await transaction<CandidateRow[]>`
        SELECT delivery.event_id AS "eventId", event.event_type AS "eventType",
          event.subject, event.data, delivery.attempt
        FROM jobs.job_contribution_processing_event_deliveries AS delivery
        JOIN jobs.job_contribution_processing_outbox AS event ON event.id = delivery.event_id
        WHERE delivery.state = 'pending' AND delivery.available_at <= ${input.now}
          AND delivery.attempt < ${input.maxAttempts}
        ORDER BY delivery.available_at, delivery.created_at, delivery.event_id
        LIMIT ${input.limit}
        FOR UPDATE OF delivery SKIP LOCKED
      `;
      const claimed: ClaimedContributionProcessingEvent[] = [];
      for (const candidate of candidates) {
        const claimToken = uuidv7();
        const [row] = await transaction<{ attempt: number }[]>`
          UPDATE jobs.job_contribution_processing_event_deliveries SET
            state = 'claimed', attempt = attempt + 1, claim_token = ${claimToken},
            claimed_at = ${input.now}, claim_expires_at = ${input.claimExpiresAt},
            claimed_by = ${input.workerId}, last_error_code = NULL, updated_at = ${input.now}
          WHERE event_id = ${candidate.eventId} AND state = 'pending'
          RETURNING attempt
        `;
        if (!row) throw new ContributionProcessingEventDeliveryClaimLostError();
        claimed.push(
          Object.freeze({
            event: event(candidate),
            attempt: row.attempt,
            claimToken,
            claimedBy: input.workerId,
            claimExpiresAt: new Date(input.claimExpiresAt.getTime()),
          }),
        );
      }
      return claimed;
    });
  }

  async acknowledge(
    input: Parameters<ContributionProcessingEventDeliveryStore["acknowledge"]>[0],
  ): Promise<void> {
    await this.client.begin(async (transaction) => {
      const [current] = await transaction<{ state: string; claimToken: string | null }[]>`
        SELECT state, claim_token AS "claimToken"
        FROM jobs.job_contribution_processing_event_deliveries
        WHERE event_id = ${input.item.event.id}
        FOR UPDATE
      `;
      if (current?.state === "published" && current.claimToken === input.item.claimToken) return;
      const [acknowledged] = await transaction<{ eventId: string }[]>`
        UPDATE jobs.job_contribution_processing_event_deliveries SET
          state = 'published', claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
          last_error_code = NULL, acknowledged_at = ${input.now}, updated_at = ${input.now}
        WHERE event_id = ${input.item.event.id} AND state = 'claimed'
          AND claim_token = ${input.item.claimToken} AND claimed_by = ${input.workerId}
        RETURNING event_id AS "eventId"
      `;
      if (!acknowledged) throw new ContributionProcessingEventDeliveryClaimLostError();
    });
  }

  async retry(
    input: Parameters<ContributionProcessingEventDeliveryStore["retry"]>[0],
  ): Promise<void> {
    const [updated] = await this.client<{ eventId: string }[]>`
      UPDATE jobs.job_contribution_processing_event_deliveries SET
        state = ${input.terminal ? "dead" : "pending"}, available_at = ${input.retryAt},
        claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.errorCode}, updated_at = ${input.now}
      WHERE event_id = ${input.item.event.id} AND state = 'claimed'
        AND claim_token = ${input.item.claimToken} AND claimed_by = ${input.workerId}
      RETURNING event_id AS "eventId"
    `;
    if (!updated) throw new ContributionProcessingEventDeliveryClaimLostError();
  }
}
