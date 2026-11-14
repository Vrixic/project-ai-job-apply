import {
  BedrockConverseProvider,
  GROUNDED_PARAGRAPHS_NAME,
  ModelGateway,
  ProviderRefusedError,
} from "@ai-job-apply/ai-sdk";
import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  bedrockDefiniteRefusal,
  createNativeBedrockConversePort,
  NATIVE_BEDROCK_ENDPOINT,
  nativeBedrockClientConfig,
} from "./native-bedrock-converse.js";

const MODEL = "us.anthropic.claude-sonnet-4-6";
const ACCOUNT = "123456789012";
const answer = { paragraphs: [{ text: "I build services.", factIds: ["f1"] }] };
const output = (): ConverseCommandOutput =>
  ({
    $metadata: {},
    stopReason: "tool_use",
    output: {
      message: {
        role: "assistant",
        content: [{ toolUse: { toolUseId: "t1", name: GROUNDED_PARAGRAPHS_NAME, input: answer } }],
      },
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metrics: { latencyMs: 5 },
  }) as ConverseCommandOutput;
const input = () => ({
  modelId: MODEL,
  system: [{ text: "s" }],
  messages: [{ role: "user" as const, content: [{ text: "u" }] }],
  inferenceConfig: { maxTokens: 100, temperature: 0 },
  toolConfig: {
    tools: [
      {
        toolSpec: {
          name: GROUNDED_PARAGRAPHS_NAME,
          description: "d",
          inputSchema: { json: { type: "object" } },
        },
      },
    ],
    toolChoice: { tool: { name: GROUNDED_PARAGRAPHS_NAME } },
  },
});

describe("native Bedrock Converse transport", () => {
  it("configures one attempt, a fixed endpoint, explicit task credentials and a silent logger", () => {
    const config = nativeBedrockClientConfig({
      accountId: ACCOUNT,
      enabled: () => true,
      relativeUri: "/v2/credentials/12345678-1234-1234-1234-123456789012",
    });
    expect(config).toMatchObject({
      region: "us-east-2",
      endpoint: NATIVE_BEDROCK_ENDPOINT,
      maxAttempts: 1,
      ignoreConfiguredEndpointUrls: true,
    });
    expect(NATIVE_BEDROCK_ENDPOINT).toBe("https://bedrock-runtime.us-east-2.amazonaws.com");
    expect(typeof config.credentials).toBe("function");
    for (const level of ["debug", "info", "warn", "error"] as const)
      expect(config.logger[level]()).toBeUndefined();
  });

  it("refuses injected clients or credentials outside tests", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createNativeBedrockConversePort({
          accountId: ACCOUNT,
          enabled: () => true,
          testClient: { send: vi.fn() },
        }),
      ).toThrow("NativeImageConfigurationUnavailable");
      expect(() =>
        createNativeBedrockConversePort({
          accountId: ACCOUNT,
          enabled: () => true,
          testCredentials: { accessKeyId: "a", secretAccessKey: "b", sessionToken: "c" },
        }),
      ).toThrow("NativeImageConfigurationUnavailable");
    } finally {
      process.env.NODE_ENV = previous;
    }
    expect(() =>
      createNativeBedrockConversePort({ accountId: "123", enabled: () => true }),
    ).toThrow();
  });

  it("sends exactly the provider's request once and returns only the stop reason and output", async () => {
    const send = vi.fn(async (_command: ConverseCommand, _options: { abortSignal: AbortSignal }) =>
      output(),
    );
    const port = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => true,
      testClient: { send },
    });
    const signal = new AbortController().signal;
    const result = await port.converse(input(), { abortSignal: signal });
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0];
    expect(call?.[0].input).toEqual(input());
    expect(call?.[1].abortSignal).toBe(signal);
    expect(Object.keys(result).sort()).toEqual(["output", "stopReason"]);
    expect(result.stopReason).toBe("tool_use");
  });

  it("does nothing while disabled, after destroy or when already aborted", async () => {
    const send = vi.fn(async () => output());
    const enabled = vi.fn(() => false);
    const port = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled,
      testClient: { send },
    });
    await expect(
      port.converse(input(), { abortSignal: new AbortController().signal }),
    ).rejects.toThrow("NativeImageConfigurationUnavailable");
    const live = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => true,
      testClient: { send },
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(live.converse(input(), { abortSignal: aborted.signal })).rejects.toThrow();
    live.destroy();
    await expect(
      live.converse(input(), { abortSignal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("withholds the result when switched off during the call and never repeats provider text", async () => {
    let on = true;
    const send = vi.fn(async () => {
      on = false;
      return output();
    });
    const port = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => on,
      testClient: { send },
    });
    await expect(
      port.converse(input(), { abortSignal: new AbortController().signal }),
    ).rejects.toThrow("NativeImageConfigurationUnavailable");
    const failing = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => true,
      testClient: {
        send: async () => {
          throw new Error("AccessDeniedException: prompt text and arn:aws:iam::1:role/x");
        },
      },
    });
    const failure = await failing
      .converse(input(), { abortSignal: new AbortController().signal })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    expect(failure?.message).toBe("NativeImageConfigurationUnavailable");
  });

  const awsError = (name: string, status: number | undefined, fault: string | null = "client") =>
    Object.assign(new Error("provider text arn:aws:iam::1:role/x"), {
      name,
      ...(fault ? { $fault: fault } : {}),
      ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }),
    });

  it.each([
    ["AccessDeniedException", 403],
    ["ValidationException", 400],
    ["ResourceNotFoundException", 404],
    ["ThrottlingException", 429],
    ["ServiceQuotaExceededException", 402],
    ["ModelNotReadyException", 429],
  ] as const)("classifies %s (%i) as a definite refusal before any model work", (name, status) => {
    expect(bedrockDefiniteRefusal(awsError(name, status))).toBe(true);
  });

  it.each([
    // Work happened or may have happened: never a refusal.
    ["ModelTimeoutException", 408, "client"],
    ["ModelErrorException", 424, "client"],
    ["InternalServerException", 500, "server"],
    ["ServiceUnavailableException", 503, "server"],
    ["ModelStreamErrorException", 424, "client"],
    // Right name, wrong evidence.
    ["AccessDeniedException", 403, "server"],
    ["AccessDeniedException", 500, "client"],
    ["AccessDeniedException", 408, "client"],
    ["AccessDeniedException", undefined, "client"],
    ["AccessDeniedException", 403, null],
    ["AbortError", undefined, null],
    ["Error", undefined, null],
  ] as const)("does not classify %s (%s, %s) as a refusal", (name, status, fault) => {
    expect(bedrockDefiniteRefusal(awsError(name, status, fault))).toBe(false);
  });

  it("does not trust a message, a non-object or a non-integer status", () => {
    expect(bedrockDefiniteRefusal(new Error("AccessDeniedException"))).toBe(false);
    expect(bedrockDefiniteRefusal("AccessDeniedException")).toBe(false);
    expect(bedrockDefiniteRefusal(null)).toBe(false);
    expect(bedrockDefiniteRefusal(awsError("AccessDeniedException", 403.5))).toBe(false);
  });

  it("raises a typed refusal for a definite rejection and only an unavailable error for everything else", async () => {
    const make = (error: unknown, signal = new AbortController().signal) =>
      createNativeBedrockConversePort({
        accountId: ACCOUNT,
        enabled: () => true,
        testClient: {
          send: async () => {
            throw error;
          },
        },
      }).converse(input(), { abortSignal: signal });
    const refusal = await make(awsError("AccessDeniedException", 403)).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(ProviderRefusedError);
    expect(String((refusal as Error).message)).not.toContain("arn:aws");
    for (const unknown of [
      awsError("InternalServerException", 500, "server"),
      awsError("ModelTimeoutException", 408),
      new Error("socket hang up"),
    ])
      await expect(make(unknown)).rejects.toThrow("NativeImageConfigurationUnavailable");
    // An aborted call has an unknown outcome even if the error looks like a refusal.
    const controller = new AbortController();
    controller.abort();
    await expect(make(awsError("AccessDeniedException", 403), controller.signal)).rejects.toThrow(
      "NativeImageConfigurationUnavailable",
    );
  });

  it("reaches the gateway as a non-dispatch receipt when the invoke grant is gone", async () => {
    const send = vi.fn(async () => {
      throw awsError("AccessDeniedException", 403);
    });
    const port = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => true,
      testClient: { send },
    });
    const provider = new BedrockConverseProvider({ modelId: MODEL, enabled: () => true, port });
    const gateway = new ModelGateway(provider, { enabled: () => true });
    await expect(
      gateway.generateOriginalWithCompletion(
        {
          promptId: "cover_letter",
          promptVersion: "1",
          purpose: "cover_letter",
          categories: ["profile_facts"],
          system: "s",
          user: "u",
        },
        { purpose: "cover_letter", categories: ["profile_facts"], approvedAt: new Date() },
      ),
    ).resolves.toMatchObject({ kind: "not_dispatched", code: "PROVIDER_REFUSED" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("produces a grounded result end to end through the provider and the gateway", async () => {
    const send = vi.fn(async () => output());
    const port = createNativeBedrockConversePort({
      accountId: ACCOUNT,
      enabled: () => true,
      testClient: { send },
    });
    const provider = new BedrockConverseProvider({ modelId: MODEL, enabled: () => true, port });
    const gateway = new ModelGateway(provider, { enabled: () => true });
    const result = await gateway.generate(
      {
        promptId: "cover_letter",
        promptVersion: "1",
        purpose: "cover_letter",
        categories: ["profile_facts"],
        system: "s",
        user: "u",
      },
      { purpose: "cover_letter", categories: ["profile_facts"], approvedAt: new Date() },
    );
    expect(result.value).toEqual(answer);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
