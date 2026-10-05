import { DescribeTasksCommand, ECSClient, StopTaskCommand } from "@aws-sdk/client-ecs";
import { expect, it, vi } from "vitest";
import { createNativeTaskRetirement, type NativeTaskAllocation } from "./native-task-retirement.js";

const allocation: NativeTaskAllocation = {
  allocationId: "019d04cf-1f80-7000-8000-000000000101",
  ownerUserId: "019d04cf-1f80-7000-8000-000000000102",
  applicationId: "019d04cf-1f80-7000-8000-000000000103",
  generationId: "019d04cf-1f80-7000-8000-000000000104",
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
  taskArn:
    "arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/12345678901234567890123456789012",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
  containerName: "materials",
};
const stoppedTask = () => ({
  taskArn: allocation.taskArn,
  clusterArn: allocation.clusterArn,
  taskDefinitionArn: allocation.taskDefinitionArn,
  startedBy: allocation.allocationId,
  lastStatus: "STOPPED",
  desiredStatus: "STOPPED",
  stoppedAt: new Date(Date.now() - 10),
  containers: [
    { name: allocation.containerName, taskArn: allocation.taskArn, lastStatus: "STOPPED" },
  ],
});
const stopped = () => ({ tasks: [stoppedTask()], failures: [] });
const running = () => ({
  tasks: [{ ...stoppedTask(), lastStatus: "RUNNING", desiredStatus: "RUNNING" }],
});
type Send = NonNullable<Parameters<typeof createNativeTaskRetirement>[0]["testClient"]>["send"];
const setup = (
  send = vi.fn<Send>(async (): Promise<unknown> => stopped()),
  extra: Partial<Parameters<typeof createNativeTaskRetirement>[0]> = {},
) => ({
  send,
  client: createNativeTaskRetirement({
    allocation,
    enabled: () => true,
    testClient: { send },
    ...extra,
  }),
});

it("refuses default-off and aborted calls without consulting AWS", async () => {
  const send = vi.fn<Send>(async () => stopped());
  const client = createNativeTaskRetirement({ allocation, testClient: { send } });
  await expect(client.retire(allocation)).rejects.toThrow("NativeTaskRetirementUnavailable");
  expect(send).not.toHaveBeenCalled();
  const enabled = setup();
  await expect(enabled.client.retire(allocation, AbortSignal.abort())).rejects.toThrow(
    "NativeTaskRetirementUnavailable",
  );
  expect(enabled.send).not.toHaveBeenCalled();
});

it.each(["ownerUserId", "applicationId", "generationId", "allocationId"] as const)(
  "refuses changed %s before AWS access",
  async (key) => {
    const { client, send } = setup();
    await expect(
      client.retire({ ...allocation, [key]: "019d04cf-1f80-7000-8000-000000000105" }),
    ).rejects.toThrow("NativeTaskRetirementUnavailable");
    expect(send).not.toHaveBeenCalled();
  },
);

it.each([
  { taskArn: allocation.taskArn.replace("123456789012:task", "999999999999:task") },
  { taskArn: allocation.taskArn.replace("us-east-2", "us-east-1") },
  { taskArn: allocation.taskArn.replace("synthetic-materials/", "another-cluster/") },
  { taskArn: "12345678901234567890123456789012" },
  { taskDefinitionArn: allocation.taskDefinitionArn.replace(":7", ":latest") },
  {
    taskDefinitionArn: allocation.taskDefinitionArn.replace(
      "123456789012:task",
      "999999999999:task",
    ),
  },
  { allocationId: "opaque" },
  { containerName: "materials/other" },
])("rejects unqualified or cross-environment allocation binding %#", (change) => {
  expect(() => setup(undefined, { allocation: { ...allocation, ...change } })).toThrow(
    "NativeTaskRetirementUnavailable",
  );
});

it("uses an immutable snapshot and emits only exact positively described task metadata", async () => {
  const original = { ...allocation };
  const { client, send } = setup(undefined, { allocation: original });
  original.taskArn = "another";
  const receipt = await client.retire(allocation);
  expect(receipt).toEqual({
    schemaVersion: 1,
    kind: "native_task_stopped",
    allocationId: allocation.allocationId,
    ownerUserId: allocation.ownerUserId,
    applicationId: allocation.applicationId,
    generationId: allocation.generationId,
    clusterArn: allocation.clusterArn,
    taskArn: allocation.taskArn,
    taskDefinitionArn: allocation.taskDefinitionArn,
    stoppedAtEpochMs: expect.any(Number),
    observedAtEpochMs: expect.any(Number),
  });
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DescribeTasksCommand);
  expect((send.mock.calls[0]?.[0] as DescribeTasksCommand | undefined)?.input).toEqual({
    cluster: allocation.clusterArn,
    tasks: [allocation.taskArn],
  });
});

