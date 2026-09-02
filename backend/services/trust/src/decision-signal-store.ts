import { eventTypes, validateEventData } from "@ai-job-apply/event-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type {
  ClaimedTrustContributionDecisionEvent,
  TrustContributionDecisionEvent,
  TrustDecisionDeliveryStore,
} from "./decision-signal.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V8_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

export interface TrustDecisionSignalReference {
  decisionId: string;
  contributionId: string;
}

export type AuthoritativeTrustContributionDecision =
  | {
      status: "needs_review";
      contributionId: string;
      decisionId: string;
      policyVersion: string;
      decidedAt: string;
    }
  | {
      status: "accepted" | "rejected" | "withdrawn" | "taken_down";
      contributionId: string;
      decisionId: string;
      policyVersion: string;
      decidedAt: string;
    };

interface DeliveryCandidateRow {
  eventId: string;
  eventType: TrustContributionDecisionEvent["type"];
  subject: string;
  data: unknown;
  attempt: number;
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Stored Trust decision time is invalid");
  return parsed.toISOString();
}

function event(row: DeliveryCandidateRow): TrustContributionDecisionEvent {
  if (
    row.eventType !== eventTypes.trustContributionDecisionChanged ||
    !UUID_V8_PATTERN.test(row.eventId) ||
    !UUID_V7_PATTERN.test(row.subject) ||
    !validateEventData(row.eventType, row.data)
  ) {
    throw new Error("Malformed Trust contribution decision event");
  }
  const data = row.data as { decisionId: string; contributionId: string };
  if (data.decisionId !== row.eventId || data.contributionId !== row.subject) {
    throw new Error("Malformed Trust contribution decision identity binding");
  }
  return Object.freeze({
    id: row.eventId,
    type: row.eventType,
    subject: row.subject,
    data: Object.freeze({ ...data }),
  });
}

export class TrustDecisionDeliveryClaimLostError extends Error {
  constructor() {
    super("The Trust decision delivery claim is no longer current");
    this.name = "TrustDecisionDeliveryClaimLostError";
  }
}

/** Exact Trust-owned reader plus durable delivery ledger. It never writes a Jobs relation. */
export class PostgresTrustDecisionSignalStore implements TrustDecisionDeliveryStore {
  constructor(private readonly client: postgres.Sql) {}

  async readSignal(decisionId: string): Promise<TrustDecisionSignalReference | null> {
    if (!UUID_V8_PATTERN.test(decisionId)) return null;
    const [row] = await this.client<TrustDecisionSignalReference[]>`
      SELECT id AS "decisionId", contribution_id AS "contributionId"
      FROM trust.contribution_decision_outbox WHERE id = ${decisionId}
    `;
    return row && UUID_V7_PATTERN.test(row.contributionId) ? Object.freeze(row) : null;
  }

  async readDecision(input: {
    decisionId: string;
    contributionId: string;
    contributorUserId: string;
  }): Promise<AuthoritativeTrustContributionDecision | null> {
    if (
      !UUID_V8_PATTERN.test(input.decisionId) ||
      !UUID_V7_PATTERN.test(input.contributionId) ||
      !UUID_PATTERN.test(input.contributorUserId)
    ) {
      return null;
    }
    const [row] = await this.client<
      {
        contributionId: string;
        decisionId: string;
        policyVersion: string;
        resultingState:
          | "needs_review"
          | "accepted"
          | "rejected"
          | "appeal_pending"
          | "withdrawn"
          | "taken_down";
        decidedAt: Date | string;
      }[]
    >`
      SELECT event.event_id AS "decisionId", event.contribution_id AS "contributionId",
        event.policy_version AS "policyVersion", event.resulting_state AS "resultingState",
        event.occurred_at AS "decidedAt"
      FROM trust.case_events AS event
      JOIN trust.contribution_cases AS trust_case ON trust_case.id = event.case_id
      WHERE event.event_id = ${input.decisionId}
        AND event.contribution_id = ${input.contributionId}
        AND trust_case.contributor_user_id = ${input.contributorUserId}
    `;
    if (
      !row ||
      row.decisionId !== input.decisionId ||
      row.contributionId !== input.contributionId ||
      !POLICY_VERSION_PATTERN.test(row.policyVersion)
    ) {
      return null;
    }
    return Object.freeze({
      status:
        row.resultingState === "needs_review" || row.resultingState === "appeal_pending"
          ? "needs_review"
          : row.resultingState,
      contributionId: row.contributionId,
      decisionId: row.decisionId,
      policyVersion: row.policyVersion,
      decidedAt: instant(row.decidedAt),
    });
  }

