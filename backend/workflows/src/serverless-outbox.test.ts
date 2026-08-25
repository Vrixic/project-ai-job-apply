import { eventTypes } from "@ai-job-apply/event-contracts";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  buildOutboxNudge,
  type DurableOutboxEvent,
  type ServerlessOutboxStore,
} from "@ai-job-apply/profile-service";
import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { AwsDurableExecutionClient, createStarterHandler } from "./serverless-outbox-lambda.js";
import {
  durableExecutionName,
  type DurableExecutionClient,
  ServerlessOutboxReconciler,
  ServerlessOutboxStarter,
} from "./serverless-outbox.js";

const logger = { info: vi.fn(), error: vi.fn() };

function durableEvent(id: string): DurableOutboxEvent {
  return {
    id,
    type: eventTypes.profilePreferencesUpdated,
    source: "urn:ai-job-apply:profile-service",
    subject: "preference-set/019b4e12-7ea3-7c36-9357-aea35ab542cb",
    dataSchema: "https://schemas.ai-job-apply.internal/events/profile.preferences.updated.v1.json",
    data: {
      preferenceSetId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
      version: 1,
      operationId: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
    },
    dispatchTarget: "lambda_durable",
    createdAt: new Date("2026-08-02T12:00:00.000Z"),
  };
}

function sqsEvent(records: Array<{ messageId: string; body: string }>): SQSEvent {
  return {
    Records: records.map((record) => ({
      ...record,
      receiptHandle: "receipt",
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: "0",
        SenderId: "sender",
        ApproximateFirstReceiveTimestamp: "0",
      },
      messageAttributes: {},
      md5OfBody: "synthetic",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:us-east-2:000000000000:synthetic",
      awsRegion: "us-east-2",
    })),
  };
}

describe("serverless outbox starter", () => {
  it("converges a crash after accepted start to one deterministic execution", async () => {
    const event = durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542ca");
    const acknowledged = { value: false };
    const executionNames = new Set<string>();
    const start = vi.fn(async ({ executionName }: { executionName: string }) => {
      executionNames.add(executionName);
      return { executionArn: "arn:aws:lambda:us-east-2:000000000000:function:synthetic:1" };
    });
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error("SyntheticAckCrash"))
      .mockImplementationOnce(async () => {
        acknowledged.value = true;
      });
    const store = {
      getDurableOutboxEvent: vi.fn(async () =>
        acknowledged.value
          ? {
              ...event,
              publishedAt: new Date(),
              durableExecutionName: durableExecutionName(event.id),
            }
          : event,
      ),
      acknowledgeDurableOutboxStart: acknowledge,
      recordDurableOutboxStartFailure: vi.fn(async () => undefined),
    } as unknown as ServerlessOutboxStore;
    const starter = new ServerlessOutboxStarter(store, { start } as DurableExecutionClient, logger);
    const nudge = buildOutboxNudge(event.id, event.type);

    await expect(starter.process(nudge)).rejects.toThrow("SyntheticAckCrash");
    await starter.process(nudge);
    await starter.process(nudge);

    expect(start).toHaveBeenCalledTimes(2);
    expect(executionNames).toEqual(new Set([durableExecutionName(event.id)]));
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("rejects altered messages before loading authoritative data", async () => {
    const store = {
      getDurableOutboxEvent: vi.fn(),
    } as unknown as ServerlessOutboxStore;
    const starter = new ServerlessOutboxStarter(
      store,
      { start: vi.fn() } as unknown as DurableExecutionClient,
      logger,
    );
    const nudge = buildOutboxNudge(
      "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      eventTypes.profilePreferencesUpdated,
    );

    await expect(
      starter.process({ ...nudge, eventType: eventTypes.profileReadinessCalculated }),
    ).rejects.toThrow("integrity");
    expect(store.getDurableOutboxEvent).not.toHaveBeenCalled();
  });

  it("reports only failed SQS records for bounded retry and DLQ handling", async () => {
    const process = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SyntheticFailure"));
    const handler = createStarterHandler({ process } as unknown as ServerlessOutboxStarter);

    const result = await handler(
      sqsEvent([
        { messageId: "accepted", body: JSON.stringify({}) },
        { messageId: "failed", body: JSON.stringify({}) },
      ]),
    );

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "failed" }] });
  });

  it("converges duplicate and reordered nudges to one execution per event", async () => {
    const events = [
      durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542ca"),
      durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542cd"),
    ];
    const acknowledged = new Map<string, string>();
    const executions = new Set<string>();
    const store = {
      getDurableOutboxEvent: vi.fn(async (eventId: string) => {
        const event = events.find((candidate) => candidate.id === eventId);
        const name = acknowledged.get(eventId);
        return event && name
          ? { ...event, publishedAt: new Date(), durableExecutionName: name }
          : (event ?? null);
      }),
      acknowledgeDurableOutboxStart: vi.fn(async (eventId: string, executionName: string) => {
        acknowledged.set(eventId, executionName);
      }),
      recordDurableOutboxStartFailure: vi.fn(async () => undefined),
    } as unknown as ServerlessOutboxStore;
    const starter = new ServerlessOutboxStarter(
      store,
      {
        start: vi.fn(async ({ executionName }) => {
          executions.add(executionName);
          return {};
        }),
      },
      logger,
    );
    const nudges = events.map((event) => buildOutboxNudge(event.id, event.type));

    for (const nudge of [nudges[1], nudges[0], nudges[1], nudges[0]]) {
      await starter.process(nudge);
    }

    expect(executions).toEqual(new Set(events.map((event) => durableExecutionName(event.id))));
    expect(store.acknowledgeDurableOutboxStart).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      type: eventTypes.profileDataExportRequested,
      subject: "candidate-data-export/019b4e12-7ea3-7c36-9357-aea35ab542cb",
      data: {
        dataExportId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
        operationId: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
        policyVersion: "policy-2026-08",
      },
    },
    {
      type: eventTypes.profileAccountDeletionConfirmed,
      subject: "account-deletion-request/019b4e12-7ea3-7c36-9357-aea35ab542cb",
      data: {
        deletionRequestId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
        operationId: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
        policyVersion: "policy-2026-08",
      },
    },
  ])("accepts the authoritative $type workflow event", async ({ type, subject, data }) => {
    const event = { ...durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542ca"), type, subject, data };
    const start = vi.fn(async () => ({}));
    const store = {
      getDurableOutboxEvent: vi.fn(async () => event),
      acknowledgeDurableOutboxStart: vi.fn(async () => undefined),
      recordDurableOutboxStartFailure: vi.fn(async () => undefined),
    } as unknown as ServerlessOutboxStore;
    const starter = new ServerlessOutboxStarter(store, { start }, logger);

    await starter.process(buildOutboxNudge(event.id, event.type));

    expect(start).toHaveBeenCalledWith({
      executionName: durableExecutionName(event.id),
      payload: expect.objectContaining({ eventType: type, data }),
    });
  });

  it("uses asynchronous invocation and the durable execution-name idempotency key", async () => {
    const send = vi.fn(async (_command: InvokeCommand) => ({
      StatusCode: 202,
      DurableExecutionArn:
        "arn:aws:lambda:us-east-2:000000000000:function:synthetic:1/durable-execution/synthetic/name",
    }));
    const client = new AwsDurableExecutionClient(
      "arn:aws:lambda:us-east-2:000000000000:function:synthetic:1",
      { send },
    );

    await client.start({
      executionName: "outbox-019b4e12-7ea3-7c36-9357-aea35ab542ca",
      payload: {
        schemaVersion: 1,
        eventId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        eventType: eventTypes.profilePreferencesUpdated,
        data: durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542ca").data,
      },
    });

    const input = send.mock.calls[0]?.[0]?.input;
    expect(input?.InvocationType).toBe("Event");
    expect(input?.DurableExecutionName).toBe("outbox-019b4e12-7ea3-7c36-9357-aea35ab542ca");
  });
});

