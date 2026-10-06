import { type InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import { createNativeMaterialControls } from "./native-material-controls.js";
import { createTemporaryMaterialCompletionHandler } from "./temporary-material-completion-handler.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const allocation = {
  allocationId: id(1),
  ownerUserId: id(2),
  applicationId: id(3),
  generationId: id(4),
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
  containerName: "material",
};
const original = {
  id: id(5),
  documentId: id(4),
  purpose: "provider_dispatch" as const,
  requestSha256: "b".repeat(64),
};
const workTarget = "arn:aws:lambda:us-east-2:123456789012:function:original-work:9";
const completionTarget = "arn:aws:lambda:us-east-2:123456789012:function:original-completion:7";
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function material(): TemporaryMaterialReference {
  const now = Date.now();
  return {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: id(4),
    ownerUserId: id(2),
    applicationId: id(3),
    version: 1,
    contentSha256: "c".repeat(64),
    completedAtMs: now,
    expiresAtMs: now + 1_800_000,
  };
}
function fixture(enabled = () => true, timeoutMs?: number) {
  const consentExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const store = {
    claimProviderDispatch: vi.fn(async () => ({
      kind: "claimed" as const,
      reference: { ...original },
    })),
    settleProviderDispatch: vi.fn(async () => {}),
    settleRejectedProviderDispatch: vi.fn(async () => {}),
    settleUndispatchedProviderDispatch: vi.fn(async () => {}),
  };
  const completionStore = { claimOriginalCompletion: vi.fn(async () => "claimed" as const) };
  const work = createCoverLetterProviderControlHandler({
    functionArn: workTarget,
    work: store,
    enabled: () => true,
  });
  const complete = createTemporaryMaterialCompletionHandler({
    functionArn: completionTarget,
    store: completionStore,
    enabled: () => true,
  });
  const send = vi.fn(async (command: InvokeCommand, _options: { abortSignal: AbortSignal }) => {
    const target = command.input.FunctionName ?? "";
    const input = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
    const result =
      target === workTarget
        ? await work(input, { invokedFunctionArn: target })
        : await complete(input, { invokedFunctionArn: target });
    return {
      StatusCode: 200,
      ExecutedVersion: target === workTarget ? "9" : "7",
      Payload: encode(result),
    };
  });
  const options = {
    allocation: { ...allocation },
    original: { ...original },
    consentExpiresAt,
    workFunctionArn: workTarget,
    completionFunctionArn: completionTarget,
    enabled,
    testClient: { send },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const ports = createNativeMaterialControls(options);
  const claim = {
    documentId: original.documentId,
    requestSha256: original.requestSha256,
    consentExpiresAt: new Date(consentExpiresAt),
  };
  return { ports, send, store, completionStore, options, claim };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("one native allocation scalar control capabilities", () => {
  it("pins original version two and refuses version one without consuming completion", async () => {
    const f = fixture();
    const options = { ...f.options, documentVersion: 2 };
    const ports = createNativeMaterialControls(options);
    options.documentVersion = 3;
    expect(await ports.work.claimProviderDispatch(f.claim)).toMatchObject({ kind: "claimed" });
    await ports.work.settleProviderDispatch(original);
    expect(await ports.completion.claimOriginalCompletion(material())).toBe("unavailable");
    expect(f.completionStore.claimOriginalCompletion).not.toHaveBeenCalled();
    expect(await ports.completion.claimOriginalCompletion({ ...material(), version: 2 })).toBe(
      "claimed",
    );
    expect(f.completionStore.claimOriginalCompletion).toHaveBeenCalledOnce();
  });
  it.each([0, -1, 1.5, NaN, 2_147_483_648])(
    "refuses invalid pinned version %s before control effects",
    (documentVersion) => {
      const f = fixture();
      expect(() => createNativeMaterialControls({ ...f.options, documentVersion })).toThrow(
        "NativeMaterialControlsUnavailable",
      );
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it("exposes only frozen original work and completion ports", () => {
    const { ports } = fixture();
    expect(Object.keys(ports)).toEqual(["work", "completion"]);
    expect(Object.keys(ports.work)).toEqual([
      "claimProviderDispatch",
      "settleProviderDispatch",
      "settleRejectedProviderDispatch",
      "settleUndispatchedProviderDispatch",
    ]);
    expect(Object.keys(ports.completion)).toEqual(["claimOriginalCompletion"]);
    expect([ports, ports.work, ports.completion].every(Object.isFrozen)).toBe(true);
  });
  it("defaults off before SDK/owning effects", async () => {
    const f = fixture();
    const options: Parameters<typeof createNativeMaterialControls>[0] = { ...f.options };
    delete options.enabled;
    const ports = createNativeMaterialControls(options);
    await expect(ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(ports.completion.claimOriginalCompletion(material())).resolves.toBe("unavailable");
    await expect(ports.work.settleProviderDispatch(original)).rejects.toThrow(
      "NativeMaterialControlsUnavailable",
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it("connects existing handlers with original claim, positive settlement and one original completion", async () => {
    const f = fixture();
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "claimed",
      reference: original,
    });
    await f.ports.work.settleProviderDispatch(original);
    const value = material();
    await expect(f.ports.completion.claimOriginalCompletion(value)).resolves.toBe("claimed");
    expect(f.store.claimProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.claim);
    expect(f.store.settleProviderDispatch).toHaveBeenCalledExactlyOnceWith(original);
    expect(f.completionStore.claimOriginalCompletion).toHaveBeenCalledExactlyOnceWith(
      original,
      value,
    );
    expect(f.send).toHaveBeenCalledTimes(3);
    for (const [command] of f.send.mock.calls)
      expect(command.input).toMatchObject({ InvocationType: "RequestResponse", LogType: "None" });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow(
      "NativeMaterialControlsUnavailable",
    );
    await expect(f.ports.completion.claimOriginalCompletion(value)).resolves.toBe("unavailable");
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it.each(["settleRejectedProviderDispatch", "settleUndispatchedProviderDispatch"] as const)(
    "%s cannot grant material completion",
    async (method) => {
      const f = fixture();
      await f.ports.work.claimProviderDispatch(f.claim);
      await f.ports.work[method](original);
      await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe(
        "unavailable",
      );
      await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow(
        "NativeMaterialControlsUnavailable",
      );
      expect(f.completionStore.claimOriginalCompletion).not.toHaveBeenCalled();
    },
  );
  it("does not settle or complete before acknowledged original claim", async () => {
    const f = fixture();
    await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow();
    await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe(
      "unavailable",
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["documentId", "requestSha256", "consentExpiresAt"] as const)(
    "refuses foreign claim %s before effects without consuming valid admission",
    async (key) => {
      const f = fixture();
      const raw = {
        ...f.claim,
        [key]: key === "consentExpiresAt" ? new Date(Date.now() + 90_000) : "foreign",
      };
      await expect(f.ports.work.claimProviderDispatch(raw)).resolves.toEqual({
        kind: "unavailable",
      });
      expect(f.send).not.toHaveBeenCalled();
      await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toMatchObject({
        kind: "claimed",
      });
    },
  );
  it("never executes hidden/accessor input or consent date methods", async () => {
    const f = fixture();
    const getter = vi.fn();
    const bad = Object.defineProperty({ ...f.claim }, "requestSha256", {
      get: getter,
      enumerable: true,
    });
    await expect(f.ports.work.claimProviderDispatch(bad)).resolves.toEqual({ kind: "unavailable" });
    expect(getter).not.toHaveBeenCalled();
    const date = new Date(f.claim.consentExpiresAt);
    const custom = vi.fn(() => "foreign");
    date.toISOString = custom;
    await f.ports.work.claimProviderDispatch({ ...f.claim, consentExpiresAt: date });
    expect(custom).not.toHaveBeenCalled();
  });
  it("pins detached allocation/work/configuration before effects", async () => {
    const f = fixture();
    f.options.allocation.ownerUserId = id(88);
    f.options.original.id = id(88);
    f.options.workFunctionArn = "foreign";
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toMatchObject({
      kind: "claimed",
    });
    await f.ports.work.settleProviderDispatch(original);
    await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe("claimed");
  });
  it("refuses another returned work ID even with the same document/hash", async () => {
    const f = fixture();
    f.store.claimProviderDispatch.mockResolvedValueOnce({
      kind: "claimed",
      reference: { ...original, id: id(88) },
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["id", "documentId", "requestSha256", "purpose"] as const)(
    "refuses settlement retarget %s without spending original settlement",
    async (key) => {
      const f = fixture();
      await f.ports.work.claimProviderDispatch(f.claim);
      const wrong = { ...original, [key]: "foreign" };
      await expect(f.ports.work.settleProviderDispatch(wrong)).rejects.toThrow(
        "NativeMaterialControlsUnavailable",
      );
      expect(f.send).toHaveBeenCalledTimes(1);
      await f.ports.work.settleProviderDispatch(original);
    },
  );
  it.each(["ownerUserId", "applicationId", "generationId", "kind", "version"] as const)(
    "refuses completion retarget %s before Invoke",
    async (key) => {
      const f = fixture();
      await f.ports.work.claimProviderDispatch(f.claim);
      await f.ports.work.settleProviderDispatch(original);
      const wrong = {
        ...material(),
        [key]: key === "version" ? 2 : key === "kind" ? "tailored_resume" : id(88),
      };
      await expect(f.ports.completion.claimOriginalCompletion(wrong)).resolves.toBe("unavailable");
      expect(f.send).toHaveBeenCalledTimes(2);
      await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe("claimed");
    },
  );
  it.each(["future", "expired"])("refuses %s original completion time", async (mode) => {
    const f = fixture();
    await f.ports.work.claimProviderDispatch(f.claim);
    await f.ports.work.settleProviderDispatch(original);
    const at = Date.now() + (mode === "future" ? 60_000 : -1_800_001);
    const value = { ...material(), completedAtMs: at, expiresAtMs: at + 1_800_000 };
    await expect(f.ports.completion.claimOriginalCompletion(value)).resolves.toBe("unavailable");
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("lost original claim acknowledgement never retries or grants settlement", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(Error("synthetic-private-diagnostic"));
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow(
      /^NativeMaterialControlsUnavailable$/u,
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("lost settlement acknowledgement cannot be retried or grant completion", async () => {
    const f = fixture();
    await f.ports.work.claimProviderDispatch(f.claim);
    f.send.mockRejectedValueOnce(Error("synthetic-private-diagnostic"));
    await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow(
      /^NativeMaterialControlsUnavailable$/u,
    );
    await expect(f.ports.work.settleRejectedProviderDispatch(original)).rejects.toThrow();
    await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe(
      "unavailable",
    );
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("lost completion acknowledgement never invokes original completion twice", async () => {
    const f = fixture();
    await f.ports.work.claimProviderDispatch(f.claim);
    await f.ports.work.settleProviderDispatch(original);
    f.send.mockRejectedValueOnce(Error("synthetic-private-diagnostic"));
    await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe(
      "unavailable",
    );
    await expect(f.ports.completion.claimOriginalCompletion(material())).resolves.toBe(
      "unavailable",
    );
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it("a transport ignoring abort retains admission until actual original settlement", async () => {
    const f = fixture(() => true, 5);
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const normal = f.send.getMockImplementation();
    if (!normal) throw Error("SyntheticTransportMissing");
    f.send.mockImplementationOnce(async (command, options) => {
      await held;
      return normal(command, options);
    });
    let settled = false;
    const pending = f.ports.work.claimProviderDispatch(f.claim).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
    expect(f.send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.settleProviderDispatch(original)).rejects.toThrow();
    expect(f.send).toHaveBeenCalledTimes(1);
    release?.();
    await expect(pending).resolves.toEqual({ kind: "unavailable" });
    expect(settled).toBe(true);
  });
  it("withdrawn activation withholds a fulfilled remote claim", async () => {
    let enabled = true;
    const f = fixture(() => enabled);
    const normal = f.send.getMockImplementation();
    if (!normal) throw Error("SyntheticTransportMissing");
    f.send.mockImplementationOnce(async (command, options) => {
      const reply = await normal(command, options);
      enabled = false;
      return reply;
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(f.store.claimProviderDispatch).toHaveBeenCalledOnce();
  });
  it.each([
    { StatusCode: 202 },
    { ExecutedVersion: "10" },
    { FunctionError: "Unhandled" },
    { LogResult: "synthetic" },
    { Payload: new Uint8Array() },
    { Payload: new Uint8Array(8_193) },
    { Payload: new Uint8Array([0xff]) },
    {
      Payload: encode({
        schemaVersion: 1,
        action: "claim",
        documentId: original.documentId,
        outcome: "claimed",
        reference: { ...original, requestSha256: "d".repeat(64) },
      }),
    },
    {
      Payload: encode({
        schemaVersion: 1,
        action: "claim",
        documentId: id(88),
        outcome: "claimed",
        reference: original,
      }),
    },
    {
      Payload: encode({
        schemaVersion: 1,
        action: "claim",
        documentId: original.documentId,
        outcome: "claimed",
        reference: original,
        content: "synthetic",
      }),
    },
    {
      Payload: new TextEncoder().encode(
        ` ${JSON.stringify({ schemaVersion: 1, action: "claim", documentId: original.documentId, outcome: "claimed", reference: original })}`,
      ),
    },
  ])("refuses corrupted acknowledgement without another claim", async (change) => {
    const f = fixture();
    f.send.mockResolvedValueOnce({
      StatusCode: 200,
      ExecutedVersion: "9",
      Payload: encode({
        schemaVersion: 1,
        action: "claim",
        documentId: original.documentId,
        outcome: "claimed",
        reference: original,
      }),
      ...change,
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(f.ports.work.claimProviderDispatch(f.claim)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("keeps already-completed acknowledgement read-only with no second completion call", async () => {
    const f = fixture();
    await f.ports.work.claimProviderDispatch(f.claim);
    await f.ports.work.settleProviderDispatch(original);
    const value = material();
    f.send.mockResolvedValueOnce({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: encode({
        schemaVersion: 1,
        action: "claim_original_completion",
        work: original,
        material: value,
        outcome: "already_completed",
      }),
    });
    await expect(f.ports.completion.claimOriginalCompletion(value)).resolves.toBe(
      "already_completed",
    );
    await expect(f.ports.completion.claimOriginalCompletion(value)).resolves.toBe("unavailable");
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it("uses normal signed SDK serialization with fixed endpoint despite override", async () => {
    const sdkSend = LambdaClient.prototype.send;
    const requests: Array<{
      hostname: string;
      path: string;
      headers: Record<string, string>;
      body: Uint8Array;
    }> = [];
    vi.spyOn(LambdaClient.prototype, "send").mockImplementation(function (
      this: LambdaClient,
      ...args: Parameters<typeof sdkSend>
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
                body: encode({
                  schemaVersion: 1,
                  action: "claim",
                  documentId: original.documentId,
                  outcome: "claimed",
                  reference: original,
                }),
              },
            };
          },
        },
      });
      return Reflect.apply(sdkSend, this, args);
    });
    vi.stubEnv("AWS_ENDPOINT_URL_LAMBDA", "https://synthetic.invalid");
    const f = fixture();
    const options: Parameters<typeof createNativeMaterialControls>[0] = { ...f.options };
    delete options.testClient;
    const ports = createNativeMaterialControls(options);
    await expect(ports.work.claimProviderDispatch(f.claim)).resolves.toMatchObject({
      kind: "claimed",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.hostname).toBe("lambda.us-east-2.amazonaws.com");
    expect(requests[0]?.path).toContain(encodeURIComponent(workTarget));
    expect(requests[0]?.headers.authorization).toContain("/us-east-2/lambda/aws4_request");
    expect(JSON.parse(new TextDecoder().decode(requests[0]?.body))).toEqual({
      schemaVersion: 1,
      action: "claim",
      documentId: original.documentId,
      requestSha256: original.requestSha256,
      consentExpiresAt: f.claim.consentExpiresAt.toISOString(),
    });
  });
  it("rejects test transport in production", () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createNativeMaterialControls(f.options)).toThrow(
      "NativeMaterialControlsUnavailable",
    );
  });
  it.each([
    { workFunctionArn: workTarget.replace(":9", ":$LATEST") },
    { completionFunctionArn: workTarget },
    { consentExpiresAt: "invalid" },
    { timeoutMs: 0 },
    { workFunctionArn: workTarget.replace("123456789012", "999999999999") },
    { allocation: { ...allocation, ownerUserId: "foreign" } },
    { original: { ...original, documentId: id(88) } },
    { original: { ...original, text: "synthetic forbidden" } },
  ])("refuses invalid immutable configuration before SDK creation", (change) => {
    const f = fixture();
    expect(() => createNativeMaterialControls({ ...f.options, ...change })).toThrow(
      "NativeMaterialControlsUnavailable",
    );
    expect(f.send).not.toHaveBeenCalled();
  });
});
