import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterCleanupClient } from "./cover-letter-cleanup-client.js";
import { createCoverLetterCleanupHandler } from "./cover-letter-cleanup-handler.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { createCoverLetterResponseDisposalHandler } from "./cover-letter-response-disposal-handler.js";
import { validateResponseMaintenanceOutput } from "./cover-letter-response-maintenance-contract.js";
import {
  createCoverLetterResponseMaintenanceLambda,
  handler,
} from "./cover-letter-response-maintenance-lambda.js";
import type { CoverLetterResponseInventory } from "./cover-letter-response-store.js";

function fixture(
  action: "reconcile_failed" | "reconcile_completed" = "reconcile_failed",
  timeoutMs = 15_000,
) {
  const prefix = "arn:aws:lambda:us-east-2:123456789012:function:";
  const target = `${prefix}synthetic-maintenance:7`;
  const disposal = `${prefix}synthetic-disposal:3`;
  const fenceTarget = `${prefix}synthetic-fence:5`;
  const reference = {
    id: "019a4000-0000-7000-8000-000000000002",
    documentId: "019a4000-0000-7000-8000-000000000001",
    purpose: "provider_dispatch" as const,
    requestSha256: "a".repeat(64),
  };
  const input = { schemaVersion: 1 as const, action, reference };
  const original = {
    schemaVersion: 1 as const,
    responseId: "resp_synthetic",
    createdAt: 1_790_000_000,
  };
  const env: Record<string, string | undefined> = {
    COVER_LETTER_RESPONSE_MAINTENANCE_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-maintenance",
    AWS_LAMBDA_FUNCTION_VERSION: "7",
    AWS_SESSION_TOKEN: "synthetic-token",
    COVER_LETTER_RESPONSE_DISPOSAL_FUNCTION_ARN: disposal,
    COVER_LETTER_CLEANUP_FUNCTION_ARN: fenceTarget,
    COVER_LETTER_OPENAI_SECRET_ID:
      "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-key",
  };
  let row: CoverLetterResponseInventory | null = {
    reference,
    state: "acknowledged",
    response: original,
  };
  let status = action === "reconcile_completed" ? "completed" : "failed";
  const events: string[] = [];
  const read = vi.fn(async () => {
    throw Error("SyntheticOrdinaryReadForbidden");
  });
  const readFailed = vi.fn(async () => {
    events.push("read_failed");
    return structuredClone(row);
  });
  const readCompleted = vi.fn(async () => {
    events.push("read_completed");
    return structuredClone(row);
  });
  const recordDisposal = vi.fn(async () => {
    events.push("record_disposal");
    if (row) row.state = "disposed";
  });
  const fence = vi.fn(async () => {
    events.push("fence");
    return "pending" as const;
  });
  const owning = createCoverLetterResponseDisposalHandler({
    functionArn: disposal,
    enabled: () => true,
    responses: { read, readFailed, readCompleted, recordDisposal },
  });
  const control = createCoverLetterCleanupHandler({
    functionArn: fenceTarget,
    enabled: () => true,
    work: { fenceForCleanup: fence },
  });
  const invoke = vi.fn<CoverLetterProviderLambdaClient["send"]>(async (command) => {
    const raw: unknown = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
    const arn = command.input.FunctionName ?? "";
    const value =
      arn === disposal
        ? await owning(raw, { invokedFunctionArn: arn })
        : arn === fenceTarget
          ? await control(raw, { invokedFunctionArn: arn })
          : undefined;
    if (!value) throw Error("SyntheticUnexpectedTarget");
    return {
      StatusCode: 200,
      ExecutedVersion: arn.split(":").at(-1) ?? "",
      Payload: new TextEncoder().encode(JSON.stringify(value)),
    };
  });
  const attempts = vi.fn(async () => 1);
  const createClient = vi.fn(() => ({ config: { maxAttempts: attempts }, send: invoke }));
  const resolve = vi.fn(async () => {
    events.push("secret");
    return "synthetic-provider-key";
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
    const method = options?.method ?? "GET";
    events.push(method);
    if (method === "DELETE")
      return Response.json({ id: original.responseId, object: "response.deleted", deleted: true });
    if (method === "POST") status = "cancelled";
    return Response.json({
      id: original.responseId,
      object: "response",
      created_at: original.createdAt,
      model: "gpt-6-luna",
      background: true,
      store: false,
      previous_response_id: null,
      tools: [],
      status,
    });
  });
  const run = createCoverLetterResponseMaintenanceLambda({
    environment: () => env,
    resolveProviderKey: resolve,
    createLambdaClient: createClient,
    providerFetch: fetch,
    timeoutMs,
  });
  const call = () => run(input, { invokedFunctionArn: target });
  return {
    input,
    target,
    disposal,
    fenceTarget,
    env,
    events,
    reference,
    original,
    read,
    readFailed,
    readCompleted,
    recordDisposal,
    fence,
    invoke,
    attempts,
    createClient,
    resolve,
    fetch,
    run,
    call,
    row: (value: CoverLetterResponseInventory | null) => {
      row = value;
    },
    status: (value: string) => {
      status = value;
    },
  };
}

