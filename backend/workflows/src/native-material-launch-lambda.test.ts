import type { NativeLaunchControlInput } from "@ai-job-apply/documents-service/native-launch-control";
import { describe, expect, it, vi } from "vitest";
import { createNativeMaterialLaunchLambda } from "./native-material-launch-lambda.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const task = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:7",
  containerName: "native-material",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/native@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/native-execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "DISABLED",
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:private-native-launch:9";
const input: Extract<NativeLaunchControlInput, { action: "launch" }> = {
  schemaVersion: 1,
  action: "launch",
  ownerUserId: id(1),
  applicationId: id(2),
  original: {
    id: id(3),
    documentId: id(4),
    purpose: "provider_dispatch",
    requestSha256: "a".repeat(64),
  },
  previousEpochId: null,
};
const scope = {
  allocationId: id(5),
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(4),
  epochId: id(6),
};
const allocation = {
  allocationId: id(5),
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(4),
  clusterArn: task.clusterArn,
  taskDefinitionArn: task.taskDefinitionArn,
  containerName: task.containerName,
  taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"b".repeat(32)}`,
};
const recover: Extract<NativeLaunchControlInput, { action: "recover" }> = {
  schemaVersion: 1,
  action: "recover",
  scope,
  taskArn: allocation.taskArn,
};
const unavailable = (request: NativeLaunchControlInput = input) => ({
  schemaVersion: 1,
  request,
  outcome: "unavailable",
  capture: null,
});
function fixture() {
  const env: Record<string, string | undefined> = {
    NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED: "true",
    NATIVE_MATERIAL_NEW_LAUNCH_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "private-native-launch",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic-session",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
    NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON: JSON.stringify(task),
  };
  const run = vi.fn(async (request: NativeLaunchControlInput) => ({
    schemaVersion: 1 as const,
    request,
    outcome: "captured" as const,
    capture: { scope, allocation },
  }));
  const resolveDatabaseUrl = vi.fn(async () => "postgres://synthetic.invalid/native-launch");
  const createRuntime = vi.fn(() => ({ run, close: vi.fn(async () => undefined) }));
  const handler = createNativeMaterialLaunchLambda({
    environment: () => env,
    resolveDatabaseUrl,
    createRuntime,
  });
  return { env, run, resolveDatabaseUrl, createRuntime, handler };
}
describe("private native material launch bootstrap", () => {
  it.each([
    ["NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED", undefined],
    ["NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED", "TRUE"],
    ["NATIVE_MATERIAL_NEW_LAUNCH_ENABLED", undefined],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "bad"],
    ["AWS_LAMBDA_FUNCTION_NAME", "bad:name"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "alias"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "0"],
    ["AWS_SESSION_TOKEN", undefined],
    ["DATABASE_URL", ""],
    ["OPENAI_API_KEY", ""],
    ["OPENAI_API_KEY_SECRET_ID", "synthetic"],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic"],
    ["DATABASE_SECRET_ID", undefined],
    ["DATABASE_SECRET_ID", "arn:aws:secretsmanager:us-east-2:999999999999:secret:foreign"],
    ["NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON", "{}"],
    ["NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON", "bad-json"],
    ["NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON", " ".repeat(8193)],
  ])("refuses invalid/default-off %s before secrets, SQL and ECS", async (key, value) => {
    const f = fixture();
    f.env[key as string] = value;
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each([target.replace(/9$/u, "$LATEST"), target.replace(/9$/u, "10"), "bad"])(
    "refuses wrong invoked version %s",
    async (invokedFunctionArn) => {
      const f = fixture();
      await expect(f.handler(input, { invokedFunctionArn })).resolves.toEqual(unavailable());
      expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    },
  );
  it("refuses content/accessors before configuration or effects", async () => {
    const f = fixture();
    const read = vi.fn(() => input.original);
    await expect(
      f.handler({ ...input, body: "synthetic" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("NativeLaunchControlUnavailable");
    await expect(
      f.handler(Object.defineProperty({ ...input }, "original", { get: read, enumerable: true }), {
        invokedFunctionArn: target,
      }),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it.each([
    { ...task, clusterArn: task.clusterArn.replace("123456789012", "999999999999") },
    { ...task, clusterArn: task.clusterArn.replace("us-east-2", "us-east-1") },
    { ...task, image: task.image.split("@")[0] },
    { ...task, cpu: "2048" },
    { ...task, text: "synthetic" },
  ])("refuses unsupported deployment before any credential read: %j", async (configuration) => {
    const f = fixture();
    f.env.NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON = JSON.stringify(configuration);
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("single-flights bounded read-only setup and pins one original runtime", async () => {
    const f = fixture();
    await Promise.all([
      f.handler(input, { invokedFunctionArn: target }),
      f.handler(input, { invokedFunctionArn: target }),
    ]);
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
    expect(f.resolveDatabaseUrl).toHaveBeenCalledWith(
      { DATABASE_SECRET_ID: f.env.DATABASE_SECRET_ID },
      {
        sessionToken: "synthetic-session",
        requestTimeoutMilliseconds: 3000,
        retryDelaysMilliseconds: [],
      },
    );
    const [, , enabled, newLaunch] = f.createRuntime.mock.calls[0] as unknown as [
      unknown,
      unknown,
      () => boolean,
      () => boolean,
    ];
    expect(enabled()).toBe(true);
    expect(newLaunch()).toBe(true);
    f.env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = "false";
    expect(enabled()).toBe(true);
    expect(newLaunch()).toBe(false);
    await expect(f.handler(recover, { invokedFunctionArn: target })).resolves.toMatchObject({
      outcome: "captured",
    });
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
  });
  it("does not create SQL after shutdown during managed-secret resolution", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockImplementation(async () => {
      f.env.NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED = "false";
      return "postgres://synthetic.invalid";
    });
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    expect(f.createRuntime).not.toHaveBeenCalled();
  });
  it("retries only failed read-only setup on a later invocation", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockRejectedValueOnce(Error("SyntheticSecretReadFailure"));
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toMatchObject({
      outcome: "captured",
    });
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(2);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
  it("pins original task configuration and refuses later retargeting", async () => {
    const f = fixture();
    await f.handler(input, { invokedFunctionArn: target });
    f.env.NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON = JSON.stringify({
      ...task,
      taskDefinitionArn: task.taskDefinitionArn.replace(/7$/u, "8"),
    });
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
  it("withholds foreign and late/shutdown acknowledgements without retry", async () => {
    const f = fixture();
    f.run.mockImplementation(async (request) => {
      f.env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = "false";
      return { schemaVersion: 1, request, outcome: "captured", capture: { scope, allocation } };
    });
    await expect(f.handler(input, { invokedFunctionArn: target })).resolves.toEqual(unavailable());
    expect(f.run).toHaveBeenCalledTimes(1);
  });
});