  async claim(
    input: Parameters<TrustDecisionDeliveryStore["claim"]>[0],
  ): Promise<ClaimedTrustContributionDecisionEvent[]> {
    return this.client.begin(async (transaction) => {
      await transaction`
        WITH expired AS (
          SELECT event_id FROM trust.contribution_decision_deliveries
          WHERE state = 'claimed' AND claim_expires_at <= ${input.now}
          ORDER BY claim_expires_at, event_id
          LIMIT ${input.limit} FOR UPDATE SKIP LOCKED
        )
        UPDATE trust.contribution_decision_deliveries AS delivery SET
          state = CASE WHEN delivery.attempt >= ${input.maxAttempts} THEN 'dead' ELSE 'pending' END,
          available_at = ${input.now}, claim_token = NULL, claimed_at = NULL,
          claim_expires_at = NULL, claimed_by = NULL, last_error_code = 'lease_expired',
          updated_at = ${input.now}
        FROM expired WHERE delivery.event_id = expired.event_id
      `;
      const candidates = await transaction<DeliveryCandidateRow[]>`
        SELECT delivery.event_id AS "eventId", event.event_type AS "eventType",
          event.subject, event.data, delivery.attempt
        FROM trust.contribution_decision_deliveries AS delivery
        JOIN trust.contribution_decision_outbox AS event ON event.id = delivery.event_id
        WHERE delivery.state = 'pending' AND delivery.available_at <= ${input.now}
          AND delivery.attempt < ${input.maxAttempts}
        ORDER BY delivery.available_at, delivery.created_at, delivery.event_id
        LIMIT ${input.limit} FOR UPDATE OF delivery SKIP LOCKED
      `;
      const claimed: ClaimedTrustContributionDecisionEvent[] = [];
      for (const candidate of candidates) {
        const claimToken = uuidv7();
        const [updated] = await transaction<{ attempt: number }[]>`
          UPDATE trust.contribution_decision_deliveries SET
            state = 'claimed', attempt = attempt + 1, claim_token = ${claimToken},
            claimed_at = ${input.now}, claim_expires_at = ${input.claimExpiresAt},
            claimed_by = ${input.workerId}, last_error_code = NULL, updated_at = ${input.now}
          WHERE event_id = ${candidate.eventId} AND state = 'pending'
          RETURNING attempt
        `;
        if (!updated) throw new TrustDecisionDeliveryClaimLostError();
        claimed.push(
          Object.freeze({
            event: event(candidate),
            attempt: updated.attempt,
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
    input: Parameters<TrustDecisionDeliveryStore["acknowledge"]>[0],
  ): Promise<void> {
    await this.client.begin(async (transaction) => {
      const [current] = await transaction<{ state: string; claimToken: string | null }[]>`
        SELECT state, claim_token AS "claimToken"
        FROM trust.contribution_decision_deliveries
        WHERE event_id = ${input.item.event.id} FOR UPDATE
      `;
      if (current?.state === "published" && current.claimToken === input.item.claimToken) return;
      const [updated] = await transaction<{ eventId: string }[]>`
        UPDATE trust.contribution_decision_deliveries SET
          state = 'published', claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
          last_error_code = NULL, acknowledged_at = ${input.now}, updated_at = ${input.now}
        WHERE event_id = ${input.item.event.id} AND state = 'claimed'
          AND claim_token = ${input.item.claimToken} AND claimed_by = ${input.workerId}
        RETURNING event_id AS "eventId"
      `;
      if (!updated) throw new TrustDecisionDeliveryClaimLostError();
    });
  }

  async retry(input: Parameters<TrustDecisionDeliveryStore["retry"]>[0]): Promise<void> {
    const [updated] = await this.client<{ eventId: string }[]>`
      UPDATE trust.contribution_decision_deliveries SET
        state = ${input.terminal ? "dead" : "pending"}, available_at = ${input.retryAt},
        claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.errorCode}, updated_at = ${input.now}
      WHERE event_id = ${input.item.event.id} AND state = 'claimed'
        AND claim_token = ${input.item.claimToken} AND claimed_by = ${input.workerId}
      RETURNING event_id AS "eventId"
    `;
    if (!updated) throw new TrustDecisionDeliveryClaimLostError();
  }
}
