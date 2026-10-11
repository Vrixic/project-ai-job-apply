import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import { createNativeResumeOwnerRpcClient } from "./native-resume-owner-rpc-client.js";
import {
  type NativeResumeBootstrap,
  type NativeResumeOwnerRequest,
  type NativeResumeOwnerRpcInput,
  nativeResumeOwnerRequestDigest,
  validateNativeResumeOwnerRpcInput,
} from "./native-resume-owner-rpc-contract.js";
import { createNativeResumeOwnerRpcHandler } from "./native-resume-owner-rpc-handler.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerClient } from "./native-resume-task-caller-client.js";
import { createNativeTaskCallerClient } from "./native-task-caller-client.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-owner:7";
const taskId = "a".repeat(32);
const credentials = {
  accessKeyId: "ASIASYNTHETICEXAMPLE",
  secretAccessKey: "synthetic-local-signing-secret-only",
  sessionToken: "synthetic-local-signing-token-only",
};
function fixture() {
  const binding: NativeResumeTaskBinding = {
    schemaVersion: 1,
    kind: "tailored_resume",
    configurationSha256: "f".repeat(64),
    scope: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      epochId: id(5),
    },
    allocation: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${taskId}`,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
  };
  const bootstrapValue: NativeResumeBootstrap = {
    identity: {
      generationId: id(4),
      ownerUserId: id(2),
      applicationId: id(3),
      version: 1,
      baseDocumentId: id(6),
      baseVersion: 2,
      baseSha256: "a".repeat(64),
      jobContextSha256: "b".repeat(64),
    },
    normalizedSha256: "c".repeat(64),
    canonicalJobId: id(7),
  };
  const completed = Date.now();
  const material: TemporaryMaterialReference = {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: id(4),
    ownerUserId: id(2),
    applicationId: id(3),
    version: 1,
    contentSha256: "d".repeat(64),
    completedAtMs: completed,
    expiresAtMs: completed + 1800000,
  };
  const enabled = vi.fn(() => true),
    checkAdmission = vi.fn(async (_b: Readonly<NativeResumeTaskBinding>) => {}),
    bootstrap = vi.fn(async () => structuredClone(bootstrapValue)),
    claimOriginalCompletion = vi.fn(async () => "claimed" as const),
    publishReady = vi.fn(async () => {});
  const owners = vi.fn(async () => ({
    checkAdmission,
    bootstrap,
    claimOriginalCompletion,
    publishReady,
    principal: async (_b: Readonly<NativeResumeTaskBinding>, issuer: string) => ({
      issuer,
      subject: "synthetic-principal",
    }),
  }));
  const xml = (session = taskId, account = "123456789012", role = "native-resume") =>
    `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::${account}:assumed-role/${role}/${session}</Arn><Account>${account}</Account><UserId>AROAABCDEFGHIJKLMNOP:${session}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`;
  const testFetch = vi.fn(
    async () => new Response(xml(), { headers: { "content-type": "text/xml" } }),
  );
  const handler = createNativeResumeOwnerRpcHandler({
    targetArn: target,
    taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
    deployment: {
      clusterArn: binding.allocation.clusterArn,
      taskDefinitionArn: binding.allocation.taskDefinitionArn,
      containerName: binding.allocation.containerName,
    },
    owners,
    enabled,
    testFetch,
  });
  const send = vi.fn(async (command: InvokeCommand) => {
    if (!(command.input.Payload instanceof Uint8Array))
      throw Error("SyntheticRpcPayloadUnavailable");
    const input = JSON.parse(new TextDecoder().decode(command.input.Payload));
    const result = await handler(input, { invokedFunctionArn: target });
    return {
      StatusCode: 200,
      ExecutedVersion: "7",
      // Lambda serializes the handler's object without sorting its property keys.
      Payload: new TextEncoder().encode(JSON.stringify(result)),
    };
  });
  const client = createNativeResumeOwnerRpcClient({
    binding,
    targetArn: target,
    enabled,
    testCredentials: credentials,
    testClient: { send },
  });
  const signed = async (
    request: NativeResumeOwnerRequest = { action: "admit" },
  ): Promise<NativeResumeOwnerRpcInput> => ({
    schemaVersion: 1,
    binding: structuredClone(binding),
    request: structuredClone(request),
    proof: await createNativeResumeTaskCallerClient({
      binding,
      targetArn: target,
      enabled: () => true,
      testCredentials: credentials,
    }).proof(nativeResumeOwnerRequestDigest(binding, request)),
  });
  return {
    binding,
    material,
    enabled,
    bootstrapValue,
    bootstrap,
    checkAdmission,
    claimOriginalCompletion,
    publishReady,
    owners,
    testFetch,
    handler,
    send,
    client,
    signed,
    xml,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("native resume authenticated scalar RPC", () => {
  it.each([null, [], 7, {}])(
    "refuses malformed proof headers before owner access (%j)",
    async (headers) => {
      const f = fixture(),
        input = await f.signed();
      const malformed = { ...input, proof: { schemaVersion: 1, headers } };
      expect(validateNativeResumeOwnerRpcInput(malformed)).toBe(false);
      await expect(f.handler(malformed, { invokedFunctionArn: target })).rejects.toThrow(
        "NativeResumeOwnerUnavailable",
      );
      expect(f.owners).not.toHaveBeenCalled();
      expect(f.testFetch).not.toHaveBeenCalled();
    },
  );
  it("connects actual signing/transport to admission, original bootstrap, principal, completion and readiness", async () => {
    const f = fixture();
    await f.client.checkAdmission(f.binding);
    expect(await f.client.bootstrap()).toEqual(f.bootstrapValue);
    expect(await f.client.principal("https://synthetic.invalid/")).toEqual({
      issuer: "https://synthetic.invalid/",
      subject: "synthetic-principal",
    });
    expect(await f.client.claimOriginalCompletion(f.material)).toBe("claimed");
    await f.client.publishReady(f.material);
    expect(f.send).toHaveBeenCalledTimes(5);
    expect(f.checkAdmission).toHaveBeenCalledTimes(10);
    expect(f.claimOriginalCompletion).toHaveBeenCalledWith(f.binding, f.material);
    for (const [binding] of f.checkAdmission.mock.calls)
      expect(Object.keys(binding).sort()).toEqual([
        "allocation",
        "configurationSha256",
        "kind",
        "schemaVersion",
        "scope",
      ]);
    for (const [command] of f.send.mock.calls) {
      expect(command.input.FunctionName).toBe(target);
      expect(command.input.LogType).toBe("None");
      expect((command.input.Payload as Uint8Array).every((v) => v === 0)).toBe(true);
    }
  });
  it.each(["configuration", "epoch", "task", "owner", "request", "recipient"])(
    "refuses changed %s before owner access",
    async (kind) => {
      const f = fixture(),
        input = await f.signed();
      if (kind === "configuration") input.binding.configurationSha256 = "0".repeat(64);
      if (kind === "epoch") input.binding.scope.epochId = id(99);
      if (kind === "task")
        input.binding.allocation.taskArn = input.binding.allocation.taskArn.replace(
          taskId,
          "b".repeat(32),
        );
      if (kind === "owner")
        input.binding.scope.ownerUserId = input.binding.allocation.ownerUserId = id(99);
      if (kind === "request") input.request = { action: "bootstrap" };
      const result = await f.handler(input, {
        invokedFunctionArn: kind === "recipient" ? target.replace(":7", ":8") : target,
      });
      expect(result.outcome).toBe("unavailable");
      expect(f.owners).not.toHaveBeenCalled();
      expect(f.testFetch).not.toHaveBeenCalled();
    },
  );
  it("rejects a cover-letter task proof for the same allocation and request digest", async () => {
    const f = fixture(),
      input = await f.signed();
    input.proof = await createNativeTaskCallerClient({
      targetArn: target,
      enabled: () => true,
      testCredentials: credentials,
      binding: {
        scope: f.binding.scope,
        allocation: f.binding.allocation,
        original: {
          id: id(8),
          documentId: id(4),
          purpose: "provider_dispatch",
          requestSha256: "e".repeat(64),
        },
      },
    }).proof(nativeResumeOwnerRequestDigest(f.binding, input.request));
    expect((await f.handler(input, { invokedFunctionArn: target })).outcome).toBe("unavailable");
    expect(f.testFetch).not.toHaveBeenCalled();
    expect(f.owners).not.toHaveBeenCalled();
  });
  it.each(["session", "account", "role"])(
    "refuses AWS identity with the wrong %s",
    async (kind) => {
      const f = fixture();
      f.testFetch.mockImplementation(
        async () =>
          new Response(
            f.xml(
              kind === "session" ? "b".repeat(32) : taskId,
              kind === "account" ? "999999999999" : "123456789012",
              kind === "role" ? "other-role" : "native-resume",
            ),
            { headers: { "content-type": "text/xml" } },
          ),
      );
      await expect(f.client.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
      expect(f.owners).not.toHaveBeenCalled();
    },
  );
  it("defaults off and refuses expired proof before AWS or owner I/O", async () => {
    const f = fixture(),
      input = await f.signed();
    const off = createNativeResumeOwnerRpcClient({
      binding: f.binding,
      targetArn: target,
      testClient: { send: f.send },
      testCredentials: credentials,
    });
    await expect(off.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
    expect(f.send).not.toHaveBeenCalled();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60001);
    expect((await f.handler(input, { invokedFunctionArn: target })).outcome).toBe("unavailable");
    expect(f.testFetch).not.toHaveBeenCalled();
    expect(f.owners).not.toHaveBeenCalled();
  });
  it("closes request/binding shapes without invoking accessors or accepting provider work", async () => {
    const f = fixture(),
      input = await f.signed(),
      getter = vi.fn();
    const altered = Object.defineProperty({ ...f.binding }, "configurationSha256", {
      get: getter,
      enumerable: true,
    });
    expect(() => nativeResumeTaskBinding(altered)).toThrow("NativeResumeTaskBindingUnavailable");
    expect(getter).not.toHaveBeenCalled();
    for (const request of [
      { action: "work" },
      { action: "evidence" },
      { action: "admit", text: "synthetic" },
      { action: "completion", material: { ...f.material, kind: "cover_letter" } },
    ])
      expect(validateNativeResumeOwnerRpcInput({ ...input, request })).toBe(false);
    expect(
      validateNativeResumeOwnerRpcInput({ ...input, binding: { ...f.binding, original: {} } }),
    ).toBe(false);
    expect(f.owners).not.toHaveBeenCalled();
  });
  it("captures request metadata before signing awaits and withholds acknowledgement after admission changes", async () => {
    const f = fixture(),
      original = structuredClone(f.material);
    const pending = f.client.claimOriginalCompletion(f.material);
    f.material.contentSha256 = "0".repeat(64);
    expect(await pending).toBe("claimed");
    expect(f.claimOriginalCompletion).toHaveBeenCalledWith(f.binding, original);
    f.checkAdmission
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error("synthetic owner changed"));
    expect(await f.client.claimOriginalCompletion(original)).toBe("unavailable");
    expect(f.claimOriginalCompletion).toHaveBeenCalledTimes(2);
  });
  it("withholds a reply when the flag is withdrawn during an owner await", async () => {
    const f = fixture();
    f.bootstrap.mockImplementation(async () => {
      f.enabled.mockReturnValue(false);
      return f.bootstrapValue;
    });
    await expect(f.client.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
  });
  it.each([
    "version",
    "logs",
    "function_error",
    "status",
    "oversized",
    "noncanonical",
    "duplicate_key",
  ])("refuses %s transport responses without retry", async (kind) => {
    const f = fixture();
    f.send.mockImplementation(async (command) => {
      if (!(command.input.Payload instanceof Uint8Array))
        throw Error("SyntheticRpcPayloadUnavailable");
      const input = JSON.parse(new TextDecoder().decode(command.input.Payload));
      const output = await f.handler(input, { invokedFunctionArn: target });
      return {
        StatusCode: kind === "status" ? 202 : 200,
        ExecutedVersion: kind === "version" ? "8" : "7",
        ...(kind === "logs" ? { LogResult: "synthetic" } : {}),
        ...(kind === "function_error" ? { FunctionError: "synthetic" } : {}),
        Payload: new TextEncoder().encode(
          kind === "oversized"
            ? " ".repeat(16385)
            : kind === "duplicate_key"
              ? JSON.stringify(output).replace("{", '{"schemaVersion":1,')
              : (kind === "noncanonical" ? " " : "") + JSON.stringify(output),
        ),
      };
    });
    await expect(f.client.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("keeps an aborted unknown send active until the original promise settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = vi.fn(async () => {
      started?.();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {};
    });
    const client = createNativeResumeOwnerRpcClient({
      binding: f.binding,
      targetArn: target,
      enabled: () => true,
      timeoutMs: 1,
      testCredentials: credentials,
      testClient: { send },
    });
    const first = client.claimOriginalCompletion(f.material);
    await sent;
    await vi.advanceTimersByTimeAsync(10);
    expect(await client.claimOriginalCompletion(f.material)).toBe("unavailable");
    expect(send).toHaveBeenCalledTimes(1);
    finish?.();
    expect(await first).toBe("unavailable");
  });
  it("forbids injected transports and credentials outside the test environment", () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createNativeResumeOwnerRpcClient({
        binding: f.binding,
        targetArn: target,
        testClient: { send: f.send },
        testCredentials: credentials,
      }),
    ).toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
});