describe("native response maintenance composition", () => {
  it.each(["reconcile_failed", "reconcile_completed"] as const)(
    "composes %s through actual private handlers and provider transport",
    async (action) => {
      const f = fixture(action);
      const output = await f.call();
      expect(output).toEqual({ ...f.input, outcome: "response_disposed" });
      expect(validateResponseMaintenanceOutput(output)).toBe(true);
      expect(f.events).toEqual(
        action === "reconcile_failed"
          ? ["read_failed", "fence", "secret", "GET", "DELETE", "record_disposal", "read_failed"]
          : ["read_completed", "secret", "GET", "DELETE", "record_disposal", "read_completed"],
      );
      expect(f.read).not.toHaveBeenCalled();
      expect(f.createClient).toHaveBeenCalledExactlyOnceWith({
        region: "us-east-2",
        maxAttempts: 1,
        ignoreConfiguredEndpointUrls: true,
      });
      for (const [command] of f.invoke.mock.calls) {
        expect(command).toBeInstanceOf(InvokeCommand);
        expect(command.input.InvocationType).toBe("RequestResponse");
        expect(command.input.LogType).toBe("None");
      }
      await f.call();
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.resolve).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["reconcile_failed", "reconcile_completed"] as const)(
    "withholds %s without owned eligibility, before fence/secret/provider",
    async (action) => {
      const f = fixture(action);
      f.row(null);
      expect((await f.call()).outcome).toBe("unresolved");
      expect(f.events).toEqual([action === "reconcile_failed" ? "read_failed" : "read_completed"]);
      expect(f.fence).not.toHaveBeenCalled();
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it("unknown response identity grants no effects", async () => {
    const f = fixture();
    f.row({ reference: f.reference, state: "reserved", response: null });
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.events).toEqual(["read_failed"]);
  });
  it.each(["queued", "in_progress", "failed", "incomplete", "cancelled"])(
    "successful path never cancels/fences %s",
    async (status) => {
      const f = fixture("reconcile_completed");
      f.status(status);
      expect((await f.call()).outcome).toBe("unresolved");
      expect(f.events).toEqual(["read_completed", "secret", "GET"]);
      expect(f.fence).not.toHaveBeenCalled();
      expect(f.recordDisposal).not.toHaveBeenCalled();
    },
  );
  it("eligible failed path can stop the exact original response", async () => {
    const f = fixture();
    f.status("in_progress");
    expect((await f.call()).outcome).toBe("response_disposed");
    expect(f.events).toContain("POST");
    expect(f.fetch.mock.calls[1]?.[0]).toBe(
      "https://api.openai.com/v1/responses/resp_synthetic/cancel",
    );
  });
  it.each([
    ["COVER_LETTER_RESPONSE_MAINTENANCE_ENABLED", undefined],
    ["AWS_REGION", "us-east-1"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_SESSION_TOKEN", ""],
    ["DATABASE_URL", "synthetic"],
    ["DATABASE_SECRET_ID", "synthetic"],
    ["OPENAI_API_KEY", ""],
    ["CANDIDATE_DOCUMENT_BUCKET", "synthetic"],
    ["PLATFORM_KMS_KEY_ARN", "synthetic"],
    [
      "COVER_LETTER_CLEANUP_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:5",
    ],
    [
      "COVER_LETTER_RESPONSE_DISPOSAL_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:999999999999:function:synthetic-disposal:3",
    ],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic-unqualified"],
  ])("refuses %s=%s before any setup/effects", async (key, value) => {
    const f = fixture();
    f.env[key ?? ""] = value;
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("checks exact invoked target before setup", async () => {
    const f = fixture();
    expect((await f.run(f.input, { invokedFunctionArn: f.disposal })).outcome).toBe("unresolved");
    expect(f.createClient).not.toHaveBeenCalled();
  });
  it("exported handler defaults off", async () => {
    const f = fixture();
    expect((await handler(f.input, { invokedFunctionArn: f.target })).outcome).toBe("unresolved");
  });
  it.each(["content", "response", "accessor", "proxy"])(
    "rejects %s input with fixed error before effects",
    async (kind) => {
      const f = fixture();
      const raw = { ...f.input };
      if (kind === "content") Object.assign(raw, { text: "synthetic-private-content" });
      if (kind === "response") Object.assign(raw, { response: f.original });
      if (kind === "accessor")
        Object.defineProperty(raw, "reference", {
          get: () => {
            throw Error("PrivateDiagnostic");
          },
        });
      const value =
        kind === "proxy"
          ? new Proxy(raw, {
              getPrototypeOf: () => {
                throw Error("PrivateDiagnostic");
              },
            })
          : raw;
      await expect(f.run(value, { invokedFunctionArn: f.target })).rejects.toThrow(
        "CoverLetterResponseMaintenanceUnavailable",
      );
      expect(f.createClient).not.toHaveBeenCalled();
    },
  );
  it("withdrawing activation during eligibility prevents downstream effects", async () => {
    const f = fixture();
    f.readFailed.mockImplementationOnce(async () => {
      f.env.COVER_LETTER_RESPONSE_MAINTENANCE_ENABLED = "false";
      return null;
    });
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.fence).not.toHaveBeenCalled();
  });
  it("warm target or secret rebinding refuses further I/O", async () => {
    const f = fixture();
    f.row(null);
    await f.call();
    const count = f.invoke.mock.calls.length;
    f.env.COVER_LETTER_OPENAI_SECRET_ID += "changed";
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.invoke).toHaveBeenCalledTimes(count);
  });
  it("stalled managed-key read returns within the invocation budget without late effects", async () => {
    const f = fixture("reconcile_failed", 20);
    let release: (key: string) => void = () => undefined;
    f.resolve.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    expect((await f.call()).outcome).toBe("unresolved");
    release("synthetic-provider-key");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("lost committed disposal ACK recovers from owned state without another provider effect", async () => {
    const f = fixture();
    const original = f.invoke.getMockImplementation();
    f.invoke.mockImplementation(async (...args) => {
      const output = await original?.(...args);
      const input = JSON.parse(new TextDecoder().decode(args[0].input.Payload as Uint8Array));
      if (input.action === "record_disposal") throw Error("SyntheticLostACK");
      if (!output) throw Error();
      return output;
    });
    expect((await f.call()).outcome).toBe("unresolved");
    expect((await f.call()).outcome).toBe("response_disposed");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.recordDisposal).toHaveBeenCalledTimes(1);
  });
  it("provider 404 is never disposal proof", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.recordDisposal).not.toHaveBeenCalled();
  });
  it("keys are not retained across invocations", async () => {
    const f = fixture();
    await f.call();
    f.row({ reference: f.reference, state: "acknowledged", response: f.original });
    await f.call();
    expect(f.resolve).toHaveBeenCalledTimes(2);
  });
});

describe("private fence Invoke client", () => {
  it.each([200, 500])("installed SDK makes one HTTP attempt for %s", async (statusCode) => {
    const f = fixture();
    const output = {
      schemaVersion: 1,
      action: "fence",
      documentId: f.reference.documentId,
      reference: f.reference,
      outcome: "pending",
    };
    const handle = vi.fn(async () => ({
      response: {
        statusCode,
        headers: { "x-amz-executed-version": "5", "content-type": "application/json" },
        body: new TextEncoder().encode(
          JSON.stringify(statusCode === 200 ? output : { message: "SyntheticPrivateDiagnostic" }),
        ),
      },
    }));
    const sdk = new LambdaClient({
      region: "us-east-2",
      maxAttempts: 1,
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
      requestHandler: { handle },
    });
    try {
      const client = new CoverLetterCleanupClient(f.fenceTarget, sdk, () => true);
      if (statusCode === 200) expect(await client.fenceForCleanup(f.reference)).toBe("pending");
      else
        await expect(client.fenceForCleanup(f.reference)).rejects.toThrow(
          "CoverLetterCleanupUnavailable",
        );
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      sdk.destroy();
    }
  });
  it.each([
    "wrong_version",
    "logs",
    "extra",
    "wrong_reference",
    "wrong_purpose",
    "unavailable",
    "oversized",
    "noncanonical",
    "bad_utf8",
    "function_error",
  ])("refuses %s without retry or proof", async (fault) => {
    const f = fixture();
    const output = {
      schemaVersion: 1,
      action: "fence",
      documentId: f.reference.documentId,
      reference: { ...f.reference },
      outcome: "pending",
    };
    if (fault === "extra") Object.assign(output, { text: "PrivateDiagnostic" });
    if (fault === "wrong_reference") output.reference.id = "019a4000-0000-7000-8000-000000000003";
    if (fault === "wrong_purpose") Object.assign(output.reference, { purpose: "final_document" });
    if (fault === "unavailable") output.outcome = "unavailable";
    const send = vi.fn<CoverLetterProviderLambdaClient["send"]>(async () => ({
      StatusCode: 200,
      ExecutedVersion: fault === "wrong_version" ? "4" : "5",
      ...(fault === "logs" ? { LogResult: "PrivateDiagnostic" } : {}),
      ...(fault === "function_error" ? { FunctionError: "PrivateDiagnostic" } : {}),
      Payload:
        fault === "oversized"
          ? new Uint8Array(8193)
          : fault === "bad_utf8"
            ? new Uint8Array([255])
            : new TextEncoder().encode(
                (fault === "noncanonical" ? " " : "") + JSON.stringify(output),
              ),
    }));
    const client = new CoverLetterCleanupClient(
      f.fenceTarget,
      { config: { maxAttempts: async () => 1 }, send },
      () => true,
    );
    await expect(client.fenceForCleanup(f.reference)).rejects.toThrow(
      "CoverLetterCleanupUnavailable",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("multiple SDK attempts refuse before Invoke", async () => {
    const f = fixture();
    f.attempts.mockResolvedValue(2);
    expect((await f.call()).outcome).toBe("unresolved");
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("stalled fence returns unresolved without provider effect or retry", async () => {
    const f = fixture();
    const send = vi.fn<CoverLetterProviderLambdaClient["send"]>(() => new Promise(() => undefined));
    const client = new CoverLetterCleanupClient(
      f.fenceTarget,
      { config: { maxAttempts: async () => 1 }, send },
      () => true,
      10,
    );
    await expect(client.fenceForCleanup(f.reference)).rejects.toThrow(
      "CoverLetterCleanupUnavailable",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
