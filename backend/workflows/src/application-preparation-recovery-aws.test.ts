import {
  type PreparationDispatch,
  PreparationDispatchError,
} from "@ai-job-apply/applications-service";
import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { PreparationDispatchPendingError } from "./application-preparation-dispatch.js";
import {
  createAwsPreparationNudgePublisher,
  createAwsPreparationStatusReader,
  createPreparationSqsHandler,
  type PreparationLambdaReader,
  type PreparationSqsSender,
} from "./application-preparation-recovery-aws.js";

const eventId = "019d04cf-1f80-7000-8000-00000000000a";
const preparationId = "019d04cf-1f80-7000-8000-00000000000b";
const functionArn = "arn:aws:lambda:us-east-2:123456789012:function:preparation:7";
const executionName = `preparation-${eventId}`;
const executionArn = `${functionArn}/durable-execution/${executionName}/synthetic-id`;
const start = new Date("2026-10-02T12:00:00Z");
const end = new Date("2026-10-02T12:01:00Z");
const dispatch: PreparationDispatch = {
  eventId,
  preparationId,
  functionArn,
  executionName,
  executionArn,
  boundAt: start,
  startedAt: start,
  leaseId: null,
  leaseExpiresAt: null,
  terminalStatus: null,
};
const response = {
  ExecutionDataIncluded: false,
  DurableExecutionArn: executionArn,
  FunctionArn: functionArn,
  Version: "7",
  DurableExecutionName: executionName,
  StartTimestamp: start,
  EndTimestamp: end,
  Status: "FAILED" as const,
};
const queueUrl = "https://sqs.us-east-2.amazonaws.com/123456789012/preparation";
const queueArn = "arn:aws:sqs:us-east-2:123456789012:preparation";
const payload = {
  schemaVersion: 1 as const,
  eventId,
  eventType: "application.packet-preparation.requested.v1" as const,
  data: { preparationId },
};

