import type postgres from "postgres";
import {
  type ContributionProcessingPolicy,
  ContributionProcessingService,
  type ContributionTrustDecisionPort,
  type CurrentContributionConsentPort,
  type IndependentProviderVerificationPort,
  type SignedContributionCapabilityPolicyPort,
} from "./contribution-processing.js";
import {
  type ContributionProcessingEventDeliveryBatchMetrics,
  type ContributionProcessingEventDeliveryPolicy,
  ContributionProcessingEventDeliveryRunner,
  type ContributionProcessingEventPublisher,
} from "./contribution-processing-event-delivery.js";
import {
  type ContributionProcessingBatchResult,
  ContributionProcessingRunner,
  type ContributionProcessingRunnerPolicy,
} from "./contribution-processing-runner.js";
import {
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
} from "./persistence/contribution-processing.js";
import { PostgresContributionProcessingEventDeliveryStore } from "./persistence/contribution-processing-event-delivery.js";

export interface ContributionProcessingRuntimeBatchInput {
  processingWorkerId: string;
  processingLimit: number;
  delivery?: Readonly<{
    workerId: string;
    limit: number;
  }>;
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
  consent: CurrentContributionConsentPort;
  independentVerifier: IndependentProviderVerificationPort;
  trust: ContributionTrustDecisionPort;
  capability: SignedContributionCapabilityPolicyPort;
  eventDelivery?: Readonly<{
    policy: ContributionProcessingEventDeliveryPolicy;
    publisher: ContributionProcessingEventPublisher;
  }>;
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
    typeof configuration.capability?.load !== "function"
  ) {
    throw new TypeError("Every contribution-processing runtime authority must be injected");
  }
  if (
    (configuration.eventDelivery &&
      (!input.delivery || typeof configuration.eventDelivery.publisher?.publish !== "function")) ||
    (!configuration.eventDelivery && input.delivery)
  ) {
    throw new TypeError("Configured contribution-event delivery requires a real publisher");
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
      reconciler: new PostgresContributionPublicationReconciler(
        configuration.client,
        configuration.now,
      ),
      policy: configuration.processingPolicy,
      now: configuration.now,
    }),
    configuration.processingRunnerPolicy,
  );
  const processingMetrics = await processing.runBatch(
    input.processingWorkerId,
    now,
    input.processingLimit,
  );
  let deliveryMetrics: ContributionProcessingEventDeliveryBatchMetrics = zeroDelivery;
  if (configuration.eventDelivery) {
    const deliveryInput = input.delivery;
    if (!deliveryInput) throw new TypeError("Contribution-event delivery input is unavailable");
    const delivery = new ContributionProcessingEventDeliveryRunner(
      new PostgresContributionProcessingEventDeliveryStore(configuration.client),
      configuration.eventDelivery.publisher,
      configuration.eventDelivery.policy,
    );
    deliveryMetrics = await delivery.runBatch(deliveryInput.workerId, now, deliveryInput.limit);
  }
  return Object.freeze({
    enabled: true,
    processing: processingMetrics,
    delivery: deliveryMetrics,
  });
}
