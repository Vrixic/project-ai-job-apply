import { assertSourcePollAttempt, type IngestionSourceAdapter } from "./contract.js";

export const generatedSyntheticProviderFaultSourceId = "synthetic-d1-provider-fault-v1";
export const generatedSyntheticProviderFaultAdapterVersion = "synthetic-d1-provider-fault-v1";

/**
 * Generated-synthetic provider acquisition fixture for one bounded durable recovery exercise.
 * It performs no network request and emits no job, provider, employer, or candidate data.
 */
export class GeneratedSyntheticProviderFaultAdapter implements IngestionSourceAdapter {
  readonly sourceId = generatedSyntheticProviderFaultSourceId;
  readonly adapterVersion = generatedSyntheticProviderFaultAdapterVersion;

  async poll({ attempt }: Parameters<IngestionSourceAdapter["poll"]>[0]) {
    assertSourcePollAttempt(attempt);
    if (attempt === 1) {
      return {
        kind: "retry" as const,
        reason: "source_unavailable" as const,
        retryAfterMs: 1_000,
      };
    }
    return { kind: "success" as const, observations: [], withdrawals: [] };
  }
}
