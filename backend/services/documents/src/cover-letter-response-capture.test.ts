import { LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { CoverLetterResponseCaptureClient } from "./cover-letter-response-capture-client.js";
import {
  validateResponseCaptureInput,
  validateResponseCaptureOutput,
} from "./cover-letter-response-capture-contract.js";
import { createCoverLetterResponseCaptureHandler } from "./cover-letter-response-capture-handler.js";

const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-capture:7";
const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const response = {
  schemaVersion: 1 as const,
  responseId: "resp_syntheticOriginal",
  createdAt: 1_790_000_000,
};
const reserve = { schemaVersion: 1, action: "reserve", reference };
const creation = { schemaVersion: 1, action: "record_creation", reference, response };
const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture(timeoutMs = 10_000) {
  let enabled = true;
  const capture = {
    reserve: vi.fn(async () => ({ kind: "reserved" as "reserved" | "already_reserved" })),
    recordCreation: vi.fn(async () => undefined),
  };
  const handler = createCoverLetterResponseCaptureHandler({
    functionArn: arn,
    capture,
    enabled: () => enabled,
  });
  const send = vi.fn<CoverLetterProviderLambdaClient["send"]>(async (command) => ({
    StatusCode: 200,
    ExecutedVersion: "7",
    Payload: wire(
      await handler(JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)), {
        invokedFunctionArn: arn,
      }),
    ),
  }));
  const maxAttempts = vi.fn(async () => 1);
  const transport = { send, config: { maxAttempts } };
  const client = new CoverLetterResponseCaptureClient(arn, transport, () => enabled, timeoutMs);
  return {
    capture,
    handler,
    send,
    maxAttempts,
    transport,
    client,
    disable: () => {
      enabled = false;
    },
  };
}

