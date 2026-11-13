import { describe, expect, it, vi } from "vitest";
import {
  BedrockConverseProvider,
  type BedrockConverseInput,
  type BedrockConverseOutput,
  type BedrockConversePort,
  toolJsonText,
  validBedrockModelId,
} from "./bedrock.js";
import { ModelGateway, type ProviderRequest } from "./gateway.js";
import { GROUNDED_PARAGRAPHS_NAME, GROUNDED_PARAGRAPHS_SCHEMA } from "./provider-output-schema.js";

const MODEL = "us.anthropic.claude-sonnet-4-6";
const answer = { paragraphs: [{ text: "I build services.", factIds: ["f1"] }] };
const reply = (
  overrides: Partial<BedrockConverseOutput> = {},
  content: unknown[] = [
    { toolUse: { toolUseId: "t1", name: GROUNDED_PARAGRAPHS_NAME, input: answer } },
  ],
): BedrockConverseOutput => ({
  stopReason: "tool_use",
  output: { message: { role: "assistant", content } },
  ...overrides,
});
const request = (signal: AbortSignal = new AbortController().signal): ProviderRequest => ({
  system: "Return grounded JSON.",
  user: "Synthetic facts only.",
  maxOutputChars: 8_000,
  signal,
  cacheKey: "opaque-application-key",
});
function setup(response: BedrockConverseOutput = reply(), enabled = true) {
  const converse = vi.fn<BedrockConversePort["converse"]>().mockResolvedValue(response);
  const provider = new BedrockConverseProvider({
    modelId: MODEL,
    enabled: () => enabled,
    port: { converse },
  });
  return { provider, converse };
}

