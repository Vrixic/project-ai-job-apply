import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProviderControlInput } from "./cover-letter-provider-control-contract.js";
import type { NativeEvidenceBinding } from "./native-evidence-binding.js";
import { createNativeMaterialControls } from "./native-material-controls.js";
import { createNativeOwnerEvidenceClient } from "./native-owner-evidence-client.js";
import { createNativeOwnerRpcClient } from "./native-owner-rpc-client.js";
import {
  type NativeOwnerEvidence,
  type NativeOwnerRequest,
  type NativeOwnerRpcInput,
  nativeOwnerJson,
  nativeOwnerRequestDigest,
  validateNativeOwnerEvidence,
  validateNativeOwnerRpcInput,
  validateNativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import { createNativeOwnerRpcHandler } from "./native-owner-rpc-handler.js";
import { createNativeTaskCallerClient } from "./native-task-caller-client.js";
import { validateTemporaryMaterialCompletionInput } from "./temporary-material-completion-contract.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-owner:7";
const taskId = "a".repeat(32);
const credentials = {
  accessKeyId: `ASIA${"A".repeat(16)}`,
  secretAccessKey: "synthetic-test-secret-only-never-real",
  sessionToken: "synthetic-session-token-only",
};
function fixture(defaultOff = false) {
  const binding: NativeEvidenceBinding = {
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
    original: {
      id: id(6),
      documentId: id(4),
      purpose: "provider_dispatch",
      requestSha256: "b".repeat(64),
    },
  };
  const evidence: NativeOwnerEvidence = {
    facts: [
      {
        id: id(8),
        kind: "skill",
        key: "skill",
        value: ["TypeScript"],
        verification: "confirmed",
        sensitivity: "standard",
        source: { type: "user", reference: "synthetic" },
        version: 1,
      },
    ],
    job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
  };
  const context = coverLetterContext({ ...evidence, now: new Date() });
  const enabled = vi.fn(() => !defaultOff);
  const testFetch = vi.fn(
    async () =>
      new Response(
        `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-task/${taskId}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${taskId}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
        { status: 200, headers: { "content-type": "text/xml" } },
      ),
  );
  const checkAdmission = vi.fn(async (_binding: Readonly<NativeEvidenceBinding>) => {});
  const load = vi.fn(async () => structuredClone(evidence));
  const work = vi.fn(async (input: unknown) => {
    if (!validateProviderControlInput(input) || input.action === "settle_terminal")
      throw Error("FixtureWorkMissing");
    const request = input;
    if (request.action === "claim")
      return {
        schemaVersion: 1 as const,
        action: "claim" as const,
        documentId: request.documentId,
        outcome: "claimed" as const,
        reference: structuredClone(binding.original),
      };
    return {
      schemaVersion: 1 as const,
      action: request.action,
      documentId: request.documentId,
      outcome: "settled" as const,
      reference: structuredClone(binding.original),
    };
  });
  const completion = vi.fn(async (input: unknown) => {
    if (!validateTemporaryMaterialCompletionInput(input)) throw Error("FixtureCompletionMissing");
    return { ...input, outcome: "claimed" as const };
  });
  const approvedAt = new Date(Date.now() - 1000);
  const bootstrap = vi.fn(async () => ({
    id: id(4),
    ownerUserId: id(2),
    applicationId: id(3),
    jobContextHash: context.jobContextHash,
    confirmedFactsHash: context.confirmedFactsHash,
    noticeVersion: "openai-cover-letter.v1" as const,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 900_000).toISOString(),
  }));
  const owners = vi.fn(async () => ({
    checkAdmission,
    bootstrap,
    evidence: () => ({ load }),
    work,
    completion,
  }));
  const receiver = createNativeOwnerRpcHandler({
    targetArn: target,
    taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
    deployment: binding.allocation,
    owners,
    enabled,
    testFetch,
  });
  const sent: NativeOwnerRpcInput[] = [];
  const bytes: Uint8Array[] = [];
  const send = vi.fn(async (command: InvokeCommand) => {
    const payload = command.input.Payload;
    if (!(payload instanceof Uint8Array)) throw Error("FixturePayloadMissing");
    bytes.push(payload);
    const raw = JSON.parse(new TextDecoder().decode(payload)) as NativeOwnerRpcInput;
    sent.push(raw);
    const result = await receiver(raw, { invokedFunctionArn: target });
    return {
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: new TextEncoder().encode(nativeOwnerJson(result)),
    };
  });
  const options = {
    binding,
    targetArn: target,
    enabled,
    testClient: { send },
    testCredentials: credentials,
  };
  const client = createNativeOwnerRpcClient(options);
  async function input(request: NativeOwnerRequest): Promise<NativeOwnerRpcInput> {
    const signer = createNativeTaskCallerClient({
      binding,
      targetArn: target,
      enabled: () => true,
      testCredentials: credentials,
    });
    const proof = await signer.proof(nativeOwnerRequestDigest(binding, request));
    return structuredClone({ schemaVersion: 1 as const, binding, request, proof });
  }
  return {
    binding,
    evidence,
    context,
    enabled,
    testFetch,
    checkAdmission,
    load,
    work,
    completion,
    owners,
    bootstrap,
    receiver,
    sent,
    bytes,
    send,
    options,
    client,
    input,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("authenticated original native owner RPC", () => {
  it("authenticates and loads the stored scalar approval before task Date conversion", async () => {
    const f = fixture();
    const result = await f.client.bootstrap();
    const stored = await f.bootstrap();
    expect(result).toEqual({
      ...stored,
      approvedAt: new Date(stored.approvedAt),
      expiresAt: new Date(stored.expiresAt),
    });
    expect(f.sent[0]?.request).toEqual({ action: "bootstrap" });
    expect(f.checkAdmission).toHaveBeenCalledTimes(2);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
    expect(f.completion).not.toHaveBeenCalled();
  });
  it.each([
    "ownerUserId",
    "applicationId",
    "id",
    "expired",
    "future",
    "renewed",
    "extra",
    "notice",
    "hash",
  ])("refuses %s bootstrap metadata", async (fault) => {
    const f = fixture();
    const stored = await f.bootstrap();
    const changed = { ...stored } as Record<string, unknown>;
    if (["ownerUserId", "applicationId", "id"].includes(fault)) changed[fault] = id(99);
    if (fault === "expired") {
      changed.expiresAt = new Date(Date.now() - 1).toISOString();
      changed.approvedAt = new Date(Date.parse(String(changed.expiresAt)) - 900_000).toISOString();
    }
    if (fault === "future") {
      changed.approvedAt = new Date(Date.now() + 60_000).toISOString();
      changed.expiresAt = new Date(Date.parse(String(changed.approvedAt)) + 900_000).toISOString();
    }
    if (fault === "renewed")
      changed.expiresAt = new Date(Date.parse(stored.expiresAt) + 1000).toISOString();
    if (fault === "extra") changed.rawResume = "synthetic";
    if (fault === "notice") changed.noticeVersion = "unreviewed.v1";
    if (fault === "hash") changed.jobContextHash = "invalid";
    f.bootstrap.mockResolvedValueOnce(changed as unknown as typeof stored);
    await expect(f.client.bootstrap()).rejects.toThrow("NativeOwnerRpcUnavailable");
    expect(f.work).not.toHaveBeenCalled();
  });
  it("runs actual SDK signing through authentication/admission/evidence and all original scalar controls", async () => {
    const f = fixture();
    const remote = createNativeOwnerEvidenceClient({ ...f.options, context: f.context });
    await remote.checkAdmission(f.binding);
    expect(await remote.source.load(id(2), id(3))).toEqual(f.evidence);
    const consent = new Date(Date.now() + 900_000);
    const controls = createNativeMaterialControls({
      allocation: f.binding.allocation,
      original: f.binding.original,
      consentExpiresAt: consent.toISOString(),
      workFunctionArn: target,
      completionFunctionArn: target,
      enabled: f.enabled,
      testClient: { send: f.send },
      nativeRpc: { binding: f.binding, testCredentials: credentials },
    });
    expect(
      await controls.work.claimProviderDispatch({
        documentId: id(4),
        requestSha256: "b".repeat(64),
        consentExpiresAt: consent,
      }),
    ).toEqual({ kind: "claimed", reference: f.binding.original });
    await controls.work.settleProviderDispatch(f.binding.original);
    const completedAtMs = Date.now();
    const material = {
      schemaVersion: 1 as const,
      kind: "cover_letter" as const,
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      version: 1,
      contentSha256: "c".repeat(64),
      completedAtMs,
      expiresAtMs: completedAtMs + 1800_000,
    };
    expect(await controls.completion.claimOriginalCompletion(material)).toBe("claimed");
    expect(f.sent.map((x) => x.request.action)).toEqual([
      "admit",
      "evidence",
      "work",
      "work",
      "completion",
    ]);
    expect(f.testFetch).toHaveBeenCalledTimes(5);
    expect(f.checkAdmission).toHaveBeenCalledTimes(10);
    expect(f.bytes.every((x) => x.every((byte) => byte === 0))).toBe(true);
    expect(f.evidence.facts[0]?.value).toEqual(["TypeScript"]);
    expect(f.owners.mock.calls.every((x) => x.length === 0)).toBe(true);
  });
  it("defaults off without authentication, owner creation or transport", async () => {
    const f = fixture(true);
    await expect(f.client.checkAdmission(f.binding)).rejects.toThrow("NativeOwnerRpcUnavailable");
    expect(
      (await f.receiver(await f.input({ action: "admit" }), { invokedFunctionArn: target }))
        .outcome,
    ).toBe("unavailable");
    expect(f.testFetch).not.toHaveBeenCalled();
    expect(f.owners).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["request", "recipient", "task", "signature", "deployment", "old_contract"])(
    "refuses %s before owner creation",
    async (fault) => {
      const f = fixture();
      const input = await f.input({ action: "admit" });
      let arn = target;
      if (fault === "request") input.request = { action: "evidence", ...f.context };
      if (fault === "recipient") arn = target.replace(":7", ":8");
      if (fault === "task")
        input.binding.allocation.taskArn = input.binding.allocation.taskArn.replace(
          taskId,
          "c".repeat(32),
        );
      if (fault === "signature")
        f.testFetch.mockImplementationOnce(async () => new Response("denied", { status: 403 }));
      if (fault === "deployment") input.binding.allocation.containerName = "other";
      const raw =
        fault === "old_contract" ? { schemaVersion: 1, action: "claim", documentId: id(4) } : input;
      try {
        expect((await f.receiver(raw, { invokedFunctionArn: arn })).outcome).toBe("unavailable");
      } catch (error) {
        expect(String(error)).toBe("Error: NativeOwnerRpcUnavailable");
      }
      expect(f.owners).not.toHaveBeenCalled();
    },
  );
  it("refuses AWS authentication before SQL/secret initialization", async () => {
    const f = fixture();
    f.testFetch.mockRejectedValueOnce(Error("synthetic credential diagnostics"));
    expect(
      await f.receiver(await f.input({ action: "admit" }), { invokedFunctionArn: target }),
    ).toEqual({
      schemaVersion: 1,
      requestSha256: nativeOwnerRequestDigest(f.binding, { action: "admit" }),
      outcome: "unavailable",
      result: null,
    });
    expect(f.owners).not.toHaveBeenCalled();
  });
  it("holds admission through authentication and refuses concurrent requests", async () => {
    const f = fixture();
    const input = await f.input({ action: "admit" });
    let release!: (response: Response) => void;
    const response = await f.testFetch();
    f.testFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f.receiver(input, { invokedFunctionArn: target });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await f.receiver(input, { invokedFunctionArn: target })).outcome).toBe("unavailable");
    expect(f.owners).not.toHaveBeenCalled();
    release(response);
    expect((await first).outcome).toBe("ready");
  });
  it.each(["before", "after"])(
    "withholds evidence when owning admission fails %s read",
    async (when) => {
      const f = fixture();
      if (when === "before")
        f.checkAdmission.mockRejectedValueOnce(Error("synthetic SQL diagnostics"));
      else
        f.checkAdmission.mockResolvedValueOnce().mockRejectedValueOnce(Error("synthetic revoked"));
      const result = await f.receiver(await f.input({ action: "evidence", ...f.context }), {
        invokedFunctionArn: target,
      });
      expect(result.outcome).toBe("unavailable");
      expect(result.result).toBeNull();
      expect(nativeOwnerJson(result)).not.toContain("TypeScript");
      expect(f.load).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
    },
  );
  it("rechecks feature revocation after owner reads", async () => {
    const f = fixture();
    f.load.mockImplementationOnce(async () => {
      f.enabled.mockReturnValue(false);
      return structuredClone(f.evidence);
    });
    await expect(f.client.run({ action: "evidence", ...f.context })).rejects.toThrow(
      "NativeOwnerRpcUnavailable",
    );
  });
  it("does not release client admission or zero credential bytes until actual pending transport settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture();
    let release!: (value: Awaited<ReturnType<typeof f.send>>) => void;
    let pendingPayload: Uint8Array | undefined;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const send = vi.fn(async (command: InvokeCommand) => {
      pendingPayload = command.input.Payload as Uint8Array;
      return new Promise<Awaited<ReturnType<typeof f.send>>>((resolve) => {
        release = resolve;
        dispatched();
      });
    });
    const client = createNativeOwnerRpcClient({
      ...f.options,
      timeoutMs: 10,
      testClient: { send },
    });
    const pending = client.run({ action: "admit" });
    const refused = expect(pending).rejects.toThrow("NativeOwnerRpcUnavailable");
    await started;
    await vi.advanceTimersByTimeAsync(20);
    await expect(client.run({ action: "admit" })).rejects.toThrow("NativeOwnerRpcUnavailable");
    expect(send).toHaveBeenCalledOnce();
    expect(pendingPayload?.some((x) => x !== 0)).toBe(true);
    release({ StatusCode: 200, ExecutedVersion: "7", Payload: new Uint8Array([123, 125]) });
    await refused;
    expect(pendingPayload?.every((x) => x === 0)).toBe(true);
  });
  it.each(["version", "log", "error", "digest", "extra", "noncanonical"])(
    "refuses malformed %s acknowledgement without retry",
    async (fault) => {
      const f = fixture();
      f.send.mockImplementationOnce(async () => {
        const output: Record<string, unknown> = {
          schemaVersion: 1,
          requestSha256: nativeOwnerRequestDigest(f.binding, { action: "admit" }),
          outcome: "ready",
          result: { admitted: true },
        };
        if (fault === "digest") output.requestSha256 = "c".repeat(64);
        if (fault === "extra") output.proof = "must never echo";
        return {
          StatusCode: 200,
          ExecutedVersion: fault === "version" ? "8" : "7",
          ...(fault === "log" ? { LogResult: "synthetic log" } : {}),
          ...(fault === "error" ? { FunctionError: "synthetic" } : {}),
          Payload: new TextEncoder().encode(
            fault === "noncanonical" ? JSON.stringify(output, null, 2) : nativeOwnerJson(output),
          ),
        };
      });
      await expect(f.client.run({ action: "admit" })).rejects.toThrow("NativeOwnerRpcUnavailable");
      expect(f.send).toHaveBeenCalledOnce();
    },
  );
  it("checks full context before releasing received evidence", async () => {
    const f = fixture();
    f.context.jobContextHash = "c".repeat(64);
    const remote = createNativeOwnerEvidenceClient({ ...f.options, context: f.context });
    await expect(remote.source.load(id(2), id(3))).rejects.toThrow("NativeOwnerRpcUnavailable");
  });
  it.each(["restricted", "extra_fact", "duplicate_fact", "raw_resume", "malformed_span"])(
    "rejects %s in evidence",
    (fault) => {
      const f = fixture();
      const evidence = structuredClone(f.evidence);
      const fact = evidence.facts[0];
      if (!fact) throw Error("FixtureFactMissing");
      if (fault === "restricted") fact.sensitivity = "restricted";
      if (fault === "extra_fact") Object.assign(fact, { extra: "hidden" });
      if (fault === "duplicate_fact") evidence.facts = [...evidence.facts, fact];
      if (fault === "raw_resume") Object.assign(evidence, { resume: "hidden" });
      if (fault === "malformed_span") fact.evidence = { supportingSpans: [{} as never] };
      expect(validateNativeOwnerEvidence(evidence)).toBe(false);
    },
  );
  it("binds canonical request metadata independently of property order and refuses accessors", async () => {
    const f = fixture();
    const raw = await f.input({ action: "admit" });
    expect(validateNativeOwnerRpcInput(raw)).toBe(true);
    expect(nativeOwnerRequestDigest(f.binding, { action: "evidence", ...f.context })).toBe(
      nativeOwnerRequestDigest(f.binding, {
        confirmedFactsHash: f.context.confirmedFactsHash,
        jobContextHash: f.context.jobContextHash,
        action: "evidence",
      }),
    );
    const getter = vi.fn(() => "admit");
    expect(
      validateNativeOwnerRpcInput({
        ...raw,
        request: Object.defineProperty({}, "action", { enumerable: true, get: getter }),
      }),
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(
      validateNativeOwnerRpcOutput(
        {
          schemaVersion: 1,
          requestSha256: nativeOwnerRequestDigest(f.binding, { action: "admit" }),
          outcome: "unavailable",
          result: { proof: raw.proof },
        },
        f.binding,
        { action: "admit" },
      ),
    ).toBe(false);
  });
  it.each(["foreign_work", "terminal", "foreign_completion"])(
    "refuses %s in the versioned transport",
    async (fault) => {
      const f = fixture();
      const raw = await f.input({ action: "admit" });
      if (fault === "foreign_work")
        raw.request = {
          action: "work",
          input: {
            schemaVersion: 1,
            action: "settle",
            documentId: id(4),
            reference: { ...f.binding.original, id: id(9) },
          },
        };
      if (fault === "terminal")
        raw.request = {
          action: "work",
          input: { schemaVersion: 1, action: "settle_terminal" } as never,
        };
      if (fault === "foreign_completion")
        raw.request = {
          action: "completion",
          input: {
            schemaVersion: 1,
            action: "claim_original_completion",
            work: f.binding.original,
            material: {} as never,
          },
        };
      expect(validateNativeOwnerRpcInput(raw)).toBe(false);
      await expect(f.receiver(raw, { invokedFunctionArn: target })).rejects.toThrow(
        "NativeOwnerRpcUnavailable",
      );
      expect(f.testFetch).not.toHaveBeenCalled();
    },
  );
  it("refuses test transports and credentials outside test mode", () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createNativeOwnerRpcClient(f.options)).toThrow("NativeOwnerRpcUnavailable");
    expect(() =>
      createNativeOwnerRpcHandler({
        targetArn: target,
        taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
        deployment: f.binding.allocation,
        owners: f.owners as never,
        testFetch: f.testFetch,
      }),
    ).toThrow("NativeOwnerRpcUnavailable");
  });
});
