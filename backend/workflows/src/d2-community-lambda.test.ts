import { createHash } from "node:crypto";
import { type OutboxNudgeV1, outboxNudgeIntegrityInput } from "@ai-job-apply/event-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createD2CommunityLambdaHandlers,
  createLazyD2CommunityLambdaHandlers,
  scheduled as defaultScheduled,
  trustSignal as defaultTrustSignal,
} from "./d2-community-lambda.js";

const now = new Date("2026-09-02T16:00:00.000Z");
const decisionId = "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9";
const contributionId = "019b4e12-7ea3-7c36-9357-aea35ab542ca";
const queueArn = "arn:aws:sqs:us-east-2:123456789012:development-d2-trust-decision-signals";
const ruleArn = "arn:aws:events:us-east-2:123456789012:rule/development-d2-community-batch";

function scheduledEvent(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    action: "run-d2-community-batch",
    scheduleRuleArn: ruleArn,
    ...extra,
  };
}

function nudge(): OutboxNudgeV1 {
  const fields = {
    schemaVersion: 1 as const,
    eventId: decisionId,
    eventType: "trust.contribution-decision.changed.v1" as const,
  };
  return {
    ...fields,
    integrity: {
      algorithm: "sha256",
      digest: createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex"),
    },
  };
}

function sqsRecord(messageId: string, body = JSON.stringify(nudge())) {
  return {
    messageId,
    receiptHandle: "synthetic-receipt",
    body,
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "1788364800000",
      SenderId: "synthetic",
      ApproximateFirstReceiveTimestamp: "1788364800000",
    },
    messageAttributes: {},
    md5OfBody: createHash("md5").update(body).digest("hex"),
    eventSource: "aws:sqs",
    eventSourceARN: queueArn,
    awsRegion: "us-east-2",
  };
}