describe("BedrockConverseProvider (offline port)", () => {
  it("stays disabled unless explicitly activated, before any call", async () => {
    const converse = vi.fn<BedrockConversePort["converse"]>();
    const provider = new BedrockConverseProvider({ modelId: MODEL, port: { converse } });
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "MODEL_DISABLED" });
    expect(converse).not.toHaveBeenCalled();
  });

  it("asks for the one forced tool and nothing the ADR keeps off", async () => {
    const { provider, converse } = setup();
    const input = request();
    await expect(provider.complete(input)).resolves.toEqual({ text: JSON.stringify(answer) });
    expect(converse).toHaveBeenCalledTimes(1);
    const [body, options] = converse.mock.calls[0] as [
      BedrockConverseInput,
      { abortSignal: AbortSignal },
    ];
    expect(options.abortSignal).toBe(input.signal);
    expect(body).toEqual({
      modelId: MODEL,
      system: [{ text: input.system }],
      messages: [{ role: "user", content: [{ text: input.user }] }],
      inferenceConfig: { maxTokens: 4_096, temperature: 0 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: GROUNDED_PARAGRAPHS_NAME,
              description: "Return the answer in exactly this JSON shape.",
              inputSchema: { json: GROUNDED_PARAGRAPHS_SCHEMA },
            },
          },
        ],
        toolChoice: { tool: { name: GROUNDED_PARAGRAPHS_NAME } },
      },
    });
    // No cache points, guardrails, trace, performance configuration, extra model fields or images.
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "cachePoint",
      "guardrail",
      "trace",
      "performanceConfig",
      "additionalModelRequestFields",
      "additionalModelResponseFieldPaths",
      "image",
      "document",
      "reasoning",
      "opaque-application-key",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("caps output tokens by the per-request cap and by the requested size", async () => {
    const converse = vi.fn<BedrockConversePort["converse"]>().mockResolvedValue(reply());
    const capped = new BedrockConverseProvider({
      modelId: MODEL,
      enabled: () => true,
      port: { converse },
      maxOutputTokens: 1_000,
    });
    await capped.complete(request());
    expect(converse.mock.calls[0]?.[0].inferenceConfig.maxTokens).toBe(1_000);
    await capped.complete({ ...request(), maxOutputChars: 300 });
    expect(converse.mock.calls[1]?.[0].inferenceConfig.maxTokens).toBe(300);
    expect(
      () =>
        new BedrockConverseProvider({ modelId: MODEL, port: { converse }, maxOutputTokens: 4_097 }),
    ).toThrow();
  });

  it("accepts only reviewed shapes of model id", () => {
    expect(validBedrockModelId(MODEL)).toBe(true);
    for (const bad of [
      "anthropic.claude-sonnet-4-6",
      "us.anthropic.claude-sonnet-4-6/../x",
      "arn:aws:bedrock:us-east-2:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6",
      "us.",
      "",
      " us.anthropic.claude-sonnet-4-6",
    ])
      expect(validBedrockModelId(bad)).toBe(false);
    expect(
      () => new BedrockConverseProvider({ modelId: "gpt-6-luna", port: { converse: vi.fn() } }),
    ).toThrow();
  });

  it("identifies itself as bedrock with the profile id, never a dated snapshot", () => {
    const { provider } = setup();
    expect(provider.identity).toEqual({ provider: "bedrock", model: MODEL, version: MODEL });
    expect(Object.isFrozen(provider.identity)).toBe(true);
  });

  it("rejects every reply that is not exactly one forced tool use", async () => {
    const tool = (extra: Record<string, unknown> = {}) => ({
      toolUse: { toolUseId: "t1", name: GROUNDED_PARAGRAPHS_NAME, input: answer, ...extra },
    });
    const cases: [string, BedrockConverseOutput][] = [
      ["truncated at the token cap", reply({ stopReason: "max_tokens" })],
      [
        "ended as plain text",
        reply({ stopReason: "end_turn" }, [{ text: JSON.stringify(answer) }]),
      ],
      ["text beside the tool use", reply({}, [{ text: "Here you go" }, tool()])],
      ["two tool uses", reply({}, [tool(), tool()])],
      ["reasoning block", reply({}, [{ reasoningContent: { reasoningText: { text: "hmm" } } }])],
      ["wrong tool", reply({}, [{ toolUse: { toolUseId: "t1", name: "other", input: answer } }])],
      [
        "non object input",
        reply({}, [{ toolUse: { toolUseId: "t1", name: GROUNDED_PARAGRAPHS_NAME, input: "x" } }]),
      ],
      [
        "array input",
        reply({}, [{ toolUse: { toolUseId: "t1", name: GROUNDED_PARAGRAPHS_NAME, input: [] } }]),
      ],
      ["no content", reply({}, [])],
      [
        "user role",
        { stopReason: "tool_use", output: { message: { role: "user", content: [tool()] } } },
      ],
      ["no message", { stopReason: "tool_use", output: {} }],
      ["no output", { stopReason: "tool_use" }],
      ["unexpected block key", reply({}, [{ toolUse: tool().toolUse, text: "x" }])],
    ];
    for (const [label, response] of cases) {
      const { provider } = setup(response);
      await expect(provider.complete(request()), label).rejects.toMatchObject({
        code: "PROVIDER_FAILED",
      });
    }
  });

  it("refuses output larger than the caller allows", async () => {
    const { provider } = setup();
    await expect(provider.complete({ ...request(), maxOutputChars: 10 })).rejects.toMatchObject({
      code: "OUTPUT_TOO_LARGE",
    });
  });

  it("hides provider errors, which may carry prompts or credentials", async () => {
    const { provider, converse } = setup();
    converse.mockRejectedValueOnce(
      new Error("AccessDeniedException: role arn:aws:iam::1:role/x prompt text"),
    );
    const failure = await provider.complete(request()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "PROVIDER_FAILED" });
    expect(String((failure as Error).message)).not.toContain("prompt text");
    expect(String((failure as Error).message)).not.toContain("arn:aws");
  });

  it("stops before the call when already aborted", async () => {
    const { provider, converse } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.complete(request(controller.signal))).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
    });
    expect(converse).not.toHaveBeenCalled();
  });

  it("serializes the tool input as the JSON text the gateway validates", () => {
    expect(toolJsonText(reply(), GROUNDED_PARAGRAPHS_NAME)).toEqual({
      text: JSON.stringify(answer),
    });
  });

  it("works through the gateway and keeps its kill switch and disclosure checks ahead of the port", async () => {
    const { provider, converse } = setup();
    const gateway = new ModelGateway(provider, { enabled: () => true });
    const base = {
      promptId: "cover_letter",
      promptVersion: "1",
      purpose: "cover_letter" as const,
      categories: ["profile_facts"] as const,
      system: "s",
      user: "u",
    };
    await expect(gateway.generate(base, undefined)).rejects.toMatchObject({
      code: "DISCLOSURE_MISSING",
    });
    expect(converse).not.toHaveBeenCalled();
    const result = await gateway.generate(base, {
      purpose: "cover_letter",
      categories: ["profile_facts"],
      approvedAt: new Date(),
    });
    expect(result.value).toEqual(answer);
    expect(result.model).toEqual({ provider: "bedrock", model: MODEL, version: MODEL });
    expect(converse).toHaveBeenCalledTimes(1);
  });

  it("reports the gateway timeout and aborts the call", async () => {
    const { provider, converse } = setup();
    converse.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () =>
            reject(new Error("private abort detail")),
          );
        }),
    );
    const gateway = new ModelGateway(provider, { enabled: () => true, timeoutMs: 5 });
    await expect(
      gateway.generate(
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
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(converse.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
  });
});
