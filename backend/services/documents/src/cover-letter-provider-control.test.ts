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
    settleTerminalProviderDispatch: vi.fn(async () => undefined),
    claimProviderDispatch: vi.fn(async () => ({ kind: "claimed" as const, reference })),
    settleProviderDispatch: vi.fn(async () => undefined),
    settleRejectedProviderDispatch: vi.fn(async () => undefined),
    settleUndispatchedProviderDispatch: vi.fn(async () => undefined),
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
  const termination = {
    kind: "terminal_no_content" as const,
    reference: { schemaVersion: 1 as const, responseId: "resp_original1", createdAt: 1791028800 },
    terminalStatus: "failed" as const,
  };
  const terminal = {
    schemaVersion: 1 as const,
    action: "settle_terminal" as const,
    documentId,
    reference,
    termination,
  };
  it.each(["failed", "cancelled", "incomplete"] as const)(
    "routes exact original %s termination without ordinary settlement",
    async (terminalStatus) => {
      const f = fixture();
      const receipt = { ...termination, terminalStatus };
      await f.client.settleTerminalProviderDispatch(reference, receipt);
      expect(f.work.settleTerminalProviderDispatch).toHaveBeenCalledWith(reference, receipt);
      expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleUndispatchedProviderDispatch).not.toHaveBeenCalled();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(validateProviderControlInput({ ...terminal, termination: receipt })).toBe(true);
      expect(
        validateProviderControlOutput({ ...terminal, termination: receipt, outcome: "settled" }),
      ).toBe(true);
    },
  );
  it("older composition refuses terminal action without any settlement fallback", async () => {
    const f = fixture();
    const handler = createCoverLetterProviderControlHandler({
      functionArn: arn,
      enabled: () => true,
      work: {
        claimProviderDispatch: f.work.claimProviderDispatch,
        settleProviderDispatch: f.work.settleProviderDispatch,
        settleRejectedProviderDispatch: f.work.settleRejectedProviderDispatch,
      },
    });
    await expect(handler(terminal, { invokedFunctionArn: arn })).resolves.toEqual({
      ...terminal,
      outcome: "unavailable",
    });
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it.each([
    { termination: { ...termination, text: "SyntheticForbiddenContent" } },
    { termination: { ...termination, terminalStatus: "completed" } },
    { termination: { ...termination, terminalStatus: "queued" } },
    { termination: { ...termination, terminalStatus: "in_progress" } },
    { termination: { ...termination, reference: { ...termination.reference, responseId: "" } } },
    { termination: { ...termination, reference: { ...termination.reference, createdAt: 0 } } },
    { termination: null },
    { response: termination },
    { reference: { ...reference, purpose: "private_slots" } },
    { reference: { ...reference, ownerUserId: "SyntheticNotCallerSelected" } },
  ])("strict new action refuses invalid metadata before I/O: %j", async (patch) => {
    const f = fixture();
    const raw = { ...terminal, ...patch };
    expect(validateProviderControlInput(raw)).toBe(false);
    await expect(f.handler(raw, { invokedFunctionArn: arn })).rejects.toThrow(
      "CoverLetterProviderControlUnavailable",
    );
    expect(f.work.settleTerminalProviderDispatch).not.toHaveBeenCalled();
  });
  it.each([
    { termination: { ...termination, terminalStatus: "cancelled" } },
    {
      termination: {
        ...termination,
        reference: { ...termination.reference, responseId: "resp_other" },
      },
    },
    {
      termination: {
        ...termination,
        reference: { ...termination.reference, createdAt: 1791028801 },
      },
    },
    { reference: { ...reference, id: "019a4000-0000-7000-8000-000000000003" } },
    { reference: { ...reference, requestSha256: "b".repeat(64) } },
    { action: "settle_rejected" },
  ])("changed terminal receipt echo refuses: %j", async (patch) => {
    const f = fixture();
    f.send.mockResolvedValue({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...terminal, outcome: "settled", ...patch }),
    });
    await expect(f.client.settleTerminalProviderDispatch(reference, termination)).rejects.toThrow(
      "CoverLetterProviderControlUnavailable",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("withdrawn gate refuses new action before Invoke", async () => {
    const f = fixture();
    f.disable();
    await expect(f.client.settleTerminalProviderDispatch(reference, termination)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("lost original terminal settlement acknowledgement remains unresolved with no retry", async () => {
    const f = fixture();
    f.work.settleTerminalProviderDispatch.mockRejectedValue(Error("SyntheticLostOriginalSQLACK"));
    await expect(f.client.settleTerminalProviderDispatch(reference, termination)).rejects.toThrow();
    expect(f.work.settleTerminalProviderDispatch).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it("routes exact original non-dispatch cleanup without ordinary settlement", async () => {
    const f = fixture();
    await f.client.settleUndispatchedProviderDispatch(reference);
    expect(f.work.settleUndispatchedProviderDispatch).toHaveBeenCalledWith(reference);
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledOnce();
    expect(validateProviderControlInput({ ...settle, action: "settle_undispatched" })).toBe(true);
    expect(validateProviderControlOutput({ ...settled, action: "settle_undispatched" })).toBe(true);
  });
  it("older handlers refuse non-dispatch without touching any existing settlement port", async () => {
    const f = fixture();
    const handler = createCoverLetterProviderControlHandler({
      functionArn: arn,
      enabled: () => true,
      work: {
        claimProviderDispatch: f.work.claimProviderDispatch,
        settleProviderDispatch: f.work.settleProviderDispatch,
      },
    });
    expect(
      await handler({ ...settle, action: "settle_undispatched" }, { invokedFunctionArn: arn }),
    ).toMatchObject({ outcome: "unavailable", action: "settle_undispatched" });
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["action", "id", "hash", "payload"])(
    "refuses mismatched %s non-dispatch acknowledgements",
    async (kind) => {
      const f = fixture();
      const output = { ...settled, action: "settle_undispatched", reference: { ...reference } };
      if (kind === "action") output.action = "settle_rejected";
      if (kind === "id") output.reference.id = documentId;
      if (kind === "hash") output.reference.requestSha256 = "f".repeat(64);
      if (kind === "payload") Object.assign(output, { text: "synthetic" });
      f.send.mockResolvedValue({ StatusCode: 200, ExecutedVersion: "7", Payload: wire(output) });
      await expect(f.client.settleUndispatchedProviderDispatch(reference)).rejects.toThrow(
        /^CoverLetterProviderControlUnavailable$/u,
      );
      expect(f.send).toHaveBeenCalledOnce();
    },
  );
  it("never retries a lost original non-dispatch acknowledgement", async () => {
    const f = fixture();
    f.send.mockRejectedValue(Error("SyntheticLostACK"));
    await expect(f.client.settleUndispatchedProviderDispatch(reference)).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("a timed-out rejected cleanup RPC never acknowledges its later response or retries", async () => {
    const f = fixture();
    let finish: (value: {
      StatusCode: number;
      ExecutedVersion: string;
      Payload: Uint8Array;
    }) => void = () => undefined;
    f.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = new CoverLetterProviderControlClient(
      arn,
      { send: f.send, config: { maxAttempts: f.maxAttempts } },
      () => true,
      20,
    );
    const attempt = client.settleRejectedProviderDispatch(reference);
    await expect(attempt).rejects.toThrow(/^CoverLetterProviderControlUnavailable$/u);
    finish({
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: wire({ ...settled, action: "settle_rejected" }),
    });
    await expect(attempt).rejects.toThrow(/^CoverLetterProviderControlUnavailable$/u);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("routes rejected completion to phase fencing, never ordinary settlement", async () => {
    const f = fixture();
    await f.client.settleRejectedProviderDispatch(reference);
    expect(f.work.settleRejectedProviderDispatch).toHaveBeenCalledWith(reference);
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[0].input.Payload).toEqual(
      wire({ ...settle, action: "settle_rejected" }),
    );
  });
  it("older control composition cannot acknowledge rejected-phase cleanup", async () => {
    const f = fixture();
    const handler = createCoverLetterProviderControlHandler({
      functionArn: arn,
      work: {
        claimProviderDispatch: f.work.claimProviderDispatch,
        settleProviderDispatch: f.work.settleProviderDispatch,
      },
      enabled: () => true,
    });
    expect(
      await handler({ ...settle, action: "settle_rejected" }, { invokedFunctionArn: arn }),
    ).toEqual({
      schemaVersion: 1,
      action: "settle_rejected",
      documentId,
      outcome: "unavailable",
    });
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it("rejected-phase closure defaults off without SDK or control I/O", async () => {
    const f = fixture();
    f.disable();
    await expect(f.client.settleRejectedProviderDispatch(reference)).rejects.toThrow(
      /^CoverLetterProviderControlUnavailable$/u,
    );
    expect(
      (await f.handler({ ...settle, action: "settle_rejected" }, { invokedFunctionArn: arn }))
        .outcome,
    ).toBe("unavailable");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["action", "id", "hash", "extra", "lost"])(
    "rejects %s rejected-phase acknowledgements without retry",
    async (kind) => {
      const f = fixture();
      const response = { ...settled, action: "settle_rejected", reference: { ...reference } };
      if (kind === "action") response.action = "settle";
      if (kind === "id") response.reference.id = documentId;
      if (kind === "hash") response.reference.requestSha256 = "f".repeat(64);
      if (kind === "lost") f.send.mockRejectedValue(Error("SyntheticLostClosureACK"));
      else
        f.send.mockResolvedValue({
          StatusCode: 200,
          ExecutedVersion: "7",
          Payload: wire(kind === "extra" ? { ...response, stopConfirmed: true } : response),
        });
      await expect(f.client.settleRejectedProviderDispatch(reference)).rejects.toThrow(
        /^CoverLetterProviderControlUnavailable$/u,
      );
      expect(f.send).toHaveBeenCalledOnce();
    },
  );
  it.each(["private_slots", "final_document"] as const)(
    "refuses rejected %s authority before dispatch",
    async (purpose) => {
      const f = fixture();
      const raw = { ...settle, action: "settle_rejected", reference: { ...reference, purpose } };
      expect(validateProviderControlInput(raw)).toBe(false);
      await expect(f.handler(raw, { invokedFunctionArn: arn })).rejects.toThrow(
        /^CoverLetterProviderControlUnavailable$/u,
      );
      await expect(f.client.settleRejectedProviderDispatch(raw.reference)).rejects.toThrow(
        /^CoverLetterProviderControlUnavailable$/u,
      );
      expect(f.send).not.toHaveBeenCalled();
      expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
    },
  );
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
