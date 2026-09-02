import type {
  ContributionProcessingOutcome,
  ContributionProcessingService,
} from "./contribution-processing.js";

export type ContributionProcessingRetryCode =
  | "capability_dependency"
  | "capability_disabled"
  | "consent_dependency"
  | "processing_dependency"
  | "provider_pending"
  | "trust_pending";
export type ContributionProcessingParkReason =
  | "capability_disabled"
  | "provider_pending"
  | "trust_pending";

export interface ContributionProcessingQueueItem {
  id: string;
  contributionId: string;
  state: "claimed";
  attempt: number;
  claimedBy: string;
  claimExpiresAt: Date;
}

export interface ContributionProcessingQueueStore {
  claim(input: {
    workerId: string;
    now: Date;
    claimExpiresAt: Date;
    limit: number;
  }): Promise<ContributionProcessingQueueItem[]>;
  complete(input: {
    item: ContributionProcessingQueueItem;
    workerId: string;
    now: Date;
    outcome: Exclude<
      ContributionProcessingOutcome,
      | "awaiting_capability_dependency"
      | "awaiting_consent_dependency"
      | "awaiting_independent_verification"
      | "awaiting_trust"
    >;
  }): Promise<void>;
  retry(input: {
    item: ContributionProcessingQueueItem;
    workerId: string;
    now: Date;
    retryAt: Date;
    errorCode: ContributionProcessingRetryCode;
    terminal: boolean;
  }): Promise<void>;
  park(input: {
    item: ContributionProcessingQueueItem;
    workerId: string;
    now: Date;
    reason: ContributionProcessingParkReason;
  }): Promise<void>;
  requeue(input: {
    contributionId: string;
    now: Date;
    signal:
      | "capability_policy"
      | "independent_verification"
      | "trust_decision"
      | "withdrawal"
      | "takedown";
  }): Promise<boolean>;
}

export interface ContributionProcessingRunnerPolicy {
  maxAttempts: number;
  claimLeaseMilliseconds: number;
  retryDelayMilliseconds: readonly number[];
}

export interface ContributionProcessingBatchResult {
  claimed: number;
  completed: number;
  retried: number;
  dead: number;
  parked: number;
}

const WORKER_PATTERN = /^[A-Za-z0-9:_-]{3,100}$/u;

function assertPolicy(policy: ContributionProcessingRunnerPolicy): void {
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
    throw new TypeError("An explicit bounded contribution-processing runner policy is required");
  }
}

function exactDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The contribution-processing runner clock is invalid");
  }
  return new Date(value.getTime());
}

function retryCode(outcome: ContributionProcessingOutcome): ContributionProcessingRetryCode | null {
  switch (outcome) {
    case "capability_disabled":
      return "capability_disabled";
    case "awaiting_capability_dependency":
      return "capability_dependency";
    case "awaiting_consent_dependency":
      return "consent_dependency";
    case "awaiting_independent_verification":
      return "provider_pending";
    case "awaiting_trust":
      return "trust_pending";
    default:
      return null;
  }
}

/** Bounded lease/retry runner; scheduling and all timing remain deployment-injected. */
export class ContributionProcessingRunner {
  constructor(
    private readonly store: ContributionProcessingQueueStore,
    private readonly processing: Pick<ContributionProcessingService, "process">,
    private readonly policy: ContributionProcessingRunnerPolicy,
  ) {
    assertPolicy(policy);
  }

  async runBatch(
    workerId: string,
    nowInput: Date,
    limit: number,
  ): Promise<ContributionProcessingBatchResult> {
    if (!WORKER_PATTERN.test(workerId)) throw new TypeError("The processing worker is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new TypeError("The processing claim limit must be between one and twenty-five");
    }
    const now = exactDate(nowInput);
    const claimed = await this.store.claim({
      workerId,
      now,
      claimExpiresAt: new Date(now.getTime() + this.policy.claimLeaseMilliseconds),
      limit,
    });
    const result = { claimed: claimed.length, completed: 0, retried: 0, dead: 0, parked: 0 };
    for (const item of claimed) {
      let outcome: ContributionProcessingOutcome | null = null;
      let code: ContributionProcessingRetryCode | null = null;
      try {
        outcome = await this.processing.process(item.contributionId);
        code = retryCode(outcome);
      } catch {
        code = "processing_dependency";
      }
      if (outcome && !code) {
        await this.store.complete({
          item,
          workerId,
          now,
          outcome: outcome as Exclude<
            ContributionProcessingOutcome,
            | "awaiting_capability_dependency"
            | "awaiting_consent_dependency"
            | "awaiting_independent_verification"
            | "awaiting_trust"
          >,
        });
        result.completed += 1;
        continue;
      }
      if (
        code === "capability_disabled" ||
        code === "provider_pending" ||
        code === "trust_pending"
      ) {
        await this.store.park({ item, workerId, now, reason: code });
        result.parked += 1;
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
        errorCode: code ?? "processing_dependency",
        terminal,
      });
      if (terminal) result.dead += 1;
      else result.retried += 1;
    }
    return Object.freeze(result);
  }
}