it("requires a fresh terminal observation after requesting one exact stop", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(running())
    .mockResolvedValueOnce({ task: stoppedTask() })
    .mockResolvedValueOnce(stopped());
  const { client } = setup(send);
  await expect(client.retire(allocation)).resolves.toMatchObject({ kind: "native_task_stopped" });
  expect(send).toHaveBeenCalledTimes(3);
  const stop = send.mock.calls[1]?.[0] as StopTaskCommand;
  expect(stop).toBeInstanceOf(StopTaskCommand);
  expect(stop.input).toEqual({
    cluster: allocation.clusterArn,
    task: allocation.taskArn,
    reason: "native_material_retirement",
  });
  expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DescribeTasksCommand);
});

it("independently reconciles a lost stop ACK without another stop request", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(running())
    .mockRejectedValueOnce(Error("sensitive provider error"))
    .mockResolvedValueOnce(stopped());
  await expect(setup(send).client.retire(allocation)).resolves.toMatchObject({
    kind: "native_task_stopped",
  });
  expect(send.mock.calls.filter(([command]) => command instanceof StopTaskCommand)).toHaveLength(1);
});

it("does not repeat StopTask when desired state is already stopped", async () => {
  const pending = {
    tasks: [{ ...stoppedTask(), lastStatus: "RUNNING", desiredStatus: "STOPPED" }],
  };
  const send = vi.fn<Send>().mockResolvedValueOnce(pending).mockResolvedValueOnce(stopped());
  await expect(setup(send).client.retire(allocation)).resolves.toMatchObject({
    kind: "native_task_stopped",
  });
  expect(send.mock.calls.every(([command]) => command instanceof DescribeTasksCommand)).toBe(true);
});

it.each([
  () => ({ tasks: [], failures: [] }),
  () => ({ tasks: stopped().tasks, failures: [{ arn: allocation.taskArn, reason: "MISSING" }] }),
  () => ({ tasks: [...stopped().tasks, ...stopped().tasks] }),
  () => ({ tasks: [{ ...stoppedTask(), taskArn: "different" }] }),
  () => ({ tasks: [{ ...stoppedTask(), clusterArn: "different" }] }),
  () => ({ tasks: [{ ...stoppedTask(), taskDefinitionArn: "different" }] }),
  () => ({ tasks: [{ ...stoppedTask(), startedBy: "another-allocation" }] }),
  () => ({ tasks: [{ ...stoppedTask(), stoppedAt: new Date(Date.now() + 60_000) }] }),
  () => ({ tasks: [{ ...stoppedTask(), stoppedAt: undefined }] }),
  () => ({ tasks: [{ ...stoppedTask(), stoppedAt: "2026-10-05T00:00:00Z" }] }),
  () => ({ tasks: [{ ...stoppedTask(), desiredStatus: "RUNNING" }] }),
  () => ({ tasks: [{ ...stoppedTask(), containers: [] }] }),
  () => ({
    tasks: [
      {
        ...stoppedTask(),
        containers: [{ ...stoppedTask().containers[0], lastStatus: "RUNNING" }],
      },
    ],
  }),
  () => ({
    tasks: [
      {
        ...stoppedTask(),
        containers: [{ ...stoppedTask().containers[0], taskArn: "another-task" }],
      },
    ],
  }),
  () => ({
    tasks: [
      {
        ...stoppedTask(),
        containers: [{ ...stoppedTask().containers[0], name: "another" }],
      },
    ],
  }),
])("withholds authority for missing/mismatched/nonterminal task proof %#", async (response) => {
  await expect(
    setup(vi.fn<Send>(async () => response())).client.retire(allocation),
  ).rejects.toThrow("NativeTaskRetirementUnavailable");
});

it("never treats a StopTask terminal-looking reply as authority or polls without a bound", async () => {
  const send = vi.fn<Send>(async (command) =>
    command instanceof StopTaskCommand ? { task: stoppedTask() } : running(),
  );
  await expect(setup(send, { maximumObservations: 2 }).client.retire(allocation)).rejects.toThrow(
    "NativeTaskRetirementUnavailable",
  );
  expect(send).toHaveBeenCalledTimes(4);
});

it("rechecks the feature switch after actual observation fulfillment", async () => {
  let enabled = true;
  const send = vi.fn<Send>(async () => {
    enabled = false;
    return stopped();
  });
  await expect(setup(send, { enabled: () => enabled }).client.retire(allocation)).rejects.toThrow(
    "NativeTaskRetirementUnavailable",
  );
});

it("retains admission through actual pending SDK settlement after cancellation", async () => {
  let resolve!: (value: unknown) => void;
  const send = vi.fn<Send>(
    () =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
  );
  const { client } = setup(send);
  const abort = new AbortController();
  let terminal = false;
  const result = client.retire(allocation, abort.signal).catch((error) => {
    terminal = true;
    throw error;
  });
  const rejected = expect(result).rejects.toThrow("NativeTaskRetirementUnavailable");
  abort.abort();
  await Promise.resolve();
  expect(terminal).toBe(false);
  await expect(client.retire(allocation)).rejects.toThrow("NativeTaskRetirementUnavailable");
  expect(send).toHaveBeenCalledOnce();
  resolve(stopped());
  await rejected;
});

