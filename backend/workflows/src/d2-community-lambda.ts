import { createHash } from "node:crypto";
import {
  eventTypes,
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  validateOutboxNudge,
} from "@ai-job-apply/event-contracts";
import {
  type ContributionProcessingRuntimeBatchInput,
  type ContributionProcessingRuntimeBatchMetrics,
  type ContributionProcessingRuntimeConfiguration,
  type ContributionTrustDecisionSignalConsumer,
  runContributionProcessingRuntimeBatch,
} from "@ai-job-apply/jobs-service";
import type {
  TrustDecisionDeliveryBatchMetrics,
  TrustDecisionDeliveryRunner,
} from "@ai-job-apply/trust-service";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { d2CommunityEmf } from "./d2-community-observability.js";
import {
  createConfiguredD2CommunityLambdaConfiguration,
  createConfiguredD2TrustSignalLambdaConfiguration,
} from "./d2-community-runtime.js";

const MAXIMUM_NUDGE_BYTES = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const QUEUE_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):sqs:([a-z0-9-]+):([0-9]{12}):[A-Za-z0-9_-]{1,80}$/u;
const RULE_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):events:([a-z0-9-]+):([0-9]{12}):rule\/[A-Za-z0-9_.-]{1,64}$/u;

export interface D2CommunityAggregateLogger {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface D2CommunityLambdaBoundary {
  accountId: string;
  region: string;
  scheduleRuleArn: string;
  trustSignalQueueArn: string;
}

interface DisabledD2CommunityLambdaConfiguration {
  enabled?: false;
}

interface EnabledD2CommunityLambdaConfiguration {
  enabled: true;
  boundary: D2CommunityLambdaBoundary;
  jobs: Readonly<{
    input: ContributionProcessingRuntimeBatchInput;
    runtime: ContributionProcessingRuntimeConfiguration;
    runBatch?: typeof runContributionProcessingRuntimeBatch;
  }>;
  trustDelivery: Readonly<{
    runner: Pick<TrustDecisionDeliveryRunner, "runBatch">;
    workerId: string;
    limit: number;
  }>;
  trustSignal: Pick<ContributionTrustDecisionSignalConsumer, "consume">;
  now(): Date;
  logger: D2CommunityAggregateLogger;
}

export type D2CommunityLambdaConfiguration =
  | DisabledD2CommunityLambdaConfiguration
  | EnabledD2CommunityLambdaConfiguration;

export interface D2CommunityScheduledMetrics {
  enabled: boolean;
  jobs: ContributionProcessingRuntimeBatchMetrics;
  trustDelivery: TrustDecisionDeliveryBatchMetrics;
}

const zeroProcessing = Object.freeze({ claimed: 0, completed: 0, retried: 0, dead: 0, parked: 0 });
const zeroJobsDelivery = Object.freeze({ claimed: 0, published: 0, retried: 0, dead: 0 });
const zeroJobs = Object.freeze({
  enabled: false,
  processing: zeroProcessing,
  delivery: zeroJobsDelivery,
});
const zeroTrustDelivery = Object.freeze({ claimed: 0, published: 0, retried: 0, dead: 0 });

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertBoundary(boundary: D2CommunityLambdaBoundary): void {
  const queue = QUEUE_ARN_PATTERN.exec(boundary.trustSignalQueueArn);
  const rule = RULE_ARN_PATTERN.exec(boundary.scheduleRuleArn);
  if (
    !validSignalBoundary(boundary, queue) ||
    !rule ||
    rule[2] !== boundary.region ||
    rule[3] !== boundary.accountId
  ) {
    throw new TypeError("The D2 community Lambda boundary is invalid");
  }
}

function validSignalBoundary(
  boundary: Pick<D2CommunityLambdaBoundary, "accountId" | "region" | "trustSignalQueueArn">,
  queue = QUEUE_ARN_PATTERN.exec(boundary.trustSignalQueueArn),
): boolean {
  return Boolean(
    /^[0-9]{12}$/u.test(boundary.accountId) &&
      /^[a-z0-9-]{3,32}$/u.test(boundary.region) &&
      queue &&
      queue[2] === boundary.region &&
      queue[3] === boundary.accountId,
  );
}

function exactDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The D2 community Lambda clock is invalid");
  }
  return new Date(value.getTime());
}

function assertScheduledEvent(
  value: unknown,
  boundary: D2CommunityLambdaBoundary,
): asserts value is {
  schemaVersion: 1;
  action: "run-d2-community-batch";
  scheduleRuleArn: string;
} {
  if (
    !record(value) ||
    !exactKeys(value, ["schemaVersion", "action", "scheduleRuleArn"]) ||
    value.schemaVersion !== 1 ||
    value.action !== "run-d2-community-batch" ||
    value.scheduleRuleArn !== boundary.scheduleRuleArn
  ) {
    throw new Error("D2CommunityScheduleEventRejected");
  }
}

