export function isIsolationOperationEligible(
  state: unknown,
  allowQueuedOperation: boolean,
): boolean {
  return state === "succeeded" || (allowQueuedOperation && state === "queued");
}
