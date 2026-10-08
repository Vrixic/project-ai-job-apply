import type { NativeResumeExecutionObservationClaim } from "@ai-job-apply/applications-service/native-resume-request-store";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { expect, it, vi } from "vitest";
import type { NativeResumeExecutionReader } from "./native-resume-execution-inspection.js";
import { createNativeResumeExecutionReconciliation } from "./native-resume-execution-reconciliation.js";

const id = "019d04cf-1f80-7000-8000-000000000001";
const arn = "arn:aws:lambda:us-east-2:123456789012:function:resume-durable:9";
const execution = `${arn}/durable-execution/resume-${id}/original`;
function fixture() {
  const claim: NativeResumeExecutionObservationClaim = {
    eventId: id,
    workflowArn: arn,
    executionArn: execution,
    inspectionToken: id,
    terminalStatus: null,
  };
  const requests = {
    claimExecutionObservations: vi.fn(async () => [claim]),
    recordExecutionObservation: vi.fn(async () => true),
  };
  const send = vi.fn<NativeResumeExecutionReader["send"]>(async () => ({
    ExecutionDataIncluded: false,
    DurableExecutionArn: execution,
    FunctionArn: arn.slice(0, -2),
    Version: "9",
    DurableExecutionName: `resume-${id}`,
    StartTimestamp: new Date(1000),
    EndTimestamp: new Date(2000),
    Status: "FAILED",
  }));
  const enqueue = vi.fn(async () => ({ MessageId: "12345678-1234-4234-8234-123456789012" }));
  const enabled = vi.fn(() => true);
  const run = createNativeResumeExecutionReconciliation({
    requests,
    client: { send },
    workflowArns: [arn],
    queueArn: "arn:aws:sqs:us-east-2:123456789012:original-failures",
    enabled,
    testQueue: { send: enqueue } as unknown as Pick<SQSClient, "send">,
  });
  return { claim, requests, send, enqueue, enabled, run };
}
it("records positive original terminal metadata before notice and marks delivery only after ACK", async () => {
  const x = fixture();
  x.enqueue.mockImplementation(async () => {
    expect(x.requests.recordExecutionObservation).toHaveBeenCalledExactlyOnceWith(
      x.claim,
      "FAILED",
    );
    return { MessageId: "12345678-1234-4234-8234-123456789012" };
  });
  expect(await x.run()).toEqual({ schemaVersion: 1, inspected: 1, notified: 1, unresolved: 0 });
  expect(x.requests.recordExecutionObservation).toHaveBeenLastCalledWith(x.claim, "FAILED", true);
  const input = (
    x.enqueue.mock.calls[0] as unknown as [{ input: { QueueUrl: string; MessageBody: string } }]
  )[0].input;
  expect(input.QueueUrl).toBe("https://sqs.us-east-2.amazonaws.com/123456789012/original-failures");
  expect(JSON.parse(input.MessageBody)).toEqual({
    schemaVersion: 1,
    kind: "native_resume_terminal",
    executionArn: execution,
    functionArn: arn.slice(0, -2),
    status: "FAILED",
  });
});
it("retains a positive terminal observation when queue acknowledgement is lost", async () => {
  const x = fixture();
  x.enqueue.mockRejectedValue(Error("synthetic lost ACK"));
  await expect(x.run()).rejects.toThrow();
  expect(x.requests.recordExecutionObservation).toHaveBeenCalledExactlyOnceWith(x.claim, "FAILED");
  x.claim.terminalStatus = "FAILED";
  x.enqueue.mockResolvedValue({ MessageId: "12345678-1234-4234-8234-123456789012" });
  x.send.mockClear();
  expect((await x.run()).notified).toBe(1);
  expect(x.send).not.toHaveBeenCalled();
});
it("never notifies on unknown remote identity or success", async () => {
  const x = fixture();
  x.send.mockResolvedValue({ Status: "FAILED", ExecutionDataIncluded: true });
  expect((await x.run()).unresolved).toBe(1);
  expect(x.enqueue).not.toHaveBeenCalled();
  x.claim.terminalStatus = "SUCCEEDED";
  expect((await x.run()).notified).toBe(0);
  expect(x.enqueue).not.toHaveBeenCalled();
});
it("fences stale claims and refuses malformed queue ACKs", async () => {
  const x = fixture();
  x.requests.recordExecutionObservation.mockResolvedValue(false);
  expect((await x.run()).unresolved).toBe(1);
  expect(x.enqueue).not.toHaveBeenCalled();
  x.requests.recordExecutionObservation.mockResolvedValue(true);
  x.enqueue.mockResolvedValue({ MessageId: "invalid" });
  await expect(x.run()).rejects.toThrow();
  expect(x.requests.recordExecutionObservation).not.toHaveBeenCalledWith(x.claim, "FAILED", true);
});
it("stops before delivery when its gate is withdrawn", async () => {
  const x = fixture();
  x.requests.recordExecutionObservation.mockImplementation(async () => {
    x.enabled.mockReturnValue(false);
    return true;
  });
  await expect(x.run()).rejects.toThrow();
  expect(x.enqueue).not.toHaveBeenCalled();
});
