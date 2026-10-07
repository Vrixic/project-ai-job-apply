import { createHash } from "node:crypto";
import {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
} from "@ai-job-apply/documents-service/native-task-launch-policy";
import { expect, it, vi } from "vitest";
import { createNativeResumeTaskObserverLambda } from "./native-resume-task-observer-lambda.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(3),
  allocationId: id(4),
  epochId: id(5),
};
const input = { schemaVersion: 1, action: "observe", scope };
const target = "arn:aws:lambda:us-east-2:123456789012:function:resume-observer:1";
const config = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/resume",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/resume:7",
  containerName: "native-resume",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/resume@sha256:${"a".repeat(64)}`,
  taskRoleArn: "arn:aws:iam::123456789012:role/task",
  executionRoleArn: "arn:aws:iam::123456789012:role/execution",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "ENABLED",
};
function setup() {
  const env: Record<string, string> = {
    NATIVE_RESUME_TASK_OBSERVER_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_SESSION_TOKEN: "synthetic",
    AWS_LAMBDA_FUNCTION_NAME: "resume-observer",
    AWS_LAMBDA_FUNCTION_VERSION: "1",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-Abc123",
    NATIVE_RESUME_OBSERVER_CONFIGURATION_JSON: JSON.stringify(config),
  };
  const resolve = vi.fn(async () => "postgres://synthetic.invalid/unused");
  const observe = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "retired" as const,
    allocationId: scope.allocationId,
    taskArn: "arn:aws:ecs:us-east-2:123456789012:task/resume/12345678901234567890123456789012",
  }));
  const runtime = vi.fn(() => ({
    observe,
    sweep: vi.fn(async () => ({
      schemaVersion: 1 as const,
      inspected: 0,
      retired: 0,
      unresolved: 0,
    })),
    close: async () => undefined,
  }));
  const handler = createNativeResumeTaskObserverLambda({
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createRuntime: runtime,
  });
  return { env, resolve, observe, runtime, handler };
}
it("lazily composes only qualified observation and reuses the runtime", async () => {
  const x = setup();
  await expect(x.handler(input, { invokedFunctionArn: target })).resolves.toMatchObject({
    outcome: "retired",
  });
  await x.handler(input, { invokedFunctionArn: target });
  expect(x.resolve).toHaveBeenCalledOnce();
  expect(x.runtime).toHaveBeenCalledOnce();
  expect(x.observe).toHaveBeenCalledWith(scope, undefined);
});
it.each(["disabled", "unqualified", "foreign", "secret", "ambient"])(
  "rejects %s configuration before secret access",
  async (kind) => {
    const x = setup();
    if (kind === "disabled") x.env.NATIVE_RESUME_TASK_OBSERVER_ENABLED = "false";
    if (kind === "unqualified") x.env.AWS_LAMBDA_FUNCTION_VERSION = "$LATEST";
    if (kind === "foreign") x.env.PLATFORM_AWS_ACCOUNT_ID = "999900001111";
    if (kind === "secret") delete x.env.DATABASE_SECRET_ID;
    if (kind === "ambient") x.env.DATABASE_URL = "postgres://synthetic.invalid/forbidden";
    await expect(x.handler(input, { invokedFunctionArn: target })).rejects.toThrow(
      "NativeResumeTaskObserverUnavailable",
    );
    expect(x.resolve).not.toHaveBeenCalled();
  },
);
it("rejects forged receipts, task overrides and getter execution before effects", async () => {
  const x = setup();
  const getter = vi.fn(() => scope);
  const accessor = { schemaVersion: 1, action: "observe" };
  Object.defineProperty(accessor, "scope", { enumerable: true, get: getter });
  for (const raw of [
    { ...input, receipt: {} },
    { ...input, taskArn: "foreign" },
    { ...input, action: "retire" },
    accessor,
  ])
    await expect(x.handler(raw, { invokedFunctionArn: target })).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(x.resolve).not.toHaveBeenCalled();
});
it("rejects a mismatched invocation target before effects", async () => {
  const x = setup();
  await expect(
    x.handler(input, { invokedFunctionArn: target.replace(":1", ":2") }),
  ).rejects.toThrow();
  expect(x.resolve).not.toHaveBeenCalled();
});
it("retries failed initialization with the same pinned configuration", async () => {
  const x = setup();
  x.resolve.mockRejectedValueOnce(Error("synthetic secret error"));
  await expect(x.handler(input, { invokedFunctionArn: target })).rejects.toThrow(
    "NativeResumeTaskObserverUnavailable",
  );
  await expect(x.handler(input, { invokedFunctionArn: target })).resolves.toMatchObject({
    outcome: "retired",
  });
  expect(x.resolve).toHaveBeenCalledTimes(2);
});
it("refuses configuration drift after startup", async () => {
  const x = setup();
  await x.handler(input, { invokedFunctionArn: target });
  x.env.NATIVE_RESUME_OBSERVER_CONFIGURATION_JSON = JSON.stringify({
    ...config,
    assignPublicIp: "DISABLED",
  });
  await expect(x.handler(input, { invokedFunctionArn: target })).rejects.toThrow();
  expect(x.observe).toHaveBeenCalledOnce();
});
it("withdrawal during secret access prevents runtime creation", async () => {
  const x = setup();
  x.resolve.mockImplementation(async () => {
    x.env.NATIVE_RESUME_TASK_OBSERVER_ENABLED = "false";
    return "postgres://synthetic.invalid/unused";
  });
  await expect(x.handler(input, { invokedFunctionArn: target })).rejects.toThrow();
  expect(x.runtime).not.toHaveBeenCalled();
});

function stoppedEvent() {
  const configuration = nativeTaskLaunchConfiguration(config as NativeTaskLaunchConfiguration);
  const hash = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...configuration }))
    .digest("hex");
  const taskArn = "arn:aws:ecs:us-east-2:123456789012:task/resume/12345678901234567890123456789012";
  return {
    version: "0",
    id: "12345678-1234-1234-1234-123456789012",
    source: "aws.ecs",
    "detail-type": "ECS Task State Change",
    account: "123456789012",
    region: "us-east-2",
    time: "2026-10-07T12:00:00Z",
    resources: [taskArn],
    detail: {
      taskArn,
      clusterArn: config.clusterArn,
      taskDefinitionArn: config.taskDefinitionArn,
      lastStatus: "STOPPED",
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      enableExecuteCommand: false,
      startedBy: scope.allocationId,
      overrides: {
        containerOverrides: [
          {
            name: config.containerName,
            environment: [
              { name: "NATIVE_MATERIAL_OWNER_USER_ID", value: scope.ownerUserId },
              { name: "NATIVE_MATERIAL_APPLICATION_ID", value: scope.applicationId },
              { name: "NATIVE_MATERIAL_GENERATION_ID", value: scope.generationId },
              { name: "NATIVE_MATERIAL_ALLOCATION_ID", value: scope.allocationId },
              { name: "NATIVE_MATERIAL_EPOCH_ID", value: scope.epochId },
              { name: "NATIVE_RESUME_CONFIGURATION_SHA256", value: hash },
            ],
          },
        ],
      },
    },
  };
}
it("forwards a stopped-event hint only to original task observation", async () => {
  const x = setup(),
    event = stoppedEvent();
  await expect(x.handler(event, { invokedFunctionArn: target })).resolves.toMatchObject({
    outcome: "retired",
  });
  expect(x.observe).toHaveBeenCalledWith(scope, event.detail.taskArn);
});
it.each(["account", "task", "running", "hash", "duplicate", "getter"])(
  "rejects %s event before secrets or SQL",
  async (kind) => {
    const x = setup(),
      event = stoppedEvent(),
      getter = vi.fn(() => "STOPPED");
    if (kind === "account") event.account = "999900001111";
    if (kind === "task")
      event.detail.taskArn = event.detail.taskArn.replace("/resume/", "/foreign/");
    if (kind === "running") event.detail.lastStatus = "RUNNING";
    const entries = event.detail.overrides.containerOverrides[0]?.environment;
    const first = entries?.[0],
      hash = entries?.[5];
    if (!entries || !first || !hash) throw Error("SyntheticEventFixtureMissing");
    if (kind === "hash") hash.value = "0".repeat(64);
    if (kind === "duplicate") entries[5] = first;
    if (kind === "getter")
      Object.defineProperty(event.detail, "lastStatus", { enumerable: true, get: getter });
    await expect(x.handler(event, { invokedFunctionArn: target })).rejects.toThrow(
      "NativeResumeTaskObserverUnavailable",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(x.resolve).not.toHaveBeenCalled();
    expect(x.observe).not.toHaveBeenCalled();
  },
);

it("accepts a scalar sweep and rejects caller-selected batches before secret access", async () => {
  const x = setup();
  for (const raw of [
    { schemaVersion: 1, action: "sweep", scope },
    { schemaVersion: 1, action: "sweep", limit: 999 },
  ])
    await expect(x.handler(raw, { invokedFunctionArn: target })).rejects.toThrow();
  expect(x.resolve).not.toHaveBeenCalled();
  await expect(
    x.handler({ schemaVersion: 1, action: "sweep" }, { invokedFunctionArn: target }),
  ).resolves.toEqual({ schemaVersion: 1, inspected: 0, retired: 0, unresolved: 0 });
  expect(x.observe).not.toHaveBeenCalled();
});