function parseTrustSignalRecord(
  item: SQSRecord,
  boundary: Pick<D2CommunityLambdaBoundary, "region" | "trustSignalQueueArn">,
): OutboxNudgeV1 {
  const region = QUEUE_ARN_PATTERN.exec(boundary.trustSignalQueueArn)?.[2];
  if (
    !item ||
    typeof item.messageId !== "string" ||
    !UUID_PATTERN.test(item.messageId) ||
    item.eventSource !== "aws:sqs" ||
    item.eventSourceARN !== boundary.trustSignalQueueArn ||
    item.awsRegion !== region ||
    typeof item.body !== "string" ||
    Buffer.byteLength(item.body, "utf8") < 1 ||
    Buffer.byteLength(item.body, "utf8") > MAXIMUM_NUDGE_BYTES ||
    typeof item.md5OfBody !== "string" ||
    createHash("md5").update(item.body, "utf8").digest("hex") !== item.md5OfBody ||
    Object.keys(item.messageAttributes ?? {}).length !== 0
  ) {
    throw new Error("D2CommunityTrustSignalEnvelopeRejected");
  }
  let value: unknown;
  try {
    value = JSON.parse(item.body);
  } catch {
    throw new Error("D2CommunityTrustSignalBodyRejected");
  }
  if (
    !validateOutboxNudge(value) ||
    value.eventType !== eventTypes.trustContributionDecisionChanged ||
    createHash("sha256").update(outboxNudgeIntegrityInput(value)).digest("hex") !==
      value.integrity.digest
  ) {
    throw new Error("D2CommunityTrustSignalBodyRejected");
  }
  return value;
}

function assertSqsEvent(value: unknown): asserts value is SQSEvent {
  if (
    !record(value) ||
    !exactKeys(value, ["Records"]) ||
    !Array.isArray(value.Records) ||
    value.Records.length < 1 ||
    value.Records.length > 10
  ) {
    throw new Error("D2CommunityTrustSignalBatchRejected");
  }
}

export type D2TrustSignalLambdaConfiguration =
  | { enabled?: false }
  | Readonly<{
      enabled: true;
      boundary: Pick<D2CommunityLambdaBoundary, "accountId" | "region" | "trustSignalQueueArn">;
      trustSignal: Pick<ContributionTrustDecisionSignalConsumer, "consume">;
      now(): Date;
      logger: D2CommunityAggregateLogger;
    }>;

export function createD2TrustSignalLambdaHandler(
  configuration: D2TrustSignalLambdaConfiguration = { enabled: false },
) {
  if (configuration.enabled !== true) {
    return async (): Promise<SQSBatchResponse> => {
      throw new Error("D2CommunityRuntimeDisabled");
    };
  }
  if (
    !validSignalBoundary(configuration.boundary) ||
    typeof configuration.now !== "function" ||
    typeof configuration.logger?.info !== "function" ||
    typeof configuration.trustSignal?.consume !== "function"
  ) {
    throw new TypeError("The D2 Trust-signal Lambda configuration is invalid");
  }
  return async (event: unknown): Promise<SQSBatchResponse> => {
    assertSqsEvent(event);
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    const totals = { handled: 0, copied: 0, requeued: 0 };
    for (const item of event.Records) {
      try {
        const nudge = parseTrustSignalRecord(item, configuration.boundary);
        const metrics = await configuration.trustSignal.consume(
          nudge,
          exactDate(configuration.now()),
        );
        totals.handled += metrics.handled;
        totals.copied += metrics.copied;
        totals.requeued += metrics.requeued;
      } catch {
        failures.push({ itemIdentifier: item.messageId });
      }
    }
    configuration.logger.info(
      d2CommunityEmf(
        {
          TrustSignalRecords: event.Records.length,
          TrustSignalHandled: totals.handled,
          TrustSignalCopied: totals.copied,
          TrustSignalRequeued: totals.requeued,
          TrustSignalFailed: failures.length,
        },
        exactDate(configuration.now()),
      ),
      "d2_community_trust_signal_batch",
    );
    return { batchItemFailures: failures };
  };
}

