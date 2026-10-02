import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  type CoverLetterProviderInput,
  CoverLetterProviderTransportError,
} from "./cover-letter-provider-contract.js";
import {
  CoverLetterProviderInvoker,
  type CoverLetterProviderLambdaClient,
} from "./cover-letter-provider-invoke.js";

const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-cover-letter-provider:7";
const id = "019a4000-0000-7000-8000-000000000001";
const otherId = "019a4000-0000-7000-8000-000000000002";
const input: CoverLetterProviderInput = {
  schemaVersion: 1,
  documentId: id,
  request: {
    objectVersion: "synthetic-version",
    etag: '"synthetic-etag"',
    sha256: "a".repeat(64),
    sizeBytes: 100,
  },
};
const ready = { schemaVersion: 1, documentId: id, outcome: "ready", result: { ...input.request } };
const progress = { schemaVersion: 1, documentId: id, outcome: "in_progress" };
const failed = { schemaVersion: 1, documentId: id, outcome: "failed" };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const response = (value: unknown = ready) => ({
  StatusCode: 200,
  ExecutedVersion: "7",
  Payload: bytes(value),
});
function fixture(settings: { defaultOff?: boolean; timeoutMs?: number } = {}) {
  const send = vi.fn<CoverLetterProviderLambdaClient["send"]>(async () => response());
  const maxAttempts = vi.fn(async () => 1);
  let enabled = true;
  const service = new CoverLetterProviderInvoker(
    arn,
    { send, config: { maxAttempts } },
    settings.defaultOff ? undefined : () => enabled,
    settings.timeoutMs,
  );
  return {
    send,
    maxAttempts,
    service,
    disable: () => {
      enabled = false;
    },
  };
}

