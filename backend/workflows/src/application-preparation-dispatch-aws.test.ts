import { PreparationDispatchError } from "@ai-job-apply/applications-service";
import { describe, expect, it, vi } from "vitest";
import { PreparationDispatchPendingError } from "./application-preparation-dispatch.js";
import {
  createAwsPreparationExecutionStarter,
  type PreparationLambdaInvoker,
} from "./application-preparation-dispatch-aws.js";

const eventId = "019d04cf-1f80-7000-8000-00000000000a";
const functionArn = "arn:aws:lambda:us-east-2:123456789012:function:preparation:7";
const executionName = `preparation-${eventId}`;
const executionArn = `${functionArn}/durable-execution/${executionName}/synthetic-id`;
const input = {
  functionArn,
  executionName,
  payload: {
    schemaVersion: 1 as const,
    eventId,
    eventType: "application.packet-preparation.requested.v1" as const,
    data: { preparationId: "019d04cf-1f80-7000-8000-00000000000b" },
  },
};
describe("preparation Invoke boundary (offline SDK)", () => {
  it("invokes the exact numeric target asynchronously with bounded I/O and canonical bytes", async () => {
    const send = vi
      .fn<PreparationLambdaInvoker["send"]>()
      .mockResolvedValue({ StatusCode: 202, DurableExecutionArn: executionArn });
    const starter = createAwsPreparationExecutionStarter({ send });
    await expect(starter.start(input)).resolves.toEqual({ executionArn });
    const [command, options] = send.mock.calls[0] ?? [];
    expect(command?.input).toMatchObject({
      FunctionName: functionArn,
      InvocationType: "Event",
      DurableExecutionName: executionName,
    });
    expect(new TextDecoder().decode(command?.input.Payload as Uint8Array)).toBe(
      JSON.stringify(input.payload),
    );
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options?.abortSignal.aborted).toBe(false);
  });
  it("refuses invalid targets, names or value-bearing payloads without I/O", async () => {
    const send = vi.fn<PreparationLambdaInvoker["send"]>();
    const starter = createAwsPreparationExecutionStarter({ send });
    for (const value of [
      { ...input, functionArn: functionArn.replace(":7", ":latest") },
      { ...input, executionName: "foreign" },
      { ...input, payload: { ...input.payload, prompt: "synthetic" } },
    ])
      await expect(starter.start(value)).rejects.toThrow(PreparationDispatchError);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects unaccepted, missing or foreign execution receipts without exposing SDK details", async () => {
    const send = vi.fn<PreparationLambdaInvoker["send"]>();
    const starter = createAwsPreparationExecutionStarter({ send });
    for (const response of [
      { StatusCode: 200, DurableExecutionArn: executionArn },
      { StatusCode: 202 },
      { StatusCode: 202, DurableExecutionArn: executionArn.replace(":7/", ":8/") },
    ]) {
      send.mockResolvedValueOnce(response);
      await expect(starter.start(input)).rejects.toThrow(PreparationDispatchPendingError);
    }
    send.mockRejectedValueOnce(new Error("synthetic-private-sdk-detail"));
    await expect(starter.start(input)).rejects.toThrow("PreparationDispatchPending");
  });
});