export function createD2CommunityLambdaHandlers(
  configuration: D2CommunityLambdaConfiguration = { enabled: false },
) {
  if (configuration.enabled !== true) {
    return Object.freeze({
      scheduled: async (_event?: unknown): Promise<D2CommunityScheduledMetrics> =>
        Object.freeze({ enabled: false, jobs: zeroJobs, trustDelivery: zeroTrustDelivery }),
      trustSignal: createD2TrustSignalLambdaHandler(),
    });
  }
  assertBoundary(configuration.boundary);
  if (
    typeof configuration.now !== "function" ||
    typeof configuration.logger?.info !== "function" ||
    typeof configuration.trustDelivery.runner?.runBatch !== "function" ||
    typeof configuration.trustSignal?.consume !== "function"
  ) {
    throw new TypeError("Every D2 community Lambda dependency must be injected");
  }
  const runJobsBatch = configuration.jobs.runBatch ?? runContributionProcessingRuntimeBatch;
  const trustSignal = createD2TrustSignalLambdaHandler({
    enabled: true,
    boundary: configuration.boundary,
    trustSignal: configuration.trustSignal,
    now: configuration.now,
    logger: configuration.logger,
  });

  return Object.freeze({
    scheduled: async (event: unknown): Promise<D2CommunityScheduledMetrics> => {
      assertScheduledEvent(event, configuration.boundary);
      const now = exactDate(configuration.now());
      let jobs: ContributionProcessingRuntimeBatchMetrics;
      let trustDelivery: TrustDecisionDeliveryBatchMetrics;
      try {
        [jobs, trustDelivery] = await Promise.all([
          runJobsBatch(configuration.jobs.input, configuration.jobs.runtime),
          configuration.trustDelivery.runner.runBatch(
            configuration.trustDelivery.workerId,
            now,
            configuration.trustDelivery.limit,
          ),
        ]);
      } catch (error) {
        configuration.logger.info(
          d2CommunityEmf({ ScheduledBatchFailed: 1 }, now),
          "d2_community_scheduled_batch_failed",
        );
        throw error;
      }
      configuration.logger.info(
        d2CommunityEmf(
          {
            JobsClaimed: jobs.processing.claimed,
            JobsCompleted: jobs.processing.completed,
            JobsRetried: jobs.processing.retried,
            JobsDead: jobs.processing.dead,
            JobsParked: jobs.processing.parked,
            JobsDeliveryClaimed: jobs.delivery.claimed,
            JobsDeliveryPublished: jobs.delivery.published,
            JobsDeliveryRetried: jobs.delivery.retried,
            JobsDeliveryDead: jobs.delivery.dead,
            TrustDeliveryClaimed: trustDelivery.claimed,
            TrustDeliveryPublished: trustDelivery.published,
            TrustDeliveryRetried: trustDelivery.retried,
            TrustDeliveryDead: trustDelivery.dead,
            ScheduledBatchSucceeded: 1,
          },
          now,
        ),
        "d2_community_scheduled_batch",
      );
      return Object.freeze({ enabled: true, jobs, trustDelivery });
    },
    trustSignal,
  });
}

type D2CommunityLambdaHandlers = ReturnType<typeof createD2CommunityLambdaHandlers>;

/** Import-safe cold-start composition. A failed initialization is retryable on a later invoke. */
export function createLazyD2CommunityLambdaHandlers(
  initialize: () => Promise<D2CommunityLambdaConfiguration>,
): D2CommunityLambdaHandlers {
  let configured: D2CommunityLambdaHandlers | undefined;
  let initialization: Promise<D2CommunityLambdaHandlers> | undefined;
  const get = async (): Promise<D2CommunityLambdaHandlers> => {
    if (configured) return configured;
    initialization ??= initialize()
      .then((configuration) => createD2CommunityLambdaHandlers(configuration))
      .catch((error) => {
        initialization = undefined;
        throw error;
      });
    configured = await initialization;
    return configured;
  };
  return Object.freeze({
    scheduled: async (event: unknown) => (await get()).scheduled(event),
    trustSignal: async (event: unknown) => (await get()).trustSignal(event),
  });
}

// Importing the artifact performs no database, queue, secret, or provider work. The initializer
// returns the inert configuration unless D2_COMMUNITY_RUNTIME_ENABLED is exactly true.
const runtimeHandlers = createLazyD2CommunityLambdaHandlers(() =>
  createConfiguredD2CommunityLambdaConfiguration(),
);
export const scheduled = runtimeHandlers.scheduled;

export function createLazyD2TrustSignalLambdaHandler(
  initialize: () => Promise<D2TrustSignalLambdaConfiguration>,
) {
  let configured: ReturnType<typeof createD2TrustSignalLambdaHandler> | undefined;
  let initialization: Promise<ReturnType<typeof createD2TrustSignalLambdaHandler>> | undefined;
  return async (event: unknown): Promise<SQSBatchResponse> => {
    if (!configured) {
      initialization ??= initialize()
        .then((configuration) => createD2TrustSignalLambdaHandler(configuration))
        .catch((error) => {
          initialization = undefined;
          throw error;
        });
      configured = await initialization;
    }
    return configured(event);
  };
}

export const trustSignal = createLazyD2TrustSignalLambdaHandler(() =>
  createConfiguredD2TrustSignalLambdaConfiguration(),
);
