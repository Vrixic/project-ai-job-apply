export type ContributionProcessingEvent =
  | {
      id: string;
      type: "job.normalized.v1";
      subject: string;
      data: { contributionId: string; normalizationId: string };
    }
  | {
      id: string;
      type: "job.verified.v1";
      subject: string;
      data: { jobId: string; sourceId: string; verificationId: string };
    };

export interface ClaimedContributionProcessingEvent {
  event: ContributionProcessingEvent;
  attempt: number;
  claimToken: string;
  claimedBy: string;
  claimExpiresAt: Date;
}

export type ContributionProcessingEventDeliveryErrorCode =
  | "lease_expired"
  | "transport_unavailable";

export interface ContributionProcessingEventDeliveryStore {
  claim(input: {
    workerId: string;
    now: Date;
    claimExpiresAt: Date;
    maxAttempts: number;
    limit: number;
  }): Promise<ClaimedContributionProcessingEvent[]>;
  acknowledge(input: {
    item: ClaimedContributionProcessingEvent;
    workerId: string;
    now: Date;
  }): Promise<void>;
  retry(input: {
    item: ClaimedContributionProcessingEvent;
    workerId: string;
    now: Date;
    retryAt: Date;
    errorCode: ContributionProcessingEventDeliveryErrorCode;
    terminal: boolean;
  }): Promise<void>;
}

export interface ContributionProcessingEventPublisher {
  publish(
    input: Readonly<{
      /** Stable across ambiguous delivery and worker restarts. */
      idempotencyKey: string;
      event: ContributionProcessingEvent;
    }>,
  ): Promise<void>;
}

export interface ContributionProcessingEventDeliveryPolicy {
  maxAttempts: number;
  claimLeaseMilliseconds: number;
  retryDelayMilliseconds: readonly number[];
}

export interface ContributionProcessingEventDeliveryBatchMetrics {
  claimed: number;
  published: number;
  retried: number;
  dead: number;
}

const WORKER_PATTERN = /^[A-Za-z0-9:_-]{3,100}$/u;

function exactDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The contribution-event delivery clock is invalid");
  }
  return new Date(value.getTime());
}

function assertPolicy(policy: ContributionProcessingEventDeliveryPolicy): void {
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
    throw new TypeError("An explicit bounded contribution-event delivery policy is required");
  }
}

/**
 * Delivers immutable identifier-only events. A crash after publish and before acknowledgement
 * republishes the same event identifier, so transports and consumers can converge idempotently.
 */
export class ContributionProcessingEventDeliveryRunner {
  constructor(
    private readonly store: ContributionProcessingEventDeliveryStore,
    private readonly publisher: ContributionProcessingEventPublisher,
    private readonly policy: ContributionProcessingEventDeliveryPolicy,
  ) {
    assertPolicy(policy);
  }

  async runBatch(
    workerId: string,
    nowInput: Date,
    limit: number,
  ): Promise<ContributionProcessingEventDeliveryBatchMetrics> {
    if (!WORKER_PATTERN.test(workerId)) throw new TypeError("The delivery worker is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new TypeError("The delivery claim limit must be between one and twenty-five");
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
      } else {
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
    }
    return Object.freeze(metrics);
  }
}
