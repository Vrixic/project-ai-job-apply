import { LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterProviderControlClient } from "./cover-letter-provider-control-client.js";
import {
  type CoverLetterProviderControlInput,
  type CoverLetterProviderControlOutput,
  validateProviderControlInput,
  validateProviderControlOutput,
} from "./cover-letter-provider-control-contract.js";
import { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";

const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:7";
const documentId = "019a4000-0000-7000-8000-000000000001";
const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId,
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const binding = {
  documentId,
  requestSha256: reference.requestSha256,
  consentExpiresAt: new Date("2026-10-02T12:15:00.000Z"),
};
const claim: CoverLetterProviderControlInput = {
  schemaVersion: 1,
  action: "claim",
  documentId,
  requestSha256: reference.requestSha256,
  consentExpiresAt: binding.consentExpiresAt.toISOString(),
};
const settle: CoverLetterProviderControlInput = {
  schemaVersion: 1,
  action: "settle",
  documentId,
  reference,
};
const claimed: CoverLetterProviderControlOutput = {
  schemaVersion: 1,
  action: "claim",
  documentId,
  outcome: "claimed",
  reference,
};
const settled: CoverLetterProviderControlOutput = {
  schemaVersion: 1,
  action: "settle",
  documentId,
  outcome: "settled",
  reference,
};
const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function fixture() {
  let enabled = true;
  const work = {
    claimProviderDispatch: vi.fn(async () => ({ kind: "claimed" as const, reference })),
    settleProviderDispatch: vi.fn(async () => undefined),
  };
  const handler = createCoverLetterProviderControlHandler({
    functionArn: arn,
    work,
    enabled: () => enabled,
  });
  const send = vi.fn<CoverLetterProviderLambdaClient["send"]>(async (command) => {
    if (!(command.input.Payload instanceof Uint8Array)) throw Error("SyntheticMissingPayload");
    const input: unknown = JSON.parse(new TextDecoder().decode(command.input.Payload));
    return {
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire(await handler(input, { invokedFunctionArn: arn })),
    };
  });
  const maxAttempts = vi.fn(async () => 1);
  const client = new CoverLetterProviderControlClient(
    arn,
    { send, config: { maxAttempts } },
    () => enabled,
  );
  return {
    work,
    handler,
    send,
    maxAttempts,
    client,
    disable: () => {
      enabled = false;
    },
  };
}

describe("approved private provider-control contract and source-only transport", () => {
  it.each([":live", ":$LATEST", ":0", ":007", "", ":1000000000"])(
    "refuses non-numeric or unsafe target suffix %s",
    (suffix) => {
      const f = fixture();
      expect(
        () =>
          new CoverLetterProviderControlClient(arn.replace(/:7$/u, suffix), {
            send: f.send,
            config: { maxAttempts: f.maxAttempts },
          }),
      ).toThrow(/^CoverLetterProviderControlUnavailable$/u);
    },
  );
  it.each([0, -1, 15_001, Number.NaN])("refuses invalid RPC timeout %s", (timeout) => {
    const f = fixture();
    expect(
      () =>
        new CoverLetterProviderControlClient(
          arn,
          { send: f.send, config: { maxAttempts: f.maxAttempts } },
          () => true,
          timeout,
        ),
    ).toThrow(/^CoverLetterProviderControlUnavailable$/u);
  });
  it("composes exact claim/settle only, never sends owner identifiers or candidate values", async () => {
    const f = fixture();
    expect(await f.client.claimProviderDispatch(binding)).toEqual({ kind: "claimed", reference });
    await f.client.settleProviderDispatch(reference);
    expect(f.work.claimProviderDispatch).toHaveBeenCalledWith(binding);
    expect(f.work.settleProviderDispatch).toHaveBeenCalledWith(reference);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls.map(([command]) => command.input)).toEqual(
      [claim, settle].map((input) => ({
        FunctionName: arn,
        InvocationType: "RequestResponse",
        LogType: "None",
        Payload: wire(input),
      })),
    );
    expect("issue" in f.client).toBe(false);
    expect("recordSettled" in f.client).toBe(false);
  });
  it("defaults off on both sides before any SDK or control I/O", async () => {
    const f = fixture();
    const client = new CoverLetterProviderControlClient(arn, {
      send: f.send,
      config: { maxAttempts: f.maxAttempts },
    });
    expect(await client.claimProviderDispatch(binding)).toEqual({ kind: "unavailable" });
    await expect(client.settleProviderDispatch(reference)).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    const handler = createCoverLetterProviderControlHandler({ functionArn: arn, work: f.work });
    expect((await handler(claim, { invokedFunctionArn: arn })).outcome).toBe("unavailable");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.maxAttempts).not.toHaveBeenCalled();
    expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["wrong-version", "alias", "unqualified"])(
    "rejects a %s invocation target before SQL",
    async (kind) => {
      const f = fixture();
      const target =
        kind === "wrong-version"
          ? arn.replace(/:7$/u, ":8")
          : kind === "alias"
            ? arn.replace(/:7$/u, ":live")
            : arn.replace(/:7$/u, "");
      expect((await f.handler(claim, { invokedFunctionArn: target })).outcome).toBe("unavailable");
      expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "owner",
    "text",
    "version",
    "action",
    "date",
    "document",
    "hash",
    "prototype",
    "getter",
  ])("rejects malformed claim %s before control I/O", async (kind) => {
    const f = fixture();
    const raw: Record<string, unknown> = { ...claim };
    if (kind === "owner") raw.ownerUserId = documentId;
    if (kind === "text") raw.prompt = "SyntheticPrivateDiagnostic";
    if (kind === "version") raw.schemaVersion = 2;
    if (kind === "action") raw.action = "issue";
    if (kind === "date") raw.consentExpiresAt = "2026-10-02T12:15:00Z";
    if (kind === "document") raw.documentId = "invalid";
    if (kind === "hash") raw.requestSha256 = "invalid";
    if (kind === "prototype") Object.setPrototypeOf(raw, { injected: true });
    if (kind === "getter")
      Object.defineProperty(raw, "documentId", {
        enumerable: true,
        get: () => {
          throw Error("SyntheticPrivateDiagnostic");
        },
      });
    expect(validateProviderControlInput(raw)).toBe(false);
    await expect(f.handler(raw, { invokedFunctionArn: arn })).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["private_slots", "final_document"])(
    "refuses %s settlement on both sides",
    async (purpose) => {
      const f = fixture();
      const raw = { ...settle, reference: { ...reference, purpose } };
      expect(validateProviderControlInput(raw)).toBe(false);
      await expect(f.handler(raw, { invokedFunctionArn: arn })).rejects.toThrow(
        /^CoverLetterProviderControlUnavailable$/u,
      );
      await expect(
        f.client.settleProviderDispatch(raw.reference as typeof reference),
      ).rejects.toThrow(/^CoverLetterProviderControlUnavailable$/u);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "status",
    "version",
    "function",
    "log",
    "body",
    "size",
    "action",
    "document",
    "hash",
    "purpose",
    "extra",
    "whitespace",
    "duplicate",
  ])("refuses ambiguous %s claim responses without retry", async (kind) => {
    const f = fixture();
    const output = structuredClone(claimed);
    const response: {
      StatusCode: number;
      ExecutedVersion: string;
      Payload: Uint8Array;
      FunctionError?: string;
      LogResult?: string;
    } = { StatusCode: 200, ExecutedVersion: "7", Payload: wire(output) };
    if (kind === "status") response.StatusCode = 202;
    if (kind === "version") response.ExecutedVersion = "8";
    if (kind === "function") response.FunctionError = "SyntheticPrivateDiagnostic";
    if (kind === "log") response.LogResult = "SyntheticPrivateDiagnostic";
    if (kind === "body") response.Payload = new Uint8Array([255]);
    if (kind === "size") response.Payload = new Uint8Array(8_193);
    if (kind === "action") response.Payload = wire(settled);
    if (kind === "document") response.Payload = wire({ ...output, documentId: reference.id });
    if (kind === "hash")
      response.Payload = wire({
        ...output,
        reference: { ...reference, requestSha256: "f".repeat(64) },
      });
    if (kind === "purpose")
      response.Payload = wire({ ...output, reference: { ...reference, purpose: "private_slots" } });
    if (kind === "extra")
      response.Payload = wire({ ...output, text: "SyntheticPrivateDiagnostic" });
    if (kind === "whitespace")
      response.Payload = new TextEncoder().encode(` ${JSON.stringify(output)}`);
    if (kind === "duplicate")
      response.Payload = new TextEncoder().encode(
        JSON.stringify(output).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      );
    f.send.mockResolvedValue(response);
    expect(await f.client.claimProviderDispatch(binding)).toEqual({ kind: "unavailable" });
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("does not fabricate settlement from an unavailable acknowledgement", async () => {
    const f = fixture();
    f.work.settleProviderDispatch.mockRejectedValue(Error("SyntheticPrivateDiagnostic"));
    await expect(f.client.settleProviderDispatch(reference)).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    expect(f.send).toHaveBeenCalledOnce();
  });
  it.each(["id", "hash"])("requires the exact original settlement reference %s", async (field) => {
    const f = fixture();
    const other = { ...reference };
    if (field === "id") other.id = documentId;
    else other.requestSha256 = "f".repeat(64);
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...settled, reference: other }),
    });
    await expect(f.client.settleProviderDispatch(reference)).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("does not grant effects after control is disabled during a committed claim", async () => {
    const f = fixture();
    f.work.claimProviderDispatch.mockImplementation(async () => {
      f.disable();
      return { kind: "claimed", reference };
    });
    expect((await f.handler(claim, { invokedFunctionArn: arn })).outcome).toBe("unavailable");
    expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
  });
  it("rechecks the kill switch after SDK policy loading", async () => {
    const f = fixture();
    f.maxAttempts.mockImplementation(async () => {
      f.disable();
      return 1;
    });
    expect(await f.client.claimProviderDispatch(binding)).toEqual({ kind: "unavailable" });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([0, 2, 3])("refuses SDK maxAttempts=%s before dispatch", async (attempts) => {
    const f = fixture();
    f.maxAttempts.mockResolvedValue(attempts);
    expect(await f.client.claimProviderDispatch(binding)).toEqual({ kind: "unavailable" });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([200, 500])("installed SDK sends only once for HTTP %s", async (statusCode) => {
    const handle = vi.fn(async () => ({
      response: {
        statusCode,
        headers: { "x-amz-executed-version": "7", "content-type": "application/json" },
        body: wire(statusCode === 200 ? claimed : { message: "SyntheticPrivateDiagnostic" }),
      },
    }));
    const sdk = new LambdaClient({
      region: "us-east-2",
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      maxAttempts: 1,
      requestHandler: { handle },
    });
    try {
      const client = new CoverLetterProviderControlClient(arn, sdk, () => true);
      expect(await client.claimProviderDispatch(binding)).toEqual(
        statusCode === 200 ? { kind: "claimed", reference } : { kind: "unavailable" },
      );
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      sdk.destroy();
    }
  });
  it("bounds a stalled send and never retries or settles it", async () => {
    const f = fixture();
    f.send.mockImplementation(() => new Promise(() => undefined));
    const client = new CoverLetterProviderControlClient(
      arn,
      { send: f.send, config: { maxAttempts: f.maxAttempts } },
      () => true,
      20,
    );
    expect(await client.claimProviderDispatch(binding)).toEqual({ kind: "unavailable" });
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it("rejects a mismatched trusted claim reference instead of admitting effects", async () => {
    const f = fixture();
    f.work.claimProviderDispatch.mockResolvedValue({
      kind: "claimed",
      reference: { ...reference, requestSha256: "f".repeat(64) },
    });
    expect((await f.handler(claim, { invokedFunctionArn: arn })).outcome).toBe("unavailable");
  });
  it.each(["claim", "settle"])("requires strict positive %s output shapes", (action) => {
    expect(validateProviderControlOutput(action === "claim" ? claimed : settled)).toBe(true);
    expect(
      validateProviderControlOutput({
        ...(action === "claim" ? claimed : settled),
        ownerUserId: documentId,
      }),
    ).toBe(false);
  });
});
