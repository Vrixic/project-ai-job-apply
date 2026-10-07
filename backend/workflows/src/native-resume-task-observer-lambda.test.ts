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
  const runtime = vi.fn(() => ({ observe, close: async () => undefined }));
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
  expect(x.observe).toHaveBeenCalledWith(scope);
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
