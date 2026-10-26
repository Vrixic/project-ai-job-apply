import { expect, it, vi } from "vitest";
import {
  createNativeResumeExecutionInspection,
  type NativeResumeExecutionReader,
} from "./native-resume-execution-inspection.js";

const id = "019d04cf-1f80-7000-8000-000000000001";
const arn = "arn:aws:lambda:us-east-2:123456789012:function:resume-durable:9";
const execution = `${arn}/durable-execution/resume-${id}/original`;
const row = {
  eventId: id,
  workflowArn: arn,
  executionArn: execution,
  dispatchResult: "started" as const,
};
const response = {
  ExecutionDataIncluded: false,
  DurableExecutionArn: execution,
  FunctionArn: arn,
  Version: "9",
  DurableExecutionName: `resume-${id}`,
  StartTimestamp: new Date(1000),
  EndTimestamp: new Date(2000),
  Status: "FAILED" as const,
};
function setup() {
  const send = vi.fn<NativeResumeExecutionReader["send"]>(async () => response);
  const executionReceipts = vi.fn(async () => [row]);
  const enabled = vi.fn(() => true);
  const run = createNativeResumeExecutionInspection({
    requests: { executionReceipts },
    client: { send },
    workflowArns: [arn],
    enabled,
  });
  return { send, executionReceipts, enabled, run };
}
it.each(["FAILED", "STOPPED", "TIMED_OUT", "SUCCEEDED", "RUNNING"] as const)(
  "checks original %s metadata without execution data",
  async (status) => {
    const x = setup();
    x.send.mockResolvedValue({
      ...response,
      Status: status,
      ...(status === "RUNNING" ? { EndTimestamp: undefined } : {}),
    } as typeof response);
    expect(await x.run(arn, null)).toEqual({
      schemaVersion: 1,
      results: [{ eventId: id, executionArn: execution, status }],
      nextAfterEventId: null,
    });
    expect(x.executionReceipts).toHaveBeenCalledWith(arn, null, 2);
    expect(x.send.mock.calls[0]?.[0].input).toEqual({
      DurableExecutionArn: execution,
      IncludeExecutionData: false,
    });
  },
);
it.each([
  { Version: "10" },
  { FunctionArn: `${arn.slice(0, -2)}:10` },
  { DurableExecutionArn: `${execution}-other` },
  { DurableExecutionName: "foreign" },
  { ExecutionDataIncluded: true },
  { InputPayload: "private" },
  { Result: "private" },
  { Error: { ErrorMessage: "private" } },
  { Status: "UNKNOWN" },
  { StartTimestamp: new Date(Number.NaN) },
  { EndTimestamp: new Date(0) },
  { Status: "RUNNING" },
])("withholds invalid response %j", async (changed) => {
  const x = setup();
  x.send.mockResolvedValue({ ...response, ...changed } as typeof response);
  expect((await x.run(arn, null)).results[0]?.status).toBe("unknown");
});
it("keeps missing acknowledgements and absent-source results distinct without AWS calls", async () => {
  const send = vi.fn();
  const next = "019d04cf-1f80-7000-8000-000000000002";
  const run = createNativeResumeExecutionInspection({
    workflowArns: [arn],
    enabled: () => true,
    client: { send },
    requests: {
      executionReceipts: async () => [
        { ...row, executionArn: null, dispatchResult: null },
        { ...row, eventId: next, executionArn: null, dispatchResult: "no_resume" },
      ],
    },
  });
  const result = await run(arn, null);
  expect(result.results.map((x) => x.status)).toEqual(["unknown", "no_resume"]);
  expect(result.nextAfterEventId).toBe(next);
  expect(send).not.toHaveBeenCalled();
});
it("rejects foreign receipts before AWS and hides provider errors", async () => {
  const x = setup();
  x.executionReceipts.mockResolvedValue([{ ...row, workflowArn: arn.replace(":9", ":10") }]);
  await expect(x.run(arn, null)).rejects.toThrow("NativeResumeExecutionInspectionUnavailable");
  expect(x.send).not.toHaveBeenCalled();
  x.executionReceipts.mockResolvedValue([row]);
  x.send.mockRejectedValue(Error("private token"));
  expect((await x.run(arn, null)).results[0]?.status).toBe("unknown");
});
it("refuses disabled, unretained and overlapping reads", async () => {
  const x = setup();
  x.enabled.mockReturnValue(false);
  await expect(x.run(arn, null)).rejects.toThrow();
  expect(x.executionReceipts).not.toHaveBeenCalled();
  x.enabled.mockReturnValue(true);
  await expect(x.run(arn.replace(":9", ":10"), null)).rejects.toThrow();
  x.send.mockImplementation(async () => {
    await expect(x.run(arn, null)).rejects.toThrow();
    x.enabled.mockReturnValue(false);
    return response;
  });
  await expect(x.run(arn, null)).rejects.toThrow();
});

it("retains eight original versions alongside the current version with two receipts per read", async () => {
  const workflowArns = Array.from({ length: 9 }, (_unused, index) =>
    arn.replace(":9", `:${index + 1}`),
  );
  const executionReceipts = vi.fn(async () => []);
  const send = vi.fn();
  const run = createNativeResumeExecutionInspection({
    workflowArns,
    requests: { executionReceipts },
    client: { send },
    enabled: () => true,
  });

  for (const workflowArn of workflowArns) {
    expect(await run(workflowArn, null)).toEqual({
      schemaVersion: 1,
      results: [],
      nextAfterEventId: null,
    });
    expect(executionReceipts).toHaveBeenLastCalledWith(workflowArn, null, 2);
  }
  await expect(run(arn.replace(":9", ":10"), null)).rejects.toThrow();
  expect(executionReceipts).toHaveBeenCalledTimes(9);
  expect(send).not.toHaveBeenCalled();
});

it.each<[string, string[]]>([
  ["empty", []],
  [
    "ten versions",
    Array.from({ length: 10 }, (_unused, index) => arn.replace(":9", `:${index + 1}`)),
  ],
  ["duplicate", [arn, arn]],
  ["foreign function", [arn, arn.replace("resume-durable", "foreign-durable")]],
  ["foreign account", [arn, arn.replace("123456789012", "999900001111")]],
  ["foreign region", [arn.replace("us-east-2", "us-west-2")]],
  ["alias", [arn.replace(":9", ":development")]],
])(
  "rejects a %s inspection allowlist before receipt or provider access",
  (_label, workflowArns) => {
    const executionReceipts = vi.fn();
    const send = vi.fn();
    expect(() =>
      createNativeResumeExecutionInspection({
        workflowArns,
        requests: { executionReceipts },
        client: { send },
        enabled: () => true,
      }),
    ).toThrow("NativeResumeExecutionInspectionUnavailable");
    expect(executionReceipts).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  },
);
