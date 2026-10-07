import { fileURLToPath } from "node:url";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { expect, it, vi } from "vitest";
import { createNativeResumePreparationControlClient } from "./native-resume-preparation-control-client.js";
import {
  type NativeResumePreparationControlInput,
  type NativeResumePreparationControlOutput,
  validateNativeResumePreparationControlInput,
  validateNativeResumePreparationControlOutput,
} from "./native-resume-preparation-control-contract.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-preparation:9";
const deployment = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:1",
  containerName: "resume",
};
const start: NativeResumePreparationControlInput = {
  schemaVersion: 1,
  action: "start",
  reservation: {
    identity: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      version: 1,
      baseDocumentId: id(4),
      baseVersion: 1,
      baseSha256: "a".repeat(64),
      jobContextSha256: "b".repeat(64),
    },
    application: {
      ownerUserId: id(1),
      applicationId: id(2),
      canonicalJobId: id(5),
      expectedRevision: 2,
      packetId: id(6),
      packetHash: "c".repeat(64),
      jobRevision: "d".repeat(64),
    },
    normalizedSha256: "e".repeat(64),
    previousEpochId: null,
    deployment,
  },
};
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(3),
  allocationId: id(7),
  epochId: id(8),
};
const complete: NativeResumePreparationControlInput = {
  schemaVersion: 1,
  action: "complete",
  scope,
};
const output = (
  request: NativeResumePreparationControlInput = start,
): NativeResumePreparationControlOutput => ({
  schemaVersion: 1,
  request,
  outcome: request.action === "start" ? "reserved" : "pending",
  scope,
  packet: null,
});
it("accepts scalar original preparation and rejects bodies, foreign scope and mismatched results", () => {
  expect(validateNativeResumePreparationControlInput(start)).toBe(true);
  expect(validateNativeResumePreparationControlInput(complete)).toBe(true);
  expect(validateNativeResumePreparationControlOutput(output())).toBe(true);
  for (const value of [
    { ...start, content: "synthetic forbidden" },
    { ...complete, scope: { ...scope, token: "synthetic" } },
    {
      ...start,
      reservation: {
        ...start.reservation,
        identity: { ...start.reservation.identity, ownerUserId: id(9) },
      },
    },
  ])
    expect(validateNativeResumePreparationControlInput(value)).toBe(false);
  for (const value of [
    { ...output(), scope: { ...scope, ownerUserId: id(9) } },
    { ...output(), packet: { id: id(9), revision: 3 } },
    { ...output(complete), outcome: "ready", packet: { id: id(9), revision: 0 } },
  ])
    expect(validateNativeResumePreparationControlOutput(value)).toBe(false);
});
it("binds route capture/admission/retirement metadata to the exact original scope", () => {
  const route = {
    intent: {
      allocationId: scope.allocationId,
      publicIp: "54.0.0.1",
      hostedZoneId: "ZSYNTHETIC123",
      baseHost: "resumes.example.com",
    },
    expiresAtMs: Date.now() + 10000,
  };
  const request = { schemaVersion: 1 as const, action: "route_capture" as const, scope };
  const captured = {
    schemaVersion: 1,
    request,
    outcome: "route_captured",
    scope,
    packet: null,
    route,
  };
  expect(validateNativeResumePreparationControlInput(request)).toBe(true);
  expect(validateNativeResumePreparationControlOutput(captured)).toBe(true);
  const admit = { schemaVersion: 1, action: "route_admit", scope, route };
  expect(validateNativeResumePreparationControlInput(admit)).toBe(true);
  expect(validateNativeResumePreparationControlOutput({ ...captured, outcome: "ready" })).toBe(
    false,
  );
  expect(
    validateNativeResumePreparationControlOutput({
      ...captured,
      route: { ...route, token: "synthetic" },
    }),
  ).toBe(false);
  expect(
    validateNativeResumePreparationControlInput({
      ...admit,
      route: { ...route, intent: { ...route.intent, allocationId: id(99) } },
    }),
  ).toBe(false);
  expect(
    validateNativeResumePreparationControlInput({
      ...admit,
      route: { ...route, intent: { ...route.intent, publicIp: "127.0.0.1" } },
    }),
  ).toBe(false);
  const retired = { schemaVersion: 1, action: "route_retired", scope };
  expect(validateNativeResumePreparationControlInput(retired)).toBe(true);
  expect(
    validateNativeResumePreparationControlOutput({
      schemaVersion: 1,
      request: retired,
      outcome: "retired",
      scope,
      packet: null,
    }),
  ).toBe(true);
  expect(
    validateNativeResumePreparationControlOutput({
      ...captured,
      outcome: "retired",
      request: retired,
    }),
  ).toBe(false);
});
it.each(["version", "log", "foreign", "unavailable"])(
  "refuses %s Lambda replies without retry",
  async (mode) => {
    const send = vi.fn(async () => ({
      StatusCode: 200,
      ExecutedVersion: mode === "version" ? "10" : "9",
      ...(mode === "log" ? { LogResult: "synthetic" } : {}),
      Payload: new TextEncoder().encode(
        JSON.stringify(
          mode === "unavailable"
            ? { ...output(), outcome: "unavailable", scope: null }
            : mode === "foreign"
              ? { ...output(), scope: { ...scope, generationId: id(9) } }
              : output(),
        ),
      ),
    }));
    const client = createNativeResumePreparationControlClient({
      functionArn: target,
      enabled: () => true,
      launchEnabled: () => true,
      testClient: { send },
    });
    await expect(client.run(start)).rejects.toThrow("NativeResumePreparationControlUnavailable");
    expect(send).toHaveBeenCalledOnce();
  },
);
it("connects the actual numeric client/handler and pins warm configuration before secret reads", async () => {
  const module = await import(
    fileURLToPath(
      new URL(
        "../../../workflows/dist/src/native-resume-preparation-control-lambda.js",
        import.meta.url,
      ),
    )
  );
  const environment: Record<string, string | undefined> = {
    NATIVE_RESUME_PREPARATION_CONTROL_ENABLED: "true",
    NATIVE_RESUME_ROUTE_OWNER_ENABLED: "true",
    NATIVE_RESUME_ROUTE_CONFIGURATION_JSON: JSON.stringify({
      hostedZoneId: "ZSYNTHETIC123",
      baseHost: "resumes.example.com",
    }),
    NATIVE_RESUME_NEW_LAUNCH_ENABLED: "true",
    RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "native-resume-preparation",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic-session",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic",
    NATIVE_RESUME_LAUNCH_CONFIGURATION_JSON: JSON.stringify({
      ...deployment,
      image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/native@sha256:${"f".repeat(64)}`,
      executionRoleArn: "arn:aws:iam::123456789012:role/execution",
      taskRoleArn: "arn:aws:iam::123456789012:role/resume",
      cpu: "256",
      memory: "512",
      subnets: ["subnet-12345678901234567"],
      securityGroups: ["sg-12345678901234567"],
      assignPublicIp: "ENABLED",
    }),
  };
  const secret = vi.fn(async () => "postgres://synthetic@127.0.0.1:1/no_connection"),
    run = vi.fn(async (request: NativeResumePreparationControlInput) => output(request));
  const handler = module.createNativeResumePreparationControlLambda({
    environment: () => environment,
    resolveDatabaseUrl: secret,
    createRuntime: () => ({ run, close: async () => {} }),
  });
  const send = vi.fn(async (command: InvokeCommand) => {
    if (!(command.input.Payload instanceof Uint8Array)) throw new Error("Expected byte payload");
    return {
      StatusCode: 200,
      ExecutedVersion: "9",
      Payload: new TextEncoder().encode(
        JSON.stringify(
          await handler(JSON.parse(new TextDecoder().decode(command.input.Payload)), {
            invokedFunctionArn: command.input.FunctionName,
          }),
        ),
      ),
    };
  });
  const client = createNativeResumePreparationControlClient({
    functionArn: target,
    enabled: () => true,
    launchEnabled: () => true,
    testClient: { send },
  });
  await expect(client.run(start)).resolves.toMatchObject({ outcome: "reserved", scope });
  environment.NATIVE_RESUME_NEW_LAUNCH_ENABLED = "false";
  await expect(client.run(complete)).resolves.toMatchObject({ outcome: "pending" });
  await expect(client.run(start)).rejects.toThrow();
  expect(secret).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledTimes(2);
  environment.NATIVE_RESUME_ROUTE_CONFIGURATION_JSON = JSON.stringify({
    hostedZoneId: "ZFOREIGN",
    baseHost: "resumes.example.com",
  });
  await expect(client.run(complete)).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(2);
  environment.NATIVE_RESUME_ROUTE_CONFIGURATION_JSON = JSON.stringify({
    hostedZoneId: "ZSYNTHETIC123",
    baseHost: "resumes.example.com",
  });
  environment.AWS_LAMBDA_FUNCTION_VERSION = "10";
  await expect(client.run(complete)).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(2);
});
it("default-off handler and malformed input cannot resolve the database or create a runtime", async () => {
  const module = await import(
    fileURLToPath(
      new URL(
        "../../../workflows/dist/src/native-resume-preparation-control-lambda.js",
        import.meta.url,
      ),
    )
  );
  const effect = vi.fn();
  const handler = module.createNativeResumePreparationControlLambda({
    environment: () => ({}),
    resolveDatabaseUrl: effect,
    createRuntime: effect,
  });
  await expect(handler(start, { invokedFunctionArn: target })).resolves.toMatchObject({
    outcome: "unavailable",
    scope: null,
    packet: null,
  });
  await expect(
    handler({ ...start, candidateText: "synthetic" }, { invokedFunctionArn: target }),
  ).rejects.toThrow();
  expect(effect).not.toHaveBeenCalled();
});
