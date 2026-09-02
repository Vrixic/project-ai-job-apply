import type postgres from "postgres";
import {
  ContributionProcessingEventDeliveryRunner,
  type ContributionProcessingEventDeliveryBatchMetrics,
  type ContributionProcessingEventDeliveryPolicy,
  type ContributionProcessingEventPublisher,
} from "./contribution-processing-event-delivery.js";
import {
  ContributionProcessingRunner,
  type ContributionProcessingBatchResult,
  type ContributionProcessingRunnerPolicy,
} from "./contribution-processing-runner.js";
import {
  type ContributionProcessingPolicy,
  ContributionProcessingService,
  type ContributionPublicationReconciler,
  type ContributionTrustDecisionPort,
  type CurrentContributionConsentPort,
  type IndependentProviderVerificationPort,
  type SignedContributionCapabilityPolicyPort,
} from "./contribution-processing.js";
import { PostgresContributionProcessingEventDeliveryStore } from "./persistence/contribution-processing-event-delivery.js";
import {
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
} from "./persistence/contribution-processing.js";

export interface ContributionProcessingRuntimeBatchInput {
  processingWorkerId: string;
  processingLimit: number;
  deliveryWorkerId: string;
  deliveryLimit: number;
}

export interface ContributionProcessingRuntimeBatchMetrics {
  enabled: boolean;
  processing: ContributionProcessingBatchResult;
  delivery: ContributionProcessingEventDeliveryBatchMetrics;
}

interface DisabledContributionProcessingRuntime {
  enabled?: false;
}

interface EnabledContributionProcessingRuntime {
  enabled: true;
  client: postgres.Sql;
  processingPolicy: ContributionProcessingPolicy;
  processingRunnerPolicy: ContributionProcessingRunnerPolicy;
  deliveryPolicy: ContributionProcessingEventDeliveryPolicy;
  consent: CurrentContributionConsentPort;
  independentVerifier: IndependentProviderVerificationPort;
  trust: ContributionTrustDecisionPort;
  capability: SignedContributionCapabilityPolicyPort;
  reconciler: ContributionPublicationReconciler;
  publisher: ContributionProcessingEventPublisher;
  now: () => Date;
}

export type ContributionProcessingRuntimeConfiguration =
  | DisabledContributionProcessingRuntime
  | EnabledContributionProcessingRuntime;

const zeroProcessing = Object.freeze({ claimed: 0, completed: 0, retried: 0, dead: 0, parked: 0 });
const zeroDelivery = Object.freeze({ claimed: 0, published: 0, retried: 0, dead: 0 });

/**
 * Explicit batch entrypoint only. It provides no scheduler, provider adapter, Trust authority,
 * capability policy, publisher, clock, timing, or activation default.
 */
export async function runContributionProcessingRuntimeBatch(
  input: Readonly<ContributionProcessingRuntimeBatchInput>,
  configuration: ContributionProcessingRuntimeConfiguration = { enabled: false },
): Promise<ContributionProcessingRuntimeBatchMetrics> {
  if (configuration.enabled !== true) {
    return Object.freeze({ enabled: false, processing: zeroProcessing, delivery: zeroDelivery });
  }
  if (
    typeof configuration.client !== "function" ||
    typeof configuration.now !== "function" ||
    typeof configuration.consent?.verifyCurrent !== "function" ||
    typeof configuration.independentVerifier?.verify !== "function" ||
    typeof configuration.trust?.evaluate !== "function" ||
    typeof configuration.capability?.load !== "function" ||
    typeof configuration.reconciler?.publish !== "function" ||
    typeof configuration.reconciler?.remove !== "function" ||
    typeof configuration.publisher?.publish !== "function"
  ) {
    throw new TypeError("Every contribution-processing runtime authority must be injected");
  }
  const now = configuration.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("The contribution-processing runtime clock is invalid");
  }
  const processing = new ContributionProcessingRunner(
    new PostgresContributionProcessingQueueStore(configuration.client),
    new ContributionProcessingService({
      store: new PostgresContributionProcessingStore(configuration.client),
      consent: configuration.consent,
      independentVerifier: configuration.independentVerifier,
      trust: configuration.trust,
      capability: configuration.capability,
      reconciler: configuration.reconciler,
      policy: configuration.processingPolicy,
      now: configuration.now,
    }),
    configuration.processingRunnerPolicy,
  );
  const delivery = new ContributionProcessingEventDeliveryRunner(
    new PostgresContributionProcessingEventDeliveryStore(configuration.client),
    configuration.publisher,
    configuration.deliveryPolicy,
  );
  const processingMetrics = await processing.runBatch(
    input.processingWorkerId,
    now,
    input.processingLimit,
  );
  const deliveryMetrics = await delivery.runBatch(input.deliveryWorkerId, now, input.deliveryLimit);
  return Object.freeze({
    enabled: true,
    processing: processingMetrics,
    delivery: deliveryMetrics,
  });
}
