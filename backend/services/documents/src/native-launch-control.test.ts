import { type InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeLaunchControlClient } from "./native-launch-control-client.js";
import {
  type NativeLaunchControlInput,
  validateNativeLaunchControlInput,
  validateNativeLaunchControlOutput,
} from "./native-launch-control-contract.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
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
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:7",
  containerName: "native-material",
  taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"b".repeat(32)}`,
};
const recover: Extract<NativeLaunchControlInput, { action: "recover" }> = {
  schemaVersion: 1,
  action: "recover",
  scope,
  taskArn: allocation.taskArn,
};
const output = (request: NativeLaunchControlInput = input) => ({
  schemaVersion: 1 as const,
  request,
  outcome: "captured" as const,
  capture: { scope, allocation },
});
const reply = (value: unknown = output()) => ({
  StatusCode: 200,
  ExecutedVersion: "9",
  Payload: new TextEncoder().encode(JSON.stringify(value)),
  $metadata: {},
});
function fixture() {
  const send = vi.fn(async (_command: InvokeCommand, _options: { abortSignal: AbortSignal }) =>
    reply(),
  );
  const client = createNativeLaunchControlClient({
    functionArn: target,
    testClient: { send },
    enabled: () => true,
    launchEnabled: () => true,
  });
  return { send, client };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("strict native launch metadata contract", () => {
  it("accepts bound launch/recovery and unavailable metadata only", () => {
    expect(validateNativeLaunchControlInput(input)).toBe(true);
    expect(validateNativeLaunchControlInput(recover)).toBe(true);
    expect(validateNativeLaunchControlOutput(output())).toBe(true);
    expect(validateNativeLaunchControlOutput(output(recover))).toBe(true);
    expect(
      validateNativeLaunchControlOutput({
        schemaVersion: 1,
        request: input,
        outcome: "unavailable",
        capture: null,
      }),
    ).toBe(true);
  });
  it.each([
    { ...input, text: "synthetic forbidden body" },
    { ...input, schemaVersion: 2 },
    { ...input, previousEpochId: "bad" },
    { ...input, ownerUserId: id(1).replace("7000", "4000") },
    { ...input, original: { ...input.original, purpose: "private_slots" } },
    { ...input, original: { ...input.original, content: "synthetic" } },
    { ...recover, scope: { ...scope, text: "synthetic" } },
    { ...recover, taskArn: "bad" },
    Object.assign(Object.create({ inherited: true }), input),
    Object.assign(Object.create(null), input),
    Object.defineProperty({ ...input }, Symbol("hidden"), { value: "synthetic" }),
    Object.defineProperty({ ...input }, "hidden", { value: "synthetic" }),
  ])("refuses unmodelled content/shape without effects: %j", (value) => {
    expect(validateNativeLaunchControlInput(value)).toBe(false);
  });
  it("does not evaluate accessors", () => {
    const read = vi.fn(() => input.original);
    const value = Object.defineProperty({ ...input }, "original", { get: read, enumerable: true });
    expect(validateNativeLaunchControlInput(value)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    { ...output(), capture: null },
    { ...output(), outcome: "unavailable" },
    { ...output(), capture: { scope: { ...scope, ownerUserId: id(9) }, allocation } },
    { ...output(), capture: { scope, allocation: { ...allocation, generationId: id(9) } } },
    { ...output(recover), capture: { scope: { ...scope, epochId: id(9) }, allocation } },
    {
      ...output(recover),
      capture: {
        scope,
        allocation: { ...allocation, taskArn: allocation.taskArn.replace(/b/gu, "c") },
      },
    },
    { ...output(), content: "synthetic" },
  ])("refuses foreign or contradictory capture: %j", (value) =>
    expect(validateNativeLaunchControlOutput(value)).toBe(false),
  );
});
describe("private native launch sender", () => {
  it("defaults both effects off and exposes only frozen launch/recover", async () => {
    const send = vi.fn();
    const client = createNativeLaunchControlClient({ functionArn: target, testClient: { send } });
    expect(Object.isFrozen(client)).toBe(true);
    expect(Object.keys(client)).toEqual(["launch", "recover"]);
    await expect(client.launch(input)).rejects.toThrow("NativeLaunchControlUnavailable");
    await expect(client.recover(recover)).rejects.toThrow("NativeLaunchControlUnavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it("sends one exact pinned scalar Invoke and detaches capture", async () => {
    const f = fixture();
    const captured = await f.client.launch(input);
    expect(f.send).toHaveBeenCalledTimes(1);
    const command = f.send.mock.calls[0]?.[0] as unknown as {
      input: { FunctionName: string; LogType: string; Payload: Uint8Array };
    };
    expect(command.input.FunctionName).toBe(target);
    expect(command.input.LogType).toBe("None");
    expect(JSON.parse(new TextDecoder().decode(command.input.Payload))).toEqual(input);
    expect(captured).toEqual({ scope, allocation });
    expect(captured.scope).not.toBe(scope);
  });
  it("keeps recovery enabled while new launches are off", async () => {
    const send = vi.fn(async () => reply(output(recover)));
    const client = createNativeLaunchControlClient({
      functionArn: target,
      enabled: () => true,
      testClient: { send },
    });
    await expect(client.launch(input)).rejects.toThrow();
    await expect(client.recover(recover)).resolves.toEqual({ scope, allocation });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not allow an action to bypass the method's capability", async () => {
    const f = fixture();
    await expect(f.client.launch(recover as unknown as typeof input)).rejects.toThrow();
    await expect(f.client.recover(input as unknown as typeof recover)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["$LATEST", "alias", "0", "09"])("refuses nonnumeric target %s", (version) =>
    expect(() =>
      createNativeLaunchControlClient({ functionArn: target.replace(/9$/u, version) }),
    ).toThrow(),
  );
  it("refuses injected transports outside test before SDK effects", () => {
    vi.stubEnv("NODE_ENV", "production");
    const send = vi.fn();
    expect(() =>
      createNativeLaunchControlClient({ functionArn: target, testClient: { send } }),
    ).toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { ...reply(), StatusCode: 202 },
    { ...reply(), ExecutedVersion: "10" },
    { ...reply(), FunctionError: "Unhandled" },
    { ...reply(), LogResult: "synthetic" },
    { ...reply(), Payload: new Uint8Array([0xff]) },
    { ...reply(), Payload: new Uint8Array(8193) },
    { ...reply(), Payload: new TextEncoder().encode(` ${JSON.stringify(output())}`) },
    reply({ ...output(), request: { ...input, original: { ...input.original, id: id(9) } } }),
    reply({ schemaVersion: 1, request: input, outcome: "unavailable", capture: null }),
  ])("withholds invalid/wrong original replies and never retries: %j", async (value) => {
    const f = fixture();
    f.send.mockResolvedValue(value);
    await expect(f.client.launch(input)).rejects.toThrow();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("holds admission until an abort-ignoring original transport settles", async () => {
    let settle!: (value: ReturnType<typeof reply>) => void;
    const send = vi.fn(
      () =>
        new Promise<ReturnType<typeof reply>>((resolve) => {
          settle = resolve;
        }),
    );
    const client = createNativeLaunchControlClient({
      functionArn: target,
      enabled: () => true,
      launchEnabled: () => true,
      timeoutMs: 1,
      testClient: { send },
    });
    const pending = client.launch(input);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(client.launch(input)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    settle(reply());
    await expect(pending).rejects.toThrow();
  });
  it("uses actual signed serialization with a fixed production SDK endpoint and no content logs", async () => {
    const original = LambdaClient.prototype.send;
    const requests: Array<{
      hostname: string;
      path: string;
      headers: Record<string, string>;
      body: Uint8Array;
    }> = [];
    vi.spyOn(LambdaClient.prototype, "send").mockImplementation(function (
      this: LambdaClient,
      ...args: Parameters<typeof original>
    ) {
      Object.assign(this.config, {
        credentials: async () => ({
          accessKeyId: "SYNTHETIC",
          secretAccessKey: "synthetic-only",
          sessionToken: "synthetic-session",
        }),
        requestHandler: {
          handle: async (request: (typeof requests)[number]) => {
            requests.push(request);
            return {
              response: {
                statusCode: 200,
                headers: { "x-amz-executed-version": "9" },
                body: reply().Payload,
              },
            };
          },
        },
      });
      return Reflect.apply(original, this, args);
    });
    vi.stubEnv("AWS_ENDPOINT_URL_LAMBDA", "https://synthetic.invalid");
    const client = createNativeLaunchControlClient({
      functionArn: target,
      enabled: () => true,
      launchEnabled: () => true,
    });
    await expect(client.launch(input)).resolves.toEqual({ scope, allocation });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.hostname).toBe("lambda.us-east-2.amazonaws.com");
    expect(requests[0]?.path).toContain(encodeURIComponent(target));
    expect(requests[0]?.headers.authorization).toContain("/us-east-2/lambda/aws4_request");
    expect(JSON.parse(new TextDecoder().decode(requests[0]?.body))).toEqual(input);
  });
});