describe("metadata-only preparation status reader", () => {
  it("explicitly excludes execution data and projects only fixed status/timestamps", async () => {
    const send = vi.fn<PreparationLambdaReader["send"]>().mockResolvedValue(response);
    const reader = createAwsPreparationStatusReader({ send });
    const result = await reader.read(dispatch);
    expect(result).toEqual({ status: "FAILED", startTimestamp: start, endTimestamp: end });
    expect(result.startTimestamp).not.toBe(start);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      DurableExecutionArn: executionArn,
      IncludeExecutionData: false,
    });
    expect(send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("supports running status without an end timestamp", async () => {
    const send = vi
      .fn<PreparationLambdaReader["send"]>()
      .mockResolvedValue({ ...response, Status: "RUNNING", EndTimestamp: undefined });
    expect(await createAwsPreparationStatusReader({ send }).read(dispatch)).toEqual({
      status: "RUNNING",
      startTimestamp: start,
    });
  });
  it("rejects missing/foreign execution bindings before I/O", async () => {
    const send = vi.fn<PreparationLambdaReader["send"]>();
    const reader = createAwsPreparationStatusReader({ send });
    for (const changed of [
      { executionArn: null },
      { executionName: "foreign" },
      { functionArn: functionArn.replace(":7", ":8") },
    ])
      await expect(reader.read({ ...dispatch, ...changed })).rejects.toThrow(
        PreparationDispatchError,
      );
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects foreign metadata, execution values, unexpected statuses and malformed times", async () => {
    const send = vi.fn<PreparationLambdaReader["send"]>();
    const reader = createAwsPreparationStatusReader({ send });
    const changes: Partial<
      typeof response & { InputPayload: string; Result: string; Error: { ErrorMessage: string } }
    >[] = [
      { ExecutionDataIncluded: true },
      { DurableExecutionArn: `${executionArn}-foreign` },
      { FunctionArn: functionArn.replace(/:7$/u, ":8") },
      { Version: "8" },
      { DurableExecutionName: "foreign" },
      { StartTimestamp: new Date(Number.NaN) },
      { EndTimestamp: new Date(start.getTime() - 1) },
      { InputPayload: "synthetic-private" },
      { Result: "synthetic-private" },
      { Error: { ErrorMessage: "synthetic-private" } },
    ];
    for (const change of changes) {
      send.mockResolvedValueOnce({ ...response, ...change });
      await expect(reader.read(dispatch)).rejects.toThrow(PreparationDispatchError);
    }
    send.mockResolvedValueOnce({ ...response, Status: "RUNNING" });
    await expect(reader.read(dispatch)).rejects.toThrow(PreparationDispatchError);
    send.mockResolvedValueOnce({ ...response, EndTimestamp: undefined });
    await expect(reader.read(dispatch)).rejects.toThrow(PreparationDispatchError);
  });
  it.each(["SUCCEEDED", "STOPPED", "TIMED_OUT"] as const)(
    "supports terminal %s metadata",
    async (Status) => {
      const send = vi
        .fn<PreparationLambdaReader["send"]>()
        .mockResolvedValue({ ...response, Status });
      expect(await createAwsPreparationStatusReader({ send }).read(dispatch)).toEqual({
        status: Status,
        startTimestamp: start,
        endTimestamp: end,
      });
    },
  );
  it("redacts SDK transport failures", async () => {
    const send = vi
      .fn<PreparationLambdaReader["send"]>()
      .mockRejectedValue(new Error("synthetic-private-sdk"));
    await expect(createAwsPreparationStatusReader({ send }).read(dispatch)).rejects.toThrow(
      PreparationDispatchPendingError,
    );
  });
});

describe("preparation SQS publisher/batch handler (offline)", () => {
  it("publishes canonical identifiers with bounded SDK I/O", async () => {
    const send = vi.fn<PreparationSqsSender["send"]>().mockResolvedValue({ MessageId: eventId });
    const publisher = createAwsPreparationNudgePublisher(queueUrl, { send });
    await publisher.publish({
      ...payload,
      eventId: eventId.toUpperCase(),
      data: { preparationId: preparationId.toUpperCase() },
    });
    expect(send.mock.calls[0]?.[0].input).toEqual({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
    });
    expect(send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("rejects arbitrary queue URLs/value-bearing payloads before I/O", async () => {
    const send = vi.fn<PreparationSqsSender["send"]>();
    for (const url of [
      "http://localhost:3000",
      `${queueUrl}?secret=synthetic`,
      "https://example.com/preparation",
    ])
      expect(() => createAwsPreparationNudgePublisher(url, { send })).toThrow(
        PreparationDispatchError,
      );
    const valueBearing = { ...payload, data: { ...payload.data, prompt: "synthetic" } };
    await expect(
      createAwsPreparationNudgePublisher(queueUrl, { send }).publish(valueBearing),
    ).rejects.toThrow(PreparationDispatchError);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not accept missing send receipts or expose transport errors", async () => {
    const send = vi
      .fn<PreparationSqsSender["send"]>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("synthetic-private-sdk"));
    const publisher = createAwsPreparationNudgePublisher(queueUrl, { send });
    await expect(publisher.publish(payload)).rejects.toThrow(PreparationDispatchPendingError);
    await expect(publisher.publish(payload)).rejects.toThrow("PreparationDispatchPending");
  });
  function batch(bodies: string[]): SQSEvent {
    return {
      Records: bodies.map((body, index) => ({
        messageId: `synthetic-${index}`,
        receiptHandle: "synthetic",
        body,
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "synthetic",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: "synthetic",
        eventSource: "aws:sqs",
        eventSourceARN: queueArn,
        awsRegion: "us-east-2",
      })),
    };
  }
  it("returns only failed message IDs, leaving successful records acknowledged", async () => {
    const starter = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("synthetic-private"));
    const handler = createPreparationSqsHandler(queueArn, starter);
    expect(
      await handler(batch([JSON.stringify(payload), JSON.stringify(payload), "{invalid"])),
    ).toEqual({
      batchItemFailures: [{ itemIdentifier: "synthetic-1" }, { itemIdentifier: "synthetic-2" }],
    });
    expect(starter).toHaveBeenCalledTimes(2);
  });
  it("refuses oversized or foreign-source records without calling the starter", async () => {
    const starter = vi.fn();
    const value = batch(["x".repeat(2_049), JSON.stringify(payload)]);
    const foreign = value.Records[1];
    if (!foreign) throw Error("Synthetic record missing");
    foreign.eventSourceARN = queueArn.replace("preparation", "foreign");
    expect(await createPreparationSqsHandler(queueArn, starter)(value)).toEqual({
      batchItemFailures: [{ itemIdentifier: "synthetic-0" }, { itemIdentifier: "synthetic-1" }],
    });
    expect(starter).not.toHaveBeenCalled();
  });
  it("rejects oversized or duplicate-ID batches before dispatch", async () => {
    const starter = vi.fn();
    const handler = createPreparationSqsHandler(queueArn, starter);
    await expect(handler(batch(Array(26).fill("{}")))).rejects.toThrow(PreparationDispatchError);
    const value = batch(["{}", "{}"]);
    if (value.Records[1]) value.Records[1].messageId = "synthetic-0";
    await expect(handler(value)).rejects.toThrow(PreparationDispatchError);
    expect(starter).not.toHaveBeenCalled();
  });
});
