import {
  type BackgroundResponseCapture,
  ModelGatewayError,
  type ModelProvider,
  type ProviderRequest,
} from "./gateway.js";
import { originalBackgroundResponse } from "./openai-background.js";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_RESPONSE_BYTES = 128_000;
const PARAGRAPHS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphs"],
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "factIds"],
        properties: {
          text: { type: "string" },
          factIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestBody(request: ProviderRequest, background: boolean) {
  return {
    model: "gpt-6-luna",
    instructions: request.system,
    input: request.user,
    store: false,
    stream: false,
    background,
    reasoning: { effort: "low" },
    max_output_tokens: Math.min(4_096, request.maxOutputChars),
    text: {
      format: {
        type: "json_schema",
        name: "grounded_paragraphs_v1",
        strict: true,
        schema: PARAGRAPHS_SCHEMA,
      },
    },
  };
}

function completedText(value: unknown): { text: string } {
  if (!record(value) || value.status !== "completed" || !Array.isArray(value.output))
    throw new ModelGatewayError("PROVIDER_FAILED");
  const messages = value.output.filter((item: unknown) => record(item) && item.type === "message");
  if (
    value.output.some(
      (item: unknown) => !record(item) || (item.type !== "message" && item.type !== "reasoning"),
    ) ||
    messages.length !== 1
  )
    throw new ModelGatewayError("PROVIDER_FAILED");
  const message: unknown = messages[0];
  if (
    !record(message) ||
    message.role !== "assistant" ||
    message.status !== "completed" ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  )
    throw new ModelGatewayError("PROVIDER_FAILED");
  const content: unknown = message.content[0];
  if (
    !record(content) ||
    content.type !== "output_text" ||
    typeof content.text !== "string" ||
    !content.text
  )
    throw new ModelGatewayError("PROVIDER_FAILED");
  return { text: content.text };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new ModelGatewayError("PROVIDER_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ModelGatewayError("PROVIDER_FAILED");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Development-only provider port. Compose exclusively through ModelGateway and generation. */
export class OpenAiLunaProvider implements ModelProvider {
  readonly identity = Object.freeze({
    provider: "openai",
    model: "gpt-6-luna",
    // The provider publishes an alias, not a dated snapshot. Do not imply reproducibility.
    version: "gpt-6-luna",
  });

  constructor(
    private readonly options: {
      /** Explicit activation, separate from having credentials. Defaults off. */
      enabled?: () => boolean;
      /** Separate opt-in for original background creation; foreground remains unchanged. */
      backgroundEnabled?: () => boolean;
      apiKey: () => string | undefined;
      /** Tests inject a transport; production composition uses native fetch. */
      fetch?: typeof fetch;
    },
  ) {}

  async complete(request: ProviderRequest): Promise<{ text: string }> {
    const result = await this.completeForLifecycle(request);
    if (result.text.length > request.maxOutputChars)
      throw new ModelGatewayError("OUTPUT_TOO_LARGE");
    return result;
  }

  async completeBackgroundForLifecycle(
    request: ProviderRequest,
    capture: BackgroundResponseCapture,
  ): Promise<{ text: string }> {
    try {
      const enabled = () =>
        this.options.enabled?.() === true && this.options.backgroundEnabled?.() === true;
      if (!enabled()) throw new ModelGatewayError("MODEL_DISABLED");
      request.signal.throwIfAborted();
      const apiKey = this.options.apiKey();
      if (!apiKey || !Number.isSafeInteger(request.maxOutputChars) || request.maxOutputChars < 1)
        throw new ModelGatewayError("PROVIDER_FAILED");
      const value = await originalBackgroundResponse({
        request,
        capture,
        enabled,
        apiKey,
        transport: this.options.fetch ?? globalThis.fetch,
        body: requestBody(request, true),
      });
      return completedText(value);
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    }
  }

  /** Internal gateway lifecycle only. Original bounded response, completed status and strict
   * message shape are verified here; the gateway applies character/JSON rejection afterwards.
   * Does not relax transport byte bounds, enable background work or provide abort stop proof.
   */
  async completeForLifecycle(request: ProviderRequest): Promise<{ text: string }> {
    try {
      if (this.options.enabled?.() !== true) throw new ModelGatewayError("MODEL_DISABLED");
      request.signal.throwIfAborted();
      const apiKey = this.options.apiKey();
      if (!apiKey || !Number.isSafeInteger(request.maxOutputChars) || request.maxOutputChars < 1) {
        throw new ModelGatewayError("PROVIDER_FAILED");
      }
      const response = await (this.options.fetch ?? globalThis.fetch)(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: request.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(request, false)),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ModelGatewayError("PROVIDER_FAILED");
      }
      const value = await readResponse(response);
      return completedText(value);
    } catch (error) {
      // Never expose provider bodies, prompts, credentials or transport exception messages.
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    }
  }
}
