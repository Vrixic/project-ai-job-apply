import { LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { CoverLetterResponseDisposalClient } from "./cover-letter-response-disposal-client.js";
import {
  validateResponseDisposalInput,
  validateResponseDisposalOutput,
} from "./cover-letter-response-disposal-contract.js";
import { createCoverLetterResponseDisposalHandler } from "./cover-letter-response-disposal-handler.js";
import {
  createCoverLetterResponseReconciler,
  createCoverLetterSuccessfulResponseReconciler,
} from "./cover-letter-response-reconciliation.js";
import type { CoverLetterResponseInventory } from "./cover-letter-response-store.js";

const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:7";
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
const cleanup = {
  kind: "response_deleted" as const,
  reference: response,
  terminalStatus: "cancelled" as const,
};
const read = { schemaVersion: 1 as const, action: "read" as const, reference };
const record = {
  schemaVersion: 1 as const,
  action: "record_disposal" as const,
  reference,
  cleanup,
};
const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const error = /^CoverLetterResponseDisposalUnavailable$/u;

function fixture(timeoutMs = 10_000, completedEligibility = false) {
  let enabled = true;
  let inventory: CoverLetterResponseInventory | null = {
    reference,
    state: "acknowledged",
    response,
  };
  const readCompleted = vi.fn(async () => structuredClone(inventory));
  const responses = {
    ...(completedEligibility ? { readCompleted } : {}),
    read: vi.fn(async () => structuredClone(inventory)),
    recordDisposal: vi.fn(async () => {
      inventory = { reference, state: "disposed", response };
    }),
  };
  const handler = createCoverLetterResponseDisposalHandler({
    functionArn: arn,
    responses,
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
  return {
    readCompleted,
    responses,
    handler,
    send,
    maxAttempts,
    transport,
    client: new CoverLetterResponseDisposalClient(arn, transport, () => enabled, timeoutMs),
    disable: () => {
      enabled = false;
    },
    setInventory: (value: CoverLetterResponseInventory | null) => {
      inventory = value;
    },
  };
}

describe("private original-response disposal RPC", () => {
  it("pins the original caller reference before asynchronous SDK configuration", async () => {
    const f = fixture();
    const input = structuredClone(reference);
    f.maxAttempts.mockImplementation(async () => {
      input.requestSha256 = "b".repeat(64);
      return 1;
    });
    expect(await f.client.read(input)).toEqual({ reference, state: "acknowledged", response });
    expect(f.responses.read).toHaveBeenCalledExactlyOnceWith(reference);
  });
  it("detaches owner read results before returning metadata", async () => {
    const f = fixture();
    const value = {
      reference: structuredClone(reference),
      state: "acknowledged" as const,
      response: structuredClone(response),
    };
    f.responses.read.mockResolvedValue(value);
    const output = await f.handler(read, { invokedFunctionArn: arn });
    value.response.responseId = "resp_changed";
    value.reference.requestSha256 = "f".repeat(64);
    expect(output).toEqual({
      ...read,
      outcome: "read",
      inventory: { reference, state: "acknowledged", response },
    });
  });
  it("round-trips inventory and exact positive receipt with fixed maintenance capabilities", async () => {
    const f = fixture();
    expect(await f.client.read(reference)).toEqual({ reference, state: "acknowledged", response });
    await f.client.recordDisposal(reference, cleanup);
    expect(await f.client.read(reference)).toEqual({ reference, state: "disposed", response });
    expect(f.responses.recordDisposal).toHaveBeenCalledExactlyOnceWith(reference, cleanup);
    expect(f.send.mock.calls[0]?.[0].input).toMatchObject({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      LogType: "None",
    });
    expect(Object.getOwnPropertyNames(CoverLetterResponseDisposalClient.prototype).sort()).toEqual([
      "call",
      "constructor",
      "read",
      "readCompleted",
      "recordDisposal",
    ]);
  });
  it.each([null, { reference, state: "reserved" as const, response: null }])(
    "preserves unknown original identity %j",
    async (inventory) => {
      const f = fixture();
      f.setInventory(inventory);
      expect(await f.client.read(reference)).toEqual(inventory);
      expect(f.responses.recordDisposal).not.toHaveBeenCalled();
    },
  );
  it("defaults off on both sides before I/O", async () => {
    const f = fixture();
    await expect(
      new CoverLetterResponseDisposalClient(arn, f.transport).read(reference),
    ).rejects.toThrow(error);
    expect(f.maxAttempts).not.toHaveBeenCalled();
    const handler = createCoverLetterResponseDisposalHandler({
      functionArn: arn,
      responses: f.responses,
    });
    expect(await handler(read, { invokedFunctionArn: arn })).toEqual({
      ...read,
      outcome: "unavailable",
      inventory: null,
    });
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it.each([
    arn.replace(":7", ":8"),
    arn.replace(":7", ":live"),
    arn.replace("synthetic-disposal", "other"),
  ])("withholds inventory at the wrong invoked target %s", async (target) => {
    const f = fixture();
    expect(await f.handler(read, { invokedFunctionArn: target })).toEqual({
      ...read,
      outcome: "unavailable",
      inventory: null,
    });
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { ...read, schemaVersion: 2 },
    { ...read, action: "reserve" },
    { ...read, reference: { ...reference, purpose: "finalize" } },
    { ...read, ownerUserId: reference.id },
    { ...record, action: "record_creation" },
    { ...record, cleanup: { kind: "unresolved" } },
    { ...record, cleanup: { ...cleanup, terminalStatus: "queued" } },
    { ...record, cleanup: { ...cleanup, content: "synthetic forbidden content" } },
  ])("rejects invalid/expanded commands %j before owner I/O", async (value) => {
    const f = fixture();
    expect(validateResponseDisposalInput(value)).toBe(false);
    await expect(f.handler(value, { invokedFunctionArn: arn })).rejects.toThrow(error);
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("rejects accessors without executing getters and sanitizes proxy failures", async () => {
    const f = fixture();
    const getter = vi.fn(() => "response_deleted");
    const value = { reference: response, terminalStatus: "cancelled" };
    Object.defineProperty(value, "kind", { enumerable: true, get: getter });
    await expect(f.client.recordDisposal(reference, value as typeof cleanup)).rejects.toThrow(
      error,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    await expect(f.handler(new Proxy(read, {}), { invokedFunctionArn: arn })).rejects.toThrow(
      error,
    );
    expect(
      validateResponseDisposalInput(
        new Proxy(read, {
          ownKeys: () => {
            throw Error("synthetic");
          },
        }),
      ),
    ).toBe(false);
  });
  it.each([
    { reference: { ...reference, requestSha256: "b".repeat(64) }, state: "acknowledged", response },
    { reference, state: "reserved", response },
    { reference, state: "disposed", response: null },
    { reference, state: "acknowledged", response: { ...response, createdAt: 0 } },
    { reference, state: "acknowledged", response, content: "synthetic" },
  ])("withholds malformed/foreign inventory %j", async (inventory) => {
    const f = fixture();
    f.responses.read.mockResolvedValue(inventory as CoverLetterResponseInventory);
    await expect(f.client.read(reference)).rejects.toThrow(error);
  });
  it.each(["read", "record"] as const)(
    "withholds %s when activation is withdrawn during the owner call",
    async (action) => {
      const f = fixture();
      if (action === "read") {
        f.responses.read.mockImplementation(async () => {
          f.disable();
          return { reference, state: "acknowledged", response };
        });
        await expect(f.client.read(reference)).rejects.toThrow(error);
      } else {
        f.responses.recordDisposal.mockImplementation(async () => {
          f.disable();
        });
        await expect(f.client.recordDisposal(reference, cleanup)).rejects.toThrow(error);
      }
    },
  );
  it("does not retry a lost committed disposal ACK; durable readback recovers it", async () => {
    const f = fixture();
    f.responses.recordDisposal.mockImplementationOnce(async () => {
      f.setInventory({ reference, state: "disposed", response });
      throw Error("SyntheticDiagnosticMustNotEscape");
    });
    await expect(f.client.recordDisposal(reference, cleanup)).rejects.toThrow(error);
    expect(f.responses.recordDisposal).toHaveBeenCalledTimes(1);
    expect((await f.client.read(reference))?.state).toBe("disposed");
  });
  it.each([
    { StatusCode: 202 },
    { ExecutedVersion: "8" },
    { FunctionError: "Unhandled" },
    { LogResult: "synthetic" },
    { Payload: new Uint8Array() },
    { Payload: new Uint8Array(8193) },
    { Payload: new Uint8Array([0xff]) },
    { Payload: wire({ ...read, outcome: "unavailable", inventory: null }) },
    {
      Payload: new TextEncoder().encode(
        ` ${JSON.stringify({ ...read, outcome: "read", inventory: null })}`,
      ),
    },
    {
      Payload: wire({
        ...read,
        reference: { ...reference, id: reference.documentId },
        outcome: "read",
        inventory: null,
      }),
    },
  ])("refuses ambiguous or changed transport acknowledgement %j", async (delta) => {
    const f = fixture();
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...read, outcome: "read", inventory: null }),
      ...delta,
    });
    await expect(f.client.read(reference)).rejects.toThrow(error);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...cleanup, reference: { ...response, responseId: "resp_other" } },
    { ...cleanup, reference: { ...response, createdAt: response.createdAt + 1 } },
    { ...cleanup, terminalStatus: "completed" },
  ])("rejects changed receipt echo %j", async (changed) => {
    const f = fixture();
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...record, cleanup: changed, outcome: "recorded" }),
    });
    await expect(f.client.recordDisposal(reference, cleanup)).rejects.toThrow(error);
  });
  it("refuses SDK retries and stalled configuration without dispatch", async () => {
    const f = fixture(10);
    f.maxAttempts.mockResolvedValue(2);
    await expect(f.client.read(reference)).rejects.toThrow(error);
    f.maxAttempts.mockImplementation(() => new Promise(() => undefined));
    await expect(f.client.read(reference)).rejects.toThrow(error);
    expect(f.send).not.toHaveBeenCalled();
  });
  it("bounds a lost Invoke ACK without effect retry or inferred disposal", async () => {
    const f = fixture(10);
    f.send.mockImplementation(() => new Promise(() => undefined));
    await expect(f.client.recordDisposal(reference, cleanup)).rejects.toThrow(error);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([0, NaN, Infinity, 15_001])("rejects invalid handling deadline %s", (timeout) => {
    const f = fixture();
    expect(
      () => new CoverLetterResponseDisposalClient(arn, f.transport, () => true, timeout),
    ).toThrow(error);
  });
  it("requires an exact numeric qualified ARN", () => {
    const f = fixture();
    expect(
      () => new CoverLetterResponseDisposalClient(arn.replace(":7", ":live"), f.transport),
    ).toThrow(error);
  });
  it("composes abandoned response reconciliation through maintenance-only RPC without settling work", async () => {
    const f = fixture();
    const fenceForCleanup = vi.fn(async () => "pending" as const);
    const stopAndDelete = vi.fn(async () => cleanup);
    const reconcile = createCoverLetterResponseReconciler({
      work: { fenceForCleanup },
      responses: f.client,
      cleanup: { stopAndDelete },
      enabled: () => true,
    });
    const signal = new AbortController().signal;
    expect(await reconcile(reference, signal)).toEqual({ kind: "response_disposed", reference });
    expect(await reconcile(reference, signal)).toEqual({ kind: "response_disposed", reference });
    expect(stopAndDelete).toHaveBeenCalledTimes(1);
    expect(f.responses.recordDisposal).toHaveBeenCalledTimes(1);
  });
  it.each([200, 500])(
    "installed SDK uses exactly one HTTP attempt for status %s",
    async (statusCode) => {
      const handle = vi.fn(async () => ({
        response: {
          statusCode,
          headers: { "x-amz-executed-version": "7", "content-type": "application/json" },
          body: wire(
            statusCode === 200
              ? { ...read, outcome: "read", inventory: null }
              : { message: "SyntheticInternalDiagnostic" },
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
        const client = new CoverLetterResponseDisposalClient(arn, sdk, () => true);
        if (statusCode === 200) expect(await client.read(reference)).toBeNull();
        else await expect(client.read(reference)).rejects.toThrow(error);
        expect(handle).toHaveBeenCalledTimes(1);
      } finally {
        sdk.destroy();
      }
    },
  );
  it("does not accept unavailable output with retained inventory", () => {
    expect(
      validateResponseDisposalOutput({
        ...read,
        outcome: "unavailable",
        inventory: { reference, state: "disposed", response },
      }),
    ).toBe(false);
  });
});

describe("private completed-response eligibility RPC compatibility", () => {
  const completedRead = { ...read, action: "read_completed" as const };
  it("admits closed metadata-only input/output with exact completed-read action", () => {
    expect(validateResponseDisposalInput(completedRead)).toBe(true);
    expect(
      validateResponseDisposalOutput({ ...completedRead, outcome: "read", inventory: null }),
    ).toBe(true);
    expect(
      validateResponseDisposalOutput({ ...completedRead, outcome: "unavailable", inventory: null }),
    ).toBe(true);
  });
  it("dispatches only the owning completed read and preserves ordinary read", async () => {
    const f = fixture(10_000, true);
    expect(await f.client.readCompleted(reference)).toEqual({
      reference,
      state: "acknowledged",
      response,
    });
    expect(f.readCompleted).toHaveBeenCalledExactlyOnceWith(reference);
    expect(f.responses.read).not.toHaveBeenCalled();
    const invoke = f.send.mock.calls[0]?.[0];
    expect(JSON.parse(new TextDecoder().decode(invoke?.input.Payload as Uint8Array))).toEqual(
      completedRead,
    );
    expect(await f.client.read(reference)).toEqual({ reference, state: "acknowledged", response });
    expect(f.responses.read).toHaveBeenCalledExactlyOnceWith(reference);
  });
  it("refuses older handler compositions without ordinary-inventory fallback", async () => {
    const f = fixture();
    expect(await f.handler(completedRead, { invokedFunctionArn: arn })).toEqual({
      ...completedRead,
      outcome: "unavailable",
      inventory: null,
    });
    await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.readCompleted).not.toHaveBeenCalled();
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
    expect(await f.client.read(reference)).toEqual({ reference, state: "acknowledged", response });
  });
  it("rejects an ordinary-read echo as completed eligibility without a fallback call", async () => {
    const f = fixture(10_000, true);
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({
        ...read,
        outcome: "read",
        inventory: { reference, state: "acknowledged", response },
      }),
    });
    await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it("preserves absent eligibility as null without certifying success", async () => {
    const f = fixture(10_000, true);
    f.setInventory(null);
    expect(await f.client.readCompleted(reference)).toBeNull();
    const provider = vi.fn();
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: f.client,
      cleanup: { deleteCompleted: provider },
      enabled: () => true,
    });
    expect(await reconcile(reference, new AbortController().signal)).toEqual({
      kind: "unresolved",
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it("composes success reconciliation through separate completed-read RPC and durable replay", async () => {
    const f = fixture(10_000, true);
    const positive = { ...cleanup, terminalStatus: "completed" as const };
    const provider = vi.fn(async () => positive);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: f.client,
      cleanup: { deleteCompleted: provider },
      enabled: () => true,
    });
    expect(await reconcile(reference, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(await reconcile(reference, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.responses.recordDisposal).toHaveBeenCalledExactlyOnceWith(reference, positive);
    const actions = f.send.mock.calls.map(
      ([command]) =>
        JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)).action,
    );
    expect(actions).toEqual([
      "read_completed",
      "record_disposal",
      "read_completed",
      "read_completed",
    ]);
  });
  it.each([
    { ...completedRead, action: "read_completed_extra" },
    { ...completedRead, userId: reference.id },
    { ...completedRead, content: "synthetic" },
    { ...completedRead, cleanup },
  ])("refuses unknown/content/extra input %#", async (input) => {
    const f = fixture(10_000, true);
    expect(validateResponseDisposalInput(input)).toBe(false);
    await expect(f.handler(input, { invokedFunctionArn: arn })).rejects.toThrow(error);
    expect(f.readCompleted).not.toHaveBeenCalled();
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it.each(["id", "documentId", "requestSha256"] as const)(
    "rejects changed completed-read %s echo",
    async (key) => {
      const f = fixture(10_000, true);
      const changed = {
        ...reference,
        [key]: key === "requestSha256" ? "b".repeat(64) : "019a4000-0000-7000-8000-000000000009",
      };
      f.send.mockResolvedValue({
        StatusCode: 200,
        ExecutedVersion: "7",
        Payload: wire({ ...completedRead, reference: changed, outcome: "read", inventory: null }),
      });
      await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it("defaults off before SDK configuration and handler access", async () => {
    const f = fixture(10_000, true);
    const client = new CoverLetterResponseDisposalClient(arn, f.transport);
    await expect(client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.maxAttempts).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    const handler = createCoverLetterResponseDisposalHandler({
      functionArn: arn,
      responses: { ...f.responses, readCompleted: f.readCompleted },
    });
    expect(await handler(completedRead, { invokedFunctionArn: arn })).toEqual({
      ...completedRead,
      outcome: "unavailable",
      inventory: null,
    });
    expect(f.readCompleted).not.toHaveBeenCalled();
  });
  it("rejects accessors before SDK configuration", async () => {
    const f = fixture(10_000, true);
    const getter = vi.fn(() => reference.id);
    const raw = { ...reference };
    Object.defineProperty(raw, "id", { enumerable: true, get: getter });
    await expect(f.client.readCompleted(raw)).rejects.toThrow(error);
    expect(getter).not.toHaveBeenCalled();
    expect(f.maxAttempts).not.toHaveBeenCalled();
  });
  it("refuses retries without dispatch and bounds lost eligibility ACK", async () => {
    const f = fixture(10, true);
    f.maxAttempts.mockResolvedValue(2);
    await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.send).not.toHaveBeenCalled();
    f.maxAttempts.mockResolvedValue(1);
    f.send.mockImplementation(() => new Promise(() => undefined));
    await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("refuses activation withdrawn during completed eligibility without promoting it", async () => {
    const f = fixture(10_000, true);
    f.readCompleted.mockImplementationOnce(async () => {
      f.disable();
      return { reference, state: "acknowledged", response };
    });
    await expect(f.client.readCompleted(reference)).rejects.toThrow(error);
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it("installed SDK serializes only metadata for completed eligibility with one HTTP attempt", async () => {
    const handle = vi.fn(async (request: { body?: unknown }) => {
      const bytes = request.body;
      const text =
        typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes as Uint8Array);
      expect(JSON.parse(text)).toEqual(completedRead);
      return {
        response: {
          statusCode: 200,
          headers: { "x-amz-executed-version": "7", "content-type": "application/json" },
          body: wire({ ...completedRead, outcome: "read", inventory: null }),
        },
      };
    });
    const sdk = new LambdaClient({
      region: "us-east-2",
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      maxAttempts: 1,
      requestHandler: { handle },
    });
    try {
      const client = new CoverLetterResponseDisposalClient(arn, sdk, () => true);
      expect(await client.readCompleted(reference)).toBeNull();
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      sdk.destroy();
    }
  });
});