describe("private reference-only provider Invoke adapter", () => {
  it.each([200, 500])(
    "uses the real SDK offline with one HTTP attempt for status %s",
    async (statusCode) => {
      const handle = vi.fn(async () => ({
        response: {
          statusCode,
          headers: { "x-amz-executed-version": "7", "content-type": "application/json" },
          body: bytes(statusCode === 200 ? ready : { message: "synthetic private failure" }),
        },
      }));
      const client = new LambdaClient({
        region: "us-east-2",
        maxAttempts: 1,
        credentials: {
          accessKeyId: "synthetic-test-key",
          secretAccessKey: "synthetic-test-secret",
        },
        requestHandler: { handle },
      });
      try {
        const service = new CoverLetterProviderInvoker(arn, client, () => true);
        expect(await service.invoke(input)).toEqual(statusCode === 200 ? ready : progress);
        expect(handle).toHaveBeenCalledTimes(1);
      } finally {
        client.destroy();
      }
    },
  );

  it("defaults off before SDK access", async () => {
    const f = fixture({ defaultOff: true });
    expect(await f.service.invoke(input)).toEqual(failed);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.maxAttempts).not.toHaveBeenCalled();
  });

  it("sends one compact identifier/reference request to the exact numeric version without logs", async () => {
    const f = fixture();
    expect(await f.service.invoke(input)).toEqual(ready);
    expect(f.send).toHaveBeenCalledTimes(1);
    const [command, options] = f.send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(InvokeCommand);
    expect(command?.input).toMatchObject({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      LogType: "None",
    });
    expect(command?.input.Qualifier).toBeUndefined();
    expect(command?.input.ClientContext).toBeUndefined();
    expect(command?.input.DurableExecutionName).toBeUndefined();
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(command?.input.Payload).toEqual(bytes(input));
  });

  it.each([ready, progress, failed])(
    "returns only the strict original response contract: %j",
    async (value) => {
      const f = fixture();
      f.send.mockResolvedValue(response(value));
      expect(await f.service.invoke(input)).toEqual(value);
    },
  );

  it.each([
    arn.replace(":7", ""),
    arn.replace(":7", ":$LATEST"),
    arn.replace(":7", ":live"),
    arn.replace(":7", ":0"),
    arn.replace(":7", ":07"),
    arn.replace("us-east-2", "us-east-1"),
    arn.replace("123456789012", "123"),
    arn.replace("synthetic-cover-letter-provider", "*"),
  ])("refuses an unqualified/unsupported configured target: %s", (target) => {
    const send = vi.fn<CoverLetterProviderLambdaClient["send"]>();
    expect(
      () =>
        new CoverLetterProviderInvoker(target, { send, config: { maxAttempts: async () => 1 } }),
    ).toThrow(CoverLetterProviderTransportError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 75_001, 1.5])(
    "refuses an invalid local deadline %s",
    (timeout) => {
      const f = fixture();
      expect(
        () =>
          new CoverLetterProviderInvoker(
            arn,
            { send: f.send, config: { maxAttempts: f.maxAttempts } },
            () => true,
            timeout,
          ),
      ).toThrow(CoverLetterProviderTransportError);
    },
  );

  it.each([
    { ...input, prompt: "Synthetic private prompt" },
    { ...input, functionArn: arn },
    { ...input, documentId: otherId.toUpperCase() },
    { ...input, request: { ...input.request, objectVersion: "null" } },
    { ...input, request: { ...input.request, etag: "*" } },
    { ...input, request: { ...input.request, text: "Synthetic candidate text" } },
    { ...input, request: { ...input.request, objectVersion: "x".repeat(1_025) } },
  ])("rejects malformed/private/caller-selected input before SDK access: %j", async (value) => {
    const f = fixture();
    await expect(f.service.invoke(value)).rejects.toEqual(new CoverLetterProviderTransportError());
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not execute getters on an invalid input", async () => {
    const f = fixture();
    const getter = vi.fn(() => id);
    const value = { schemaVersion: 1, request: input.request };
    Object.defineProperty(value, "documentId", { enumerable: true, get: getter });
    await expect(f.service.invoke(value)).rejects.toEqual(new CoverLetterProviderTransportError());
    expect(getter).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each([
    { ...response(), StatusCode: 202 },
    { ...response(), ExecutedVersion: "8" },
    { ...response(), ExecutedVersion: "$LATEST" },
    { ...response(), FunctionError: "Unhandled" },
    { ...response(), FunctionError: "" },
    { ...response(), LogResult: "Synthetic private log tail" },
    { ...response(), LogResult: "" },
    { StatusCode: 200, ExecutedVersion: "7" },
    { ...response(), Payload: new Uint8Array() },
    { ...response(), Payload: new Uint8Array(8_193) },
    { ...response(), Payload: new Uint8Array([255]) },
  ])("keeps unsupported/ambiguous receipts in progress without retries: %j", async (value) => {
    const f = fixture();
    f.send.mockResolvedValue(value);
    expect(await f.service.invoke(input)).toEqual(progress);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...ready, documentId: otherId },
    { ...ready, schemaVersion: 2 },
    { ...ready, text: "Synthetic private result" },
    { ...ready, result: { ...ready.result, text: "Synthetic private result" } },
    { ...ready, result: { ...ready.result, sha256: "wrong" } },
    { ...ready, outcome: "failed" },
    { ...failed, reason: "Synthetic private provider error" },
    "Synthetic candidate text",
  ])("withholds malformed or value-bearing function results: %j", async (value) => {
    const f = fixture();
    f.send.mockResolvedValue(response(value));
    expect(await f.service.invoke(input)).toEqual(progress);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    '{"schemaVersion":1,"documentId":"synthetic",',
    JSON.stringify(failed).replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1'),
    JSON.stringify(failed).replace('"schemaVersion"', '"schema\\u0056ersion"'),
  ])("refuses invalid/noncompact/ambiguous JSON: %s", async (text) => {
    const f = fixture();
    f.send.mockResolvedValue({ ...response(), Payload: new TextEncoder().encode(text) });
    expect(await f.service.invoke(input)).toEqual(progress);
  });

  it("snapshots the owned reference before the caller can mutate it during Invoke", async () => {
    const f = fixture();
    const mutable = structuredClone(input);
    let finish: () => void = () => undefined;
    let enter: () => void = () => undefined;
    const dispatched = new Promise<void>((resolve) => {
      enter = resolve;
    });
    f.send.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finish = () => resolve(response());
          enter();
        }),
    );
    const pending = f.service.invoke(mutable);
    await dispatched;
    mutable.documentId = otherId;
    mutable.request.sha256 = "f".repeat(64);
    finish();
    expect(await pending).toEqual(ready);
    expect(f.send.mock.calls[0]?.[0].input.Payload).toEqual(bytes(input));
  });

  it("keeps lost Invoke acknowledgements in progress and never exposes SDK errors/logs", async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error("Synthetic private credential/provider diagnostic"));
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    try {
      expect(await f.service.invoke(input)).toEqual(progress);
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("bounds a stalled Invoke without claiming remote quiescence or retrying", async () => {
    const f = fixture({ timeoutMs: 20 });
    f.send.mockImplementation(async () => new Promise(() => undefined));
    expect(await f.service.invoke(input)).toEqual(progress);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
  });

  it.each([0, 2, Number.NaN])(
    "refuses a non-single-attempt SDK configuration %s before Invoke",
    async (attempts) => {
      const f = fixture();
      f.maxAttempts.mockResolvedValue(attempts);
      expect(await f.service.invoke(input)).toEqual(failed);
      expect(f.send).not.toHaveBeenCalled();
    },
  );

  it("rechecks the kill switch after resolving SDK retry policy", async () => {
    const f = fixture();
    f.maxAttempts.mockImplementation(async () => {
      f.disable();
      return 1;
    });
    expect(await f.service.invoke(input)).toEqual(failed);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("refuses an already-cancelled local call before Invoke", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.service.invoke(input, controller.signal)).toEqual(failed);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("propagates local cancellation after dispatch as an ambiguous outcome", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.send.mockImplementation(async () => {
      controller.abort();
      return new Promise(() => undefined);
    });
    expect(await f.service.invoke(input, controller.signal)).toEqual(progress);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});
