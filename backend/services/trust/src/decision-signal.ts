import { createHash } from "node:crypto";
import {
  eventTypes,
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  validateEventData,
} from "@ai-job-apply/event-contracts";

export interface TrustContributionDecisionEvent {
  id: string;
  type: typeof eventTypes.trustContributionDecisionChanged;
  subject: string;
  data: { decisionId: string; contributionId: string };
}

export interface ClaimedTrustContributionDecisionEvent {
  event: TrustContributionDecisionEvent;
  attempt: number;
  claimToken: string;
  claimedBy: string;
  claimExpiresAt: Date;
}

export type TrustDecisionDeliveryErrorCode = "lease_expired" | "transport_unavailable";

export interface TrustDecisionDeliveryStore {
  claim(input: {
    workerId: string;
    now: Date;
    claimExpiresAt: Date;
    maxAttempts: number;
    limit: number;
  }): Promise<ClaimedTrustContributionDecisionEvent[]>;
  acknowledge(input: {
    item: ClaimedTrustContributionDecisionEvent;
    workerId: string;
    now: Date;
  }): Promise<void>;
  retry(input: {
    item: ClaimedTrustContributionDecisionEvent;
    workerId: string;
    now: Date;
    retryAt: Date;
    errorCode: TrustDecisionDeliveryErrorCode;
    terminal: boolean;
  }): Promise<void>;
}

export interface TrustDecisionEventPublisher {
  publish(
    input: Readonly<{ idempotencyKey: string; event: TrustContributionDecisionEvent }>,
  ): Promise<void>;
}

export interface IdentifierOnlyTrustDecisionNudgeTransport {
  publish(nudge: OutboxNudgeV1): Promise<void>;
}

/** Publishes only an integrity-bound event identity; consumers reload Trust-owned decision truth. */
export class IdentifierOnlyTrustDecisionEventPublisher implements TrustDecisionEventPublisher {
  constructor(private readonly transport: IdentifierOnlyTrustDecisionNudgeTransport) {}

  async publish(input: Parameters<TrustDecisionEventPublisher["publish"]>[0]): Promise<void> {
    if (
      input.idempotencyKey !== input.event.id ||
      input.event.type !== eventTypes.trustContributionDecisionChanged ||
      input.event.subject !== input.event.data.contributionId ||
      input.event.id !== input.event.data.decisionId ||
      !validateEventData(input.event.type, input.event.data)
    ) {
      throw new Error("The Trust decision event is not transport-safe");
    }
    const fields = {
      schemaVersion: 1 as const,
      eventId: input.event.id,
      eventType: input.event.type,
    };
    await this.transport.publish(
      Object.freeze({
        ...fields,
        integrity: Object.freeze({
          algorithm: "sha256" as const,
          digest: createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex"),
        }),
      }),
    );
  }
}

export interface TrustDecisionDeliveryPolicy {
  maxAttempts: number;
  claimLeaseMilliseconds: number;
  retryDelayMilliseconds: readonly number[];
}

export interface TrustDecisionDeliveryBatchMetrics {
  claimed: number;
  published: number;
  retried: number;
  dead: number;
}

const WORKER_PATTERN = /^[A-Za-z0-9:_-]{3,100}$/u;

function exactDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The Trust decision delivery clock is invalid");
  }
  return new Date(value.getTime());
}

function assertPolicy(policy: TrustDecisionDeliveryPolicy): void {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 5 ||
    !Number.isSafeInteger(policy.claimLeaseMilliseconds) ||
    policy.claimLeaseMilliseconds < 1_000 ||
    policy.claimLeaseMilliseconds > 15 * 60_000 ||
    policy.retryDelayMilliseconds.length !== policy.maxAttempts - 1 ||
    policy.retryDelayMilliseconds.some(
      (delay, index, values) =>
        !Number.isSafeInteger(delay) ||
        delay < 1_000 ||
        delay > 24 * 60 * 60_000 ||
        (index > 0 && delay < (values[index - 1] ?? 0)),
    )
  ) {
    throw new TypeError("An explicit bounded Trust decision delivery policy is required");
  }
}

/** Default-uncomposed runner; scheduling, transport, timing, and activation are injected. */
export class TrustDecisionDeliveryRunner {
  constructor(
    private readonly store: TrustDecisionDeliveryStore,
    private readonly publisher: TrustDecisionEventPublisher,
    private readonly policy: TrustDecisionDeliveryPolicy,
  ) {
    assertPolicy(policy);
  }

  async runBatch(
    workerId: string,
    nowInput: Date,
    limit: number,
  ): Promise<TrustDecisionDeliveryBatchMetrics> {
    if (!WORKER_PATTERN.test(workerId)) throw new TypeError("The Trust delivery worker is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new TypeError("The Trust decision claim limit must be between one and twenty-five");
    }
    const now = exactDate(nowInput);
    const items = await this.store.claim({
      workerId,
      now,
      claimExpiresAt: new Date(now.getTime() + this.policy.claimLeaseMilliseconds),
      maxAttempts: this.policy.maxAttempts,
      limit,
    });
    const metrics = { claimed: items.length, published: 0, retried: 0, dead: 0 };
    for (const item of items) {
      let delivered = false;
      try {
        await this.publisher.publish({ idempotencyKey: item.event.id, event: item.event });
        delivered = true;
      } catch {
        delivered = false;
      }
      if (delivered) {
        await this.store.acknowledge({ item, workerId, now });
        metrics.published += 1;
        continue;
      }
      const terminal = item.attempt >= this.policy.maxAttempts;
      const delay = this.policy.retryDelayMilliseconds[item.attempt - 1];
      const retryAt = terminal
        ? now
        : new Date(now.getTime() + (delay ?? this.policy.retryDelayMilliseconds.at(-1) ?? 0));
      await this.store.retry({
        item,
        workerId,
        now,
        retryAt,
        errorCode: "transport_unavailable",
        terminal,
      });
      if (terminal) metrics.dead += 1;
      else metrics.retried += 1;
    }
    return Object.freeze(metrics);
  }
}
