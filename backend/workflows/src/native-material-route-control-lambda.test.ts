import { createNativeMaterialRouteControlClient } from "@ai-job-apply/documents-service/native-material-route-control-client";
import {
  type NativeMaterialRouteControlInput,
  type NativeMaterialRouteControlOutput,
  validateNativeMaterialRouteControlInput,
  validateNativeMaterialRouteControlOutput,
} from "@ai-job-apply/documents-service/native-material-route-control-contract";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { afterEach, expect, it, vi } from "vitest";
import { handler as combinedHandler } from "./native-material-launch-lambda.js";
import { createNativeMaterialRouteControlLambda } from "./native-material-route-control-lambda.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  allocationId: id(1),
  ownerUserId: id(2),
  applicationId: id(3),
  generationId: id(4),
  epochId: id(5),
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:material-launch:9";
const task = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/material",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/material:7",
  containerName: "native-material",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/material@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/task",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "ENABLED",
};
function decodeRequest(command: InvokeCommand) {
  if (!(command.input.Payload instanceof Uint8Array)) throw Error("SyntheticPayloadRejected");
  return JSON.parse(new TextDecoder().decode(command.input.Payload));
}
function setup() {
  const completedAtMs = Date.now() - 1000;
  const input: NativeMaterialRouteControlInput = {
    schemaVersion: 1,
    protocol: "native-material-route.v1",
    action: "capture",
    binding: {
      scope,
      allocation: {
        allocationId: scope.allocationId,
        ownerUserId: scope.ownerUserId,
        applicationId: scope.applicationId,
        generationId: scope.generationId,
        clusterArn: task.clusterArn,
        taskDefinitionArn: task.taskDefinitionArn,
        containerName: task.containerName,
        taskArn: `arn:aws:ecs:us-east-2:123456789012:task/material/${"a".repeat(32)}`,
      },
      original: {
        id: id(6),
        documentId: scope.generationId,
        purpose: "provider_dispatch",
        requestSha256: "b".repeat(64),
      },
    },
    reference: {
      schemaVersion: 1,
      kind: "cover_letter",
      ownerUserId: scope.ownerUserId,
      applicationId: scope.applicationId,
      generationId: scope.generationId,
      version: 2,
      contentSha256: "c".repeat(64),
      completedAtMs,
      expiresAtMs: completedAtMs + 1_800_000,
    },
  };
  const route = {
    intent: {
      allocationId: scope.allocationId,
      publicIp: "54.0.0.1",
      hostedZoneId: "ZSYNTHETIC123",
      baseHost: "materials.example.com",
    },
    expiresAtMs: input.reference.expiresAtMs,
  };
  const env: Record<string, string | undefined> = {
    NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED: "true",
    NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED: "true",
    NATIVE_MATERIAL_NEW_LAUNCH_ENABLED: "false",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "material-launch",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
    NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON: JSON.stringify(task),
    NATIVE_MATERIAL_ROUTE_CONFIGURATION_JSON: JSON.stringify({
      hostedZoneId: route.intent.hostedZoneId,
      baseHost: route.intent.baseHost,
    }),
  };
  const run = vi.fn(
    async (
      request: NativeMaterialRouteControlInput,
    ): Promise<NativeMaterialRouteControlOutput> => ({
      schemaVersion: 1,
      request,
      outcome:
        request.action === "capture"
          ? "captured"
          : request.action === "admit"
            ? "admitted"
            : "retired",
      route: request.action === "capture" ? route : null,
    }),
  );
  const resolveDatabaseUrl = vi.fn(async () => "postgres://synthetic.invalid/material");
  const createRuntime = vi.fn(() => ({ run, close: vi.fn(async () => undefined) }));
  const handler = createNativeMaterialRouteControlLambda({
    environment: () => env,
    resolveDatabaseUrl,
    createRuntime,
  });
  const send = vi.fn(async (command: InvokeCommand) => ({
    StatusCode: 200,
    ExecutedVersion: "9",
    Payload: new TextEncoder().encode(
      JSON.stringify(
        await handler(decodeRequest(command), {
          invokedFunctionArn: command.input.FunctionName ?? "",
        }),
      ),
    ),
  }));
  const client = createNativeMaterialRouteControlClient({
    functionArn: target,
    enabled: () => true,
    testClient: { send },
  });
  return { input, route, env, run, resolveDatabaseUrl, createRuntime, handler, send, client };
}
afterEach(() => vi.unstubAllEnvs());
it("connects the exact numeric sender and guarded receiver for capture/admission/retirement without new launch", async () => {
  const x = setup();
  for (const request of [
    x.input,
    { ...x.input, action: "admit" as const, route: x.route },
    { ...x.input, action: "retired" as const },
  ]) {
    const result = await x.client.run(request);
    expect(validateNativeMaterialRouteControlOutput(result)).toBe(true);
    expect(result.request).toEqual(request);
  }
  expect(x.resolveDatabaseUrl).toHaveBeenCalledOnce();
  expect(x.createRuntime).toHaveBeenCalledOnce();
  for (const [command] of x.send.mock.calls)
    expect(command.input).toMatchObject({
      FunctionName: target,
      InvocationType: "RequestResponse",
      LogType: "None",
    });
});
it.each([
  ["NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED", undefined],
  ["NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED", "false"],
  ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
  ["AWS_REGION", "us-east-1"],
  ["AWS_SESSION_TOKEN", undefined],
  ["DATABASE_URL", ""],
  ["OPENAI_API_KEY", ""],
  ["NATIVE_MATERIAL_ROUTE_CONFIGURATION_JSON", "{}"],
  [
    "NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON",
    JSON.stringify({ ...task, assignPublicIp: "DISABLED" }),
  ],
])("refuses %s before secrets or owners", async (key, value) => {
  const x = setup();
  x.env[key as string] = value;
  await expect(x.handler(x.input, { invokedFunctionArn: target })).resolves.toEqual({
    schemaVersion: 1,
    request: x.input,
    outcome: "unavailable",
    route: null,
  });
  expect(x.resolveDatabaseUrl).not.toHaveBeenCalled();
  expect(x.run).not.toHaveBeenCalled();
});
it("rejects another invoked version and changed pinned route", async () => {
  const x = setup();
  await expect(
    x.handler(x.input, { invokedFunctionArn: target.replace(/9$/u, "10") }),
  ).resolves.toMatchObject({ outcome: "unavailable" });
  expect(x.resolveDatabaseUrl).not.toHaveBeenCalled();
  await x.client.run(x.input);
  x.env.NATIVE_MATERIAL_ROUTE_CONFIGURATION_JSON = JSON.stringify({
    hostedZoneId: "ZFOREIGN123",
    baseHost: "other.example.com",
  });
  await expect(x.client.run(x.input)).rejects.toThrow("NativeMaterialRouteControlUnavailable");
  expect(x.run).toHaveBeenCalledOnce();
});
it("rejects foreign binding/reference/route and content before transport", async () => {
  const x = setup();
  for (const raw of [
    { ...x.input, body: "synthetic" },
    { ...x.input, reference: { ...x.input.reference, ownerUserId: id(99) } },
    { ...x.input, action: "admit", route: { ...x.route, expiresAtMs: x.route.expiresAtMs + 1 } },
    { ...x.input, protocol: "other" },
  ]) {
    expect(validateNativeMaterialRouteControlInput(raw)).toBe(false);
    await expect(x.client.run(raw as NativeMaterialRouteControlInput)).rejects.toThrow();
  }
  const read = vi.fn(() => x.input.binding);
  expect(
    validateNativeMaterialRouteControlInput(
      Object.defineProperty({ ...x.input }, "binding", { get: read, enumerable: true }),
    ),
  ).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(x.send).not.toHaveBeenCalled();
});
it.each(["version", "echo", "expiry", "outcome"])(
  "refuses mismatched %s acknowledgement",
  async (kind) => {
    const x = setup();
    x.send.mockImplementation(async () => ({
      StatusCode: 200,
      ExecutedVersion: kind === "version" ? "10" : "9",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          request: kind === "echo" ? { ...x.input, action: "retired" } : x.input,
          outcome: kind === "outcome" ? "retired" : "captured",
          route: { ...x.route, expiresAtMs: x.route.expiresAtMs + (kind === "expiry" ? 1 : 0) },
        }),
      ),
    }));
    await expect(x.client.run(x.input)).rejects.toThrow("NativeMaterialRouteControlUnavailable");
  },
);
it("keeps the combined deployed handler default-off for the new protocol", async () => {
  const x = setup();
  vi.stubEnv("NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED", "false");
  await expect(combinedHandler(x.input, { invokedFunctionArn: target })).resolves.toMatchObject({
    outcome: "unavailable",
    route: null,
  });
});
it("rejects alias targets and test transports in production", () => {
  const x = setup();
  expect(() =>
    createNativeMaterialRouteControlClient({ functionArn: target.replace(/9$/u, "live") }),
  ).toThrow();
  vi.stubEnv("NODE_ENV", "production");
  expect(() =>
    createNativeMaterialRouteControlClient({ functionArn: target, testClient: { send: x.send } }),
  ).toThrow();
});