function harness(
  overrides: {
    consume?: ReturnType<typeof vi.fn>;
    runJobsBatch?: ReturnType<typeof vi.fn>;
    runTrustDelivery?: ReturnType<typeof vi.fn>;
    providerRecovery?: { inspect: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  } = {},
) {
  const consume = overrides.consume ?? vi.fn(async () => ({ handled: 1, copied: 1, requeued: 1 }));
  const runJobsBatch =
    overrides.runJobsBatch ??
    vi.fn(async () => ({
      enabled: true,
      processing: { claimed: 2, completed: 1, retried: 0, dead: 0, parked: 1 },
      delivery: { claimed: 0, published: 0, retried: 0, dead: 0 },
    }));
  const runTrustDelivery =
    overrides.runTrustDelivery ??
    vi.fn(async () => ({ claimed: 1, published: 1, retried: 0, dead: 0 }));
  const logger = { info: vi.fn() };
  const handlers = createD2CommunityLambdaHandlers({
    enabled: true,
    boundary: {
      accountId: "123456789012",
      region: "us-east-2",
      scheduleRuleArn: ruleArn,
      trustSignalQueueArn: queueArn,
    },
    jobs: {
      input: { processingWorkerId: "d2:processing", processingLimit: 5 },
      runtime: { enabled: false },
      runBatch: runJobsBatch as never,
    },
    trustDelivery: {
      runner: { runBatch: runTrustDelivery as never },
      workerId: "d2:trust-delivery",
      limit: 5,
    },
    trustSignal: { consume: consume as never },
    ...(overrides.providerRecovery
      ? { providerRecovery: overrides.providerRecovery as never }
      : {}),
    now: () => new Date(now),
    logger,
  });
  return { handlers, consume, runJobsBatch, runTrustDelivery, logger };
}

describe("D2 community Lambda", () => {
  it("inspects and retries only exact rule-bound maintenance commands without running a batch", async () => {
    const providerRecovery = {
      inspect: vi.fn(async () => ({ inspected: 1, fingerprint: "a".repeat(64) })),
      retry: vi.fn(async () => ({ requeued: 1 })),
    };
    const { handlers, runJobsBatch, runTrustDelivery, logger } = harness({ providerRecovery });
    await expect(
      handlers.scheduled(scheduledEvent({ action: "inspect-provider-verification" })),
    ).resolves.toMatchObject({ inspected: 1 });
    await expect(
      handlers.scheduled(
        scheduledEvent({
          action: "retry-provider-verification",
          expectedFingerprint: "a".repeat(64),
          confirmation: "RETRY-REVIEWED-PROVIDER-VERIFICATION",
        }),
      ),
    ).resolves.toEqual({ requeued: 1 });
    expect(providerRecovery.retry).toHaveBeenCalledWith("a".repeat(64), now);
    expect(runJobsBatch).not.toHaveBeenCalled();
    expect(runTrustDelivery).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([
    { action: "inspect-provider-verification", unexpected: true },
    { action: "inspect-provider-verification", scheduleRuleArn: "wrong" },
    { action: "retry-provider-verification", expectedFingerprint: "a".repeat(64) },
    {
      action: "retry-provider-verification",
      expectedFingerprint: "invalid",
      confirmation: "RETRY-REVIEWED-PROVIDER-VERIFICATION",
    },
  ])("rejects malformed maintenance without store access", async (event) => {
    const providerRecovery = { inspect: vi.fn(), retry: vi.fn() };
    const { handlers } = harness({ providerRecovery });
    await expect(handlers.scheduled(scheduledEvent(event))).rejects.toThrow(
      "D2CommunityRecoveryCommandRejected",
    );
    expect(providerRecovery.inspect).not.toHaveBeenCalled();
    expect(providerRecovery.retry).not.toHaveBeenCalled();
  });

  it("scrubs recovery driver failures and rejects missing recovery composition", async () => {
    await expect(
      harness().handlers.scheduled(scheduledEvent({ action: "inspect-provider-verification" })),
    ).rejects.toThrow("D2CommunityRecoveryCommandRejected");
    const providerRecovery = {
      inspect: vi.fn(async () => {
        throw new Error("SYNTHETIC_SENSITIVE_DRIVER_PARAMETERS");
      }),
      retry: vi.fn(),
    };
    await expect(
      harness({ providerRecovery }).handlers.scheduled(
        scheduledEvent({ action: "inspect-provider-verification" }),
      ),
    ).rejects.toThrow("D2CommunityRecoveryUnavailableOrSnapshotChanged");
  });
  it("is import-safe and default-off", async () => {
    await expect(defaultScheduled(undefined)).resolves.toEqual({
      enabled: false,
      jobs: {
        enabled: false,
        processing: { claimed: 0, completed: 0, retried: 0, dead: 0, parked: 0 },
        delivery: { claimed: 0, published: 0, retried: 0, dead: 0 },
      },
      trustDelivery: { claimed: 0, published: 0, retried: 0, dead: 0 },
    });
    await expect(defaultTrustSignal({ Records: [] } as never)).rejects.toThrow(
      "D2CommunityRuntimeDisabled",
    );
  });

  it("lazily composes once and allows a later invoke to retry failed initialization", async () => {
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error("configuration unavailable"))
      .mockResolvedValue({ enabled: false });
    const lazy = createLazyD2CommunityLambdaHandlers(initialize);
    await expect(lazy.scheduled(undefined)).rejects.toThrow("configuration unavailable");
    await expect(lazy.scheduled(undefined)).resolves.toMatchObject({ enabled: false });
    await expect(lazy.scheduled(undefined)).resolves.toMatchObject({ enabled: false });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("requires the exact scheduled event and returns aggregate metrics", async () => {
    const { handlers, runJobsBatch, runTrustDelivery, logger } = harness();
    await expect(handlers.scheduled(scheduledEvent())).resolves.toMatchObject({
      enabled: true,
      jobs: { processing: { claimed: 2, completed: 1, parked: 1 } },
      trustDelivery: { claimed: 1, published: 1 },
    });
    expect(runJobsBatch).toHaveBeenCalledOnce();
    expect(runTrustDelivery).toHaveBeenCalledWith("d2:trust-delivery", now, 5);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ JobsClaimed: 2, TrustDeliveryPublished: 1 }),
      "d2_community_scheduled_batch",
    );
    const scheduledLog = logger.info.mock.calls[0]?.[0];
    expect(scheduledLog).toMatchObject({
      _aws: { CloudWatchMetrics: [{ Namespace: "AIJobApply/D2Community", Dimensions: [] }] },
    });
    await expect(handlers.scheduled(scheduledEvent({ unexpected: true }))).rejects.toThrow(
      "D2CommunityScheduleEventRejected",
    );
    await expect(
      handlers.scheduled(scheduledEvent({ scheduleRuleArn: `${ruleArn}-other` })),
    ).rejects.toThrow("D2CommunityScheduleEventRejected");
  });

  it("returns partial batch failures while exact valid records remain idempotently retryable", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce({ handled: 1, copied: 1, requeued: 1 })
      .mockRejectedValueOnce(new Error("cross-owner"))
      .mockResolvedValueOnce({ handled: 1, copied: 0, requeued: 0 });
    const { handlers, logger } = harness({ consume });
    const acceptedId = "019b4e12-7ea3-7c36-9357-aea35ab542cd";
    const failedId = "019b4e12-7ea3-7c36-9357-aea35ab542ce";
    await expect(
      handlers.trustSignal({
        Records: [sqsRecord(acceptedId), sqsRecord(failedId)],
      }),
    ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: failedId }] });
    expect(consume).toHaveBeenCalledTimes(2);

    await expect(handlers.trustSignal({ Records: [sqsRecord(failedId)] })).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(consume).toHaveBeenCalledTimes(3);
    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toContain(decisionId);
    expect(serializedLogs).not.toContain(contributionId);
    expect(serializedLogs).not.toContain(acceptedId);
    expect(serializedLogs).not.toContain(failedId);
  });

  it("rejects oversized, tampered, or wrong-queue nudges before authority reads", async () => {
    const { handlers, consume } = harness();
    const oversized = sqsRecord("019b4e12-7ea3-7c36-9357-aea35ab542cf", "x".repeat(4_097));
    const tamperedBody = JSON.stringify({
      ...nudge(),
      integrity: { algorithm: "sha256", digest: "0".repeat(64) },
    });
    const tampered = sqsRecord("019b4e12-7ea3-7c36-9357-aea35ab542d0", tamperedBody);
    const wrongQueue = {
      ...sqsRecord("019b4e12-7ea3-7c36-9357-aea35ab542d1"),
      eventSourceARN: "arn:aws:sqs:us-east-2:123456789012:profile-outbox",
    };
    await expect(
      handlers.trustSignal({ Records: [oversized, tampered, wrongQueue] }),
    ).resolves.toEqual({
      batchItemFailures: [
        { itemIdentifier: oversized.messageId },
        { itemIdentifier: tampered.messageId },
        { itemIdentifier: wrongQueue.messageId },
      ],
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("emits an aggregate-only health metric when a scheduled dependency fails", async () => {
    const { handlers, logger } = harness({
      runJobsBatch: vi.fn(async () => {
        throw new Error("sensitive-provider-detail");
      }),
    });
    await expect(handlers.scheduled(scheduledEvent())).rejects.toThrow("sensitive-provider-detail");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ ScheduledBatchFailed: 1 }),
      "d2_community_scheduled_batch_failed",
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sensitive-provider-detail");
  });
});
