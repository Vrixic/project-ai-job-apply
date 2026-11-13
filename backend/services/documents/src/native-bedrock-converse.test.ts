import { ModelGateway } from "@ai-job-apply/ai-sdk";
import { BedrockConverseProvider, GROUNDED_PARAGRAPHS_NAME } from "@ai-job-apply/ai-sdk";
import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_BEDROCK_ENDPOINT,
  createNativeBedrockConversePort,
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
