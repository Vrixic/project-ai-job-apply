import { describe, expect, it, vi } from "vitest";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { TemporaryMaterialCompletionClient } from "./temporary-material-completion-client.js";
import {
  validateTemporaryMaterialCompletionInput,
  validateTemporaryMaterialCompletionOutput,
} from "./temporary-material-completion-contract.js";
import { createTemporaryMaterialCompletionHandler } from "./temporary-material-completion-handler.js";
import { createTemporaryMaterialCompletionLambda } from "./temporary-material-completion-lambda.js";

const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-completion:3";
const work = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const material = {
  schemaVersion: 1 as const,
  kind: "cover_letter" as const,
  generationId: work.documentId,
  ownerUserId: "019a4000-0000-7000-8000-000000000003",
  applicationId: "019a4000-0000-7000-8000-000000000004",
  version: 1,
  contentSha256: "b".repeat(64),
  completedAtMs: 1_700_000_000_000,
  expiresAtMs: 1_700_001_800_000,
};
const input = {
  schemaVersion: 1 as const,
  action: "claim_original_completion" as const,
  work,
  material,
};
const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("temporary material original completion private boundary", () => {
  it.each(["claimed", "already_completed", "unavailable"] as const)(
    "accepts only bounded scalar metadata: %s",
    (outcome) => {
      expect(validateTemporaryMaterialCompletionInput(input)).toBe(true);
      expect(validateTemporaryMaterialCompletionOutput({ ...input, outcome })).toBe(true);
    },
  );
  it.each([
    { ...input, text: "synthetic forbidden content" },
    { ...input, action: "settle" },
    { ...input, schemaVersion: 2 },
    { ...input, work: { ...work, purpose: "final_document" } },
    { ...input, material: { ...material, kind: "tailored_resume" } },
    { ...input, material: { ...material, completedAtMs: material.completedAtMs + 1 } },
    { ...input, material: { ...material, generationId: material.ownerUserId } },
    { ...input, material: { ...material, paragraphs: ["synthetic"] } },
  ])("refuses invalid/content-bearing input without control I/O", async (bad) => {
    const claimOriginalCompletion = vi.fn(async () => "claimed" as const);
    const handler = createTemporaryMaterialCompletionHandler({
      functionArn: target,
      store: { claimOriginalCompletion },
      enabled: () => true,
    });
    expect(validateTemporaryMaterialCompletionInput(bad)).toBe(false);
    await expect(handler(bad, { invokedFunctionArn: target })).rejects.toThrow(
      "TemporaryMaterialCompletionUnavailable",
    );
    expect(claimOriginalCompletion).not.toHaveBeenCalled();
  });
  it("does not run accessors while validating", () => {
    const getter = vi.fn(() => material);
    expect(
      validateTemporaryMaterialCompletionInput({
        ...input,
        get material() {
          return getter();
        },
      }),
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["disabled", "alias", "wrong_version", "error", "bad_outcome", "disable_after"])(
    "handler refuses %s without leaking errors",
    async (fault) => {
      let enabled = fault !== "disabled";
      const claimOriginalCompletion = vi.fn(async () => {
        if (fault === "error") throw Error("synthetic SQL diagnostic");
        if (fault === "disable_after") enabled = false;
        return (fault === "bad_outcome" ? "settled" : "claimed") as "claimed";
      });
      const handler = createTemporaryMaterialCompletionHandler({
        functionArn: target,
        store: { claimOriginalCompletion },
        enabled: () => enabled,
      });
      const arn =
        fault === "alias"
          ? target.replace(":3", ":live")
          : fault === "wrong_version"
            ? target.replace(":3", ":4")
            : target;
      expect(await handler(input, { invokedFunctionArn: arn })).toEqual({
        ...input,
        outcome: "unavailable",
      });
      if (["disabled", "alias", "wrong_version"].includes(fault))
        expect(claimOriginalCompletion).not.toHaveBeenCalled();
    },
  );
  it("snapshots before asynchronous control and keeps trusted-port mutations off the response", async () => {
    const handler = createTemporaryMaterialCompletionHandler({
      functionArn: target,
      enabled: () => true,
      store: {
        claimOriginalCompletion: async (binding, ref) => {
          binding.requestSha256 = "c".repeat(64);
          ref.version = 42;
          return "claimed";
        },
      },
    });
    expect(await handler(input, { invokedFunctionArn: target })).toEqual({
      ...input,
      outcome: "claimed",
    });
  });
  it.each([
    "valid",
    "already_completed",
    "lost_ack",
    "wrong_version",
    "log",
    "function_error",
    "status",
    "binding",
    "time",
    "extra",
    "whitespace",
    "utf8",
    "oversize",
    "retry",
    "disabled",
    "disable_after",
    "timeout",
  ])("one-shot client checks exact response: %s", async (fault) => {
    let enabled = fault !== "disabled";
    const response = {
      StatusCode: 200,
      ExecutedVersion: "3",
      Payload: wire({
        ...input,
        outcome: fault === "already_completed" ? "already_completed" : "claimed",
      }),
    };
    const send = vi.fn(async (_command: unknown) => {
      if (fault === "lost_ack") throw Error("synthetic lost ACK");
      if (fault === "disable_after") enabled = false;
      if (fault === "timeout") return await new Promise<never>(() => {});
      return {
        ...response,
        ...(fault === "wrong_version" ? { ExecutedVersion: "4" } : {}),
        ...(fault === "log" ? { LogResult: "synthetic" } : {}),
        ...(fault === "function_error" ? { FunctionError: "synthetic" } : {}),
        ...(fault === "status" ? { StatusCode: 202 } : {}),
        ...(fault === "binding"
          ? {
              Payload: wire({
                ...input,
                work: { ...work, requestSha256: "c".repeat(64) },
                outcome: "claimed",
              }),
            }
          : {}),
        ...(fault === "time"
          ? {
              Payload: wire({
                ...input,
                material: {
                  ...material,
                  completedAtMs: material.completedAtMs + 1,
                  expiresAtMs: material.expiresAtMs + 1,
                },
                outcome: "claimed",
              }),
            }
          : {}),
        ...(fault === "extra"
          ? { Payload: wire({ ...input, outcome: "claimed", text: "synthetic" }) }
          : {}),
        ...(fault === "whitespace"
          ? { Payload: new TextEncoder().encode(` ${new TextDecoder().decode(response.Payload)}`) }
          : {}),
        ...(fault === "utf8" ? { Payload: new Uint8Array([255]) } : {}),
        ...(fault === "oversize" ? { Payload: new Uint8Array(8193) } : {}),
      };
    });
    const transport = {
      config: { maxAttempts: async () => (fault === "retry" ? 2 : 1) },
      send,
    } as unknown as CoverLetterProviderLambdaClient;
    const client = new TemporaryMaterialCompletionClient(
      target,
      work,
      transport,
      () => enabled,
      fault === "timeout" ? 5 : 10000,
    );
    expect(await client.claimOriginalCompletion(material)).toBe(
      fault === "valid"
        ? "claimed"
        : fault === "already_completed"
          ? "already_completed"
          : "unavailable",
    );
    if (["retry", "disabled"].includes(fault)) expect(send).not.toHaveBeenCalled();
    else {
      expect(send).toHaveBeenCalledOnce();
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeDefined();
    }
  });
  it("native bootstrap stays lazy/default off and refuses mismatched configuration before secrets", async () => {
    const resolve = vi.fn(
      async () => "postgres://synthetic:local_only@127.0.0.1:1/work_ledger_completion",
    );
    const run = createTemporaryMaterialCompletionLambda({
      environment: () => ({}),
      resolveDatabaseUrl: resolve,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(await run(input, { invokedFunctionArn: target })).toEqual({
      ...input,
      outcome: "unavailable",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("native bootstrap pins exact identity and initializes one single-flight store", async () => {
    const env: Record<string, string> = {
      TEMPORARY_MATERIAL_COMPLETION_ENABLED: "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-completion",
      AWS_LAMBDA_FUNCTION_VERSION: "3",
      AWS_SESSION_TOKEN: "synthetic-session",
      DATABASE_SECRET_ID:
        "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF",
    };
    const resolve = vi.fn(
      async () => "postgres://synthetic:local_only@127.0.0.1:1/work_ledger_completion",
    );
    const claimOriginalCompletion = vi.fn(async () => "claimed" as const);
    const createStore = vi.fn(() => ({ claimOriginalCompletion }));
    const run = createTemporaryMaterialCompletionLambda({
      environment: () => env,
      resolveDatabaseUrl: resolve,
      createStore,
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => run(input, { invokedFunctionArn: target })),
    );
    expect(results.every((result) => result.outcome === "claimed")).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
    expect(createStore).toHaveBeenCalledOnce();
    env.AWS_LAMBDA_FUNCTION_VERSION = "4";
    expect((await run(input, { invokedFunctionArn: target.replace(":3", ":4") })).outcome).toBe(
      "unavailable",
    );
    expect(resolve).toHaveBeenCalledOnce();
  });
});