describe("private original-response capture boundary", () => {
  it("sanitizes unclonable reflection objects before any owner call", async () => {
    const f = fixture();
    await expect(
      f.handler(new Proxy({ ...reserve }, {}), { invokedFunctionArn: arn }),
    ).rejects.toThrow(/^CoverLetterResponseCaptureUnavailable$/u);
    expect(f.capture.reserve).not.toHaveBeenCalled();
  });
  it.each([200, 500])("installed SDK serializes one attempt for HTTP %s", async (statusCode) => {
    const handle = vi.fn(async () => ({
      response: {
        statusCode,
        headers: { "x-amz-executed-version": "7", "content-type": "application/json" },
        body: wire(
          statusCode === 200
            ? { ...reserve, outcome: "reserved" }
            : { message: "SyntheticPrivateDiagnostic" },
        ),
      },
    }));
    const sdk = new LambdaClient({
      region: "us-east-2",
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      maxAttempts: 1,
      requestHandler: { handle },
    });
    try {
      const client = new CoverLetterResponseCaptureClient(arn, sdk, () => true);
      if (statusCode === 200)
        await expect(client.reserve(reference)).resolves.toEqual({ kind: "reserved" });
      else
        await expect(client.reserve(reference)).rejects.toThrow(
          "CoverLetterResponseCaptureUnavailable",
        );
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      sdk.destroy();
    }
  });
  it("round-trips reservation and exact creation ACK without another capability", async () => {
    const f = fixture();
    await expect(f.client.reserve(reference)).resolves.toEqual({ kind: "reserved" });
    await f.client.recordCreation(reference, response);
    expect(f.capture.reserve).toHaveBeenCalledExactlyOnceWith(reference);
    expect(f.capture.recordCreation).toHaveBeenCalledExactlyOnceWith(reference, response);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[0]?.[0].input).toMatchObject({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      LogType: "None",
    });
    expect(Object.getOwnPropertyNames(CoverLetterResponseCaptureClient.prototype).sort()).toEqual([
      "call",
      "constructor",
      "recordCreation",
      "reserve",
    ]);
  });
  it("returns already_reserved without granting the original first-winner outcome", async () => {
    const f = fixture();
    f.capture.reserve.mockResolvedValue({ kind: "already_reserved" });
    await expect(f.client.reserve(reference)).resolves.toEqual({ kind: "already_reserved" });
  });
  it("defaults off on both sides before I/O", async () => {
    const f = fixture();
    const client = new CoverLetterResponseCaptureClient(arn, f.transport);
    await expect(client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    const handler = createCoverLetterResponseCaptureHandler({
      functionArn: arn,
      capture: f.capture,
    });
    await expect(handler(reserve, { invokedFunctionArn: arn })).resolves.toMatchObject({
      outcome: "unavailable",
    });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.capture.reserve).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { ...reserve, userId: reference.id },
    { ...creation, content: "synthetic" },
    { ...reserve, action: "dispose" },
    { ...reserve, action: "settle" },
    { ...reserve, schemaVersion: 2 },
    { ...reserve, reference: { ...reference, purpose: "finalize" } },
    { ...creation, response: { ...response, createdAt: 0 } },
    { ...creation, response: { ...response, text: "synthetic" } },
  ])("rejects closed-contract violation %j before owner I/O", async (input) => {
    const f = fixture();
    expect(validateResponseCaptureInput(input)).toBe(false);
    await expect(f.handler(input, { invokedFunctionArn: arn })).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(f.capture.reserve).not.toHaveBeenCalled();
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
  });
  it("rejects getters, hidden/symbol fields, prototypes and hostile reflection", () => {
    const getter = vi.fn(() => reference);
    const value = { schemaVersion: 1, action: "reserve" };
    Object.defineProperty(value, "reference", { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ ...reserve }, "extra", { value: true });
    for (const input of [
      value,
      hidden,
      { ...reserve, [Symbol("extra")]: true },
      Object.assign(Object.create({}), reserve),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw Error("synthetic");
          },
        },
      ),
    ])
      expect(validateResponseCaptureInput(input)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const coercion = vi.fn(() => "reserved");
    expect(validateResponseCaptureOutput({ ...reserve, outcome: { toString: coercion } })).toBe(
      false,
    );
    expect(coercion).not.toHaveBeenCalled();
  });
  it.each([
    arn.replace(":7", ":$LATEST"),
    arn.replace(":7", ":live"),
    arn.replace(":7", ""),
    arn.replace("us-east-2", "us-east-1"),
  ])("rejects unpinned target %s", (target) => {
    const f = fixture();
    expect(() => new CoverLetterResponseCaptureClient(target, f.transport)).toThrow();
    expect(() =>
      createCoverLetterResponseCaptureHandler({ functionArn: target, capture: f.capture }),
    ).toThrow();
  });
  it("refuses target mismatch before store I/O", async () => {
    const f = fixture();
    await expect(
      f.handler(reserve, { invokedFunctionArn: arn.replace(":7", ":8") }),
    ).resolves.toMatchObject({ outcome: "unavailable" });
    expect(f.capture.reserve).not.toHaveBeenCalled();
  });
  it("requires one SDK attempt and rechecks activation before send", async () => {
    const f = fixture();
    f.maxAttempts.mockResolvedValueOnce(2);
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    f.maxAttempts.mockImplementationOnce(async () => {
      f.disable();
      return 1;
    });
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    { StatusCode: 202 },
    { ExecutedVersion: "8" },
    { FunctionError: "synthetic" },
    { LogResult: "synthetic" },
    { Payload: new Uint8Array() },
    { Payload: new Uint8Array(8193) },
    { Payload: new Uint8Array([255]) },
    { Payload: wire({ ...reserve, outcome: "reserved", extra: true }) },
    {
      Payload: wire({
        ...reserve,
        outcome: "reserved",
        reference: { ...reference, requestSha256: "b".repeat(64) },
      }),
    },
  ])("rejects bad original transport receipt %j without retry", async (change) => {
    const f = fixture();
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...reserve, outcome: "reserved" }),
      ...change,
    });
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("refuses a changed creation reference and duplicate-key JSON", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({
        ...creation,
        response: { ...response, createdAt: response.createdAt + 1 },
        outcome: "recorded",
      }),
    });
    await expect(f.client.recordCreation(reference, response)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    f.send.mockResolvedValueOnce({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: new TextEncoder().encode(
        JSON.stringify({ ...reserve, outcome: "reserved" }).replace(
          '"schemaVersion":1',
          '"schemaVersion":1,"schemaVersion":1',
        ),
      ),
    });
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
  });
  it("does not grant a committed reservation whose activation is withdrawn", async () => {
    const f = fixture();
    f.capture.reserve.mockImplementationOnce(async () => {
      f.disable();
      return { kind: "reserved" };
    });
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(f.capture.reserve).toHaveBeenCalledTimes(1);
  });
  it("awaits capture commit and sanitizes committed-but-lost acknowledgements", async () => {
    const f = fixture();
    let committed = false;
    f.capture.recordCreation.mockImplementationOnce(async () => {
      committed = true;
      throw Error("synthetic private SQL");
    });
    await expect(f.client.recordCreation(reference, response)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(committed).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("bounds stalled transport and never redispatches after a local deadline", async () => {
    const f = fixture(10);
    f.send.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(f.client.reserve(reference)).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("snapshots the caller before asynchronous single-attempt configuration", async () => {
    const f = fixture();
    const caller = structuredClone(reference);
    f.maxAttempts.mockImplementationOnce(async () => {
      caller.requestSha256 = "b".repeat(64);
      return 1;
    });
    await f.client.reserve(caller);
    expect(f.capture.reserve).toHaveBeenCalledExactlyOnceWith(reference);
  });
  it("does not let owner ports mutate the echoed original binding", async () => {
    const f = fixture();
    f.capture.reserve.mockImplementationOnce(async (ref?: typeof reference) => {
      if (ref) ref.requestSha256 = "b".repeat(64);
      return { kind: "reserved" };
    });
    await expect(f.client.reserve(reference)).resolves.toEqual({ kind: "reserved" });
  });
});
