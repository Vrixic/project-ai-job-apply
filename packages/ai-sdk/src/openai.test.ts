import { describe, expect, it, vi } from "vitest";
import { ModelGateway, type ProviderRequest } from "./gateway.js";
import { generateCoverLetter } from "./generation.js";
import { OpenAiLunaProvider } from "./openai.js";

const text = JSON.stringify({ paragraphs: [{ text: "I build services.", factIds: ["f1"] }] });
const output = [
  {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  },
];
const request = (): ProviderRequest => ({
  system: "Return grounded JSON.",
  user: "Synthetic facts only.",
  maxOutputChars: 8_000,
  signal: new AbortController().signal,
});
const response = (value: unknown = { status: "completed", output }) =>
  new Response(JSON.stringify(value));
function setup(reply: Response = response()) {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(reply);
  const apiKey = vi.fn(() => "synthetic-key");
  const provider = new OpenAiLunaProvider({ enabled: () => true, apiKey, fetch: transport });
  return { provider, transport, apiKey };
}

describe("OpenAiLunaProvider (offline transport)", () => {
  it("stays disabled without activation, even with a credential", async () => {
    const { transport, apiKey } = setup();
    const provider = new OpenAiLunaProvider({ apiKey, fetch: transport });
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "MODEL_DISABLED" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the exact model and endpoint with strict schema, no storage, redirects, tools or retries", async () => {
    const { provider, transport } = setup();
    const input = request();
    await expect(provider.complete(input)).resolves.toEqual({ text });
    expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0];
    if (!call) throw new Error("Expected provider request");
    const [url, init] = call;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({ method: "POST", redirect: "error", signal: input.signal });
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      model: "gpt-6-luna",
      instructions: input.system,
      input: input.user,
      store: false,
      stream: false,
      background: false,
      reasoning: { effort: "low" },
      max_output_tokens: 4_096,
      text: {
        format: {
          type: "json_schema",
          name: "grounded_paragraphs_v1",
          strict: true,
          schema: expect.objectContaining({
            additionalProperties: false,
            required: ["paragraphs"],
          }),
        },
      },
    });
    expect(provider.identity).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
      version: "gpt-6-luna",
    });
    expect(Object.isFrozen(provider.identity)).toBe(true);
  });

  it("allows reasoning before the final message", async () => {
    const { provider } = setup(
      response({ status: "completed", output: [{ type: "reasoning", summary: [] }, ...output] }),
    );
    await expect(provider.complete(request())).resolves.toEqual({ text });
  });

  it.each([undefined, ""])("fails closed on missing credentials (%s)", async (key) => {
    const { transport } = setup();
    const provider = new OpenAiLunaProvider({
      enabled: () => true,
      apiKey: () => key,
      fetch: transport,
    });
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([400, 401, 429, 500])(
    "drops HTTP %s without retry or provider error reflection",
    async (status) => {
      const { provider, transport } = setup(
        new Response("private provider error synthetic-key", { status }),
      );
      await expect(provider.complete(request())).rejects.toThrow(
        "Model gateway refused: PROVIDER_FAILED",
      );
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { status: "incomplete", output },
    { status: "failed", output },
    { status: "completed", output: [] },
    { status: "completed", output: [...output, ...output] },
    { status: "completed", output: [{ type: "function_call" }, ...output] },
    { status: "completed", output: [{ ...output[0], role: "user" }] },
    { status: "completed", output: [{ ...output[0], status: "incomplete" }] },
    {
      status: "completed",
      output: [{ ...output[0], content: [{ type: "refusal", refusal: "private content" }] }],
    },
    { status: "completed", output: [{ ...output[0], content: [] }] },
    {
      status: "completed",
      output: [{ ...output[0], content: [{ type: "output_text", text: "" }] }],
    },
    null,
  ])("rejects malformed, refused, incomplete or unexpected output %#", async (value) => {
    const { provider } = setup(response(value));
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("bounds the entire response stream, even without content-length", async () => {
    const { provider } = setup(new Response("x".repeat(128_001)));
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("enforces character limits separately from the token ceiling", async () => {
    const { provider } = setup();
    await expect(provider.complete({ ...request(), maxOutputChars: 5 })).rejects.toMatchObject({
      code: "OUTPUT_TOO_LARGE",
    });
  });

  it("sanitizes network exceptions and malformed JSON", async () => {
    const { provider, transport } = setup();
    transport.mockRejectedValueOnce(new Error("private prompt synthetic-key"));
    await expect(provider.complete(request())).rejects.toThrow(
      "Model gateway refused: PROVIDER_FAILED",
    );
    transport.mockResolvedValueOnce(new Response("not JSON"));
    await expect(provider.complete(request())).rejects.toThrow(
      "Model gateway refused: PROVIDER_FAILED",
    );
  });

  it("does not send an already aborted request", async () => {
    const { provider, transport, apiKey } = setup();
    await expect(
      provider.complete({ ...request(), signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("sanitizes activation and credential resolver failures without contacting the provider", async () => {
    const { transport } = setup();
    const fail = () => {
      throw new Error("private configuration detail");
    };
    const disabled = new OpenAiLunaProvider({
      enabled: fail,
      apiKey: () => "synthetic-key",
      fetch: transport,
    });
    const credentialFailure = new OpenAiLunaProvider({
      enabled: () => true,
      apiKey: fail,
      fetch: transport,
    });
    await expect(disabled.complete(request())).rejects.toThrow(
      "Model gateway refused: PROVIDER_FAILED",
    );
    await expect(credentialFailure.complete(request())).rejects.toThrow(
      "Model gateway refused: PROVIDER_FAILED",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps gateway disclosure and kill-switch checks ahead of credential access", async () => {
    const { provider, transport, apiKey } = setup();
    const gateway = new ModelGateway(provider, { enabled: () => true });
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
        undefined,
      ),
    ).rejects.toMatchObject({ code: "DISCLOSURE_MISSING" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates gateway cancellation to the transport without leaking its error", async () => {
    const { provider, transport } = setup();
    transport.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("private abort detail")));
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
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("passes through grounding and mandatory review, never approving a provider draft", async () => {
    const { provider } = setup();
    const result = await generateCoverLetter({
      gateway: new ModelGateway(provider, { enabled: () => true }),
      now: new Date(),
      disclosure: {
        purpose: "cover_letter",
        categories: ["profile_facts", "job_posting"],
        approvedAt: new Date(),
      },
      job: { title: "Engineer", company: "Synthetic", description: "Build services." },
      facts: [
        {
          id: "f1",
          kind: "project",
          key: "project",
          value: "I build services.",
          verification: "confirmed",
          sensitivity: "standard",
          source: { type: "user", reference: "synthetic" },
          version: 1,
        },
      ],
    });
    expect(result.status).toBe("needs_review");
    expect(result.paragraphs).toEqual([{ text: "I build services.", factIds: ["f1"] }]);
  });
});