it("does not replace actual SDK settlement with its timeout", async () => {
  let resolve!: (value: unknown) => void;
  const send = vi.fn<Send>(
    () =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
  );
  const { client } = setup(send, { timeoutMs: 5 });
  const result = client.retire(allocation);
  const rejected = expect(result).rejects.toThrow("NativeTaskRetirementUnavailable");
  await new Promise((done) => setTimeout(done, 15));
  await expect(client.retire(allocation)).rejects.toThrow("NativeTaskRetirementUnavailable");
  expect(send).toHaveBeenCalledOnce();
  resolve(stopped());
  await rejected;
});

it("refuses injected clients outside the test environment", () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(() => setup()).toThrow("NativeTaskRetirementUnavailable");
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  { maximumObservations: 0 },
  { maximumObservations: 6 },
  { maximumObservations: 1.5 },
  { timeoutMs: 0 },
  { timeoutMs: 10001 },
])("refuses unbounded/invalid observation policy %#", (policy) => {
  expect(() => setup(undefined, policy)).toThrow("NativeTaskRetirementUnavailable");
});

it("redacts original SDK failures and allows a later exact observation", async () => {
  const send = vi
    .fn<Send>()
    .mockRejectedValueOnce(Error("SECRET_RAW_PROVIDER_BODY"))
    .mockResolvedValueOnce(stopped());
  const { client } = setup(send);
  await expect(client.retire(allocation)).rejects.toThrow(/^NativeTaskRetirementUnavailable$/u);
  await expect(client.retire(allocation)).resolves.toMatchObject({ kind: "native_task_stopped" });
  expect(send.mock.calls.every(([command]) => command instanceof DescribeTasksCommand)).toBe(true);
});

it("rechecks enablement after actual StopTask fulfillment", async () => {
  let enabled = true;
  const send = vi
    .fn<Send>()
    .mockResolvedValueOnce(running())
    .mockImplementationOnce(async () => {
      enabled = false;
      return {};
    });
  await expect(setup(send, { enabled: () => enabled }).client.retire(allocation)).rejects.toThrow(
    "NativeTaskRetirementUnavailable",
  );
  expect(send).toHaveBeenCalledTimes(2);
});

it.each([200, 500])(
  "uses installed signed SDK offline with one attempt for HTTP %s",
  async (statusCode) => {
    const handle = vi.fn(
      async (request: { headers: Record<string, string>; body?: unknown; hostname: string }) => {
        expect(request.hostname).toBe("ecs.us-east-2.amazonaws.com");
        expect(request.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /u);
        expect(request.headers["x-amz-target"]).toContain("DescribeTasks");
        expect(JSON.parse(String(request.body))).toEqual({
          cluster: allocation.clusterArn,
          tasks: [allocation.taskArn],
        });
        const response = stopped();
        return {
          response: {
            statusCode,
            headers: { "content-type": "application/x-amz-json-1.1" },
            body: Buffer.from(
              JSON.stringify(
                statusCode === 200
                  ? {
                      ...response,
                      tasks: [
                        {
                          ...response.tasks[0],
                          stoppedAt: (response.tasks[0]?.stoppedAt.getTime() ?? 0) / 1000,
                        },
                      ],
                    }
                  : { __type: "ServerException", message: "SYNTHETIC_DIAGNOSTIC" },
              ),
            ),
          },
        };
      },
    );
    const sdk = new ECSClient({
      region: "us-east-2",
      maxAttempts: 1,
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      requestHandler: { handle },
    });
    try {
      const client = createNativeTaskRetirement({
        allocation,
        enabled: () => true,
        testClient: sdk,
      });
      if (statusCode === 200)
        await expect(client.retire(allocation)).resolves.toMatchObject({
          kind: "native_task_stopped",
        });
      else
        await expect(client.retire(allocation)).rejects.toThrow("NativeTaskRetirementUnavailable");
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      sdk.destroy();
    }
  },
);

it("production client pins regional HTTPS and one attempt despite endpoint environment overrides", async () => {
  vi.stubEnv("AWS_ENDPOINT_URL", "http://untrusted.invalid");
  vi.stubEnv("AWS_ENDPOINT_URL_ECS", "http://untrusted.invalid");
  const send = vi.spyOn(ECSClient.prototype, "send").mockImplementation(async function (
    this: ECSClient,
  ) {
    expect(await this.config.region()).toBe("us-east-2");
    expect(await this.config.maxAttempts()).toBe(1);
    expect(await this.config.endpoint?.()).toMatchObject({
      hostname: "ecs.us-east-2.amazonaws.com",
      protocol: "https:",
    });
    return stopped();
  });
  try {
    const client = createNativeTaskRetirement({ allocation, enabled: () => true });
    await expect(client.retire(allocation)).resolves.toMatchObject({ kind: "native_task_stopped" });
    expect(send).toHaveBeenCalledOnce();
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
  }
});

it("refuses test-client authority when the environment changes after construction", async () => {
  const { client, send } = setup();
  vi.stubEnv("NODE_ENV", "production");
  try {
    await expect(client.retire(allocation)).rejects.toThrow("NativeTaskRetirementUnavailable");
    expect(send).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