describe("serverless outbox reconciler", () => {
  it("sends a bounded claimed page and isolates one send failure", async () => {
    const first = durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542ca");
    const second = durableEvent("019b4e12-7ea3-7c36-9357-aea35ab542cd");
    const store = {
      claimOutboxNudges: vi.fn(async () => [first, second]),
      recordOutboxNudgeSucceeded: vi.fn(async () => undefined),
      recordOutboxNudgeFailed: vi.fn(async () => undefined),
    } as unknown as ServerlessOutboxStore;
    const publish = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SyntheticSqsFailure"));
    const reconciler = new ServerlessOutboxReconciler(store, { publish }, logger, {
      batchSize: 25,
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    await expect(reconciler.reconcileOnce()).resolves.toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
    });
    expect(store.recordOutboxNudgeSucceeded).toHaveBeenCalledOnce();
    expect(store.recordOutboxNudgeFailed).toHaveBeenCalledOnce();
  });

  it("advances beyond a full oldest page", async () => {
    const pending = Array.from({ length: 26 }, (_, index) =>
      durableEvent(`018f47a5-7b70-7cc2-a999-${String(index).padStart(12, "0")}`),
    );
    const sent = new Set<string>();
    const store = {
      claimOutboxNudges: vi.fn(async (limit: number) =>
        pending.filter((event) => !sent.has(event.id)).slice(0, limit),
      ),
      recordOutboxNudgeSucceeded: vi.fn(async (eventId: string) => {
        sent.add(eventId);
      }),
      recordOutboxNudgeFailed: vi.fn(async () => undefined),
    } as unknown as ServerlessOutboxStore;
    const reconciler = new ServerlessOutboxReconciler(
      store,
      { publish: vi.fn(async () => undefined) },
      logger,
      { batchSize: 25 },
    );

    expect(await reconciler.reconcileOnce()).toMatchObject({ claimed: 25, sent: 25 });
    expect(await reconciler.reconcileOnce()).toMatchObject({ claimed: 1, sent: 1 });
    expect(sent.size).toBe(26);
  });
});
