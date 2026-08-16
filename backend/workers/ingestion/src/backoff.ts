export interface RetryBackoffPolicy {
  baseDelayMs: number;
  maximumDelayMs: number;
}

export const defaultRetryBackoffPolicy: Readonly<RetryBackoffPolicy> = Object.freeze({
  baseDelayMs: 1_000,
  maximumDelayMs: 15 * 60 * 1_000,
});

function validatePolicy(policy: RetryBackoffPolicy): void {
  if (
    !Number.isSafeInteger(policy.baseDelayMs) ||
    !Number.isSafeInteger(policy.maximumDelayMs) ||
    policy.baseDelayMs < 1 ||
    policy.maximumDelayMs < policy.baseDelayMs ||
    policy.maximumDelayMs > 24 * 60 * 60 * 1_000
  ) {
    throw new Error("The retry backoff policy is invalid");
  }
}

export function retryDelayForAttempt(
  attempt: number,
  retryAfterMs?: number,
  policy: RetryBackoffPolicy = defaultRetryBackoffPolicy,
): number {
  validatePolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 32) {
    throw new Error("The retry attempt must be between 1 and 32");
  }
  if (retryAfterMs !== undefined && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)) {
    throw new Error("The source retry delay is invalid");
  }
  const exponentialDelay = Math.min(
    policy.maximumDelayMs,
    policy.baseDelayMs * 2 ** Math.min(attempt - 1, 30),
  );
  return Math.min(policy.maximumDelayMs, Math.max(exponentialDelay, retryAfterMs ?? 0));
}
