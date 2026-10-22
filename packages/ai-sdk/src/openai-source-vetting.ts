import { ModelGatewayError, type ModelProvider, type ProviderRequest } from "./gateway.js";
import { completedText, readResponse } from "./openai.js";
import { vettingConcernCodes } from "./source-vetting.js";

const ENDPOINT = "https://api.openai.com/v1/responses";

const VETTING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "concerns", "confidence"],
  properties: {
    decision: { type: "string", enum: ["accept", "defer"] },
    concerns: { type: "array", items: { type: "string", enum: [...vettingConcernCodes] } },
    confidence: { type: "number" },
  },
};

function requestBody(request: ProviderRequest) {
  return {
    model: "gpt-6-luna",
    instructions: request.system,
    input: request.user,
    // Zero provider retention is requested on every call (ADR-054). Account-level zero data
    // retention is an owner action the code cannot establish.
    store: false,
    stream: false,
    background: false,
    reasoning: { effort: "low" },
    max_output_tokens: Math.min(512, request.maxOutputChars),
    text: {
      format: {
        type: "json_schema",
        name: "source_vetting_v1",
        strict: true,
        schema: VETTING_SCHEMA,
      },
    },
  };
}

/** Foreground-only provider port for source vetting. Compose it only through SourceVettingGateway. */
export class OpenAiSourceVettingProvider implements ModelProvider {
  readonly identity = Object.freeze({
    provider: "openai",
    model: "gpt-6-luna",
    version: "gpt-6-luna",
  });

  constructor(
    private readonly options: {
      /** Explicit activation, separate from having credentials. Defaults off. */
      enabled?: () => boolean;
      apiKey: () => string | undefined;
      /** Tests inject a transport; production composition uses native fetch. */
      fetch?: typeof fetch;
    },
  ) {}

  async complete(request: ProviderRequest): Promise<{ text: string }> {
    try {
      if (this.options.enabled?.() !== true) throw new ModelGatewayError("MODEL_DISABLED");
      request.signal.throwIfAborted();
      const apiKey = this.options.apiKey();
      if (!apiKey || !Number.isSafeInteger(request.maxOutputChars) || request.maxOutputChars < 1)
        throw new ModelGatewayError("PROVIDER_FAILED");
      const response = await (this.options.fetch ?? globalThis.fetch)(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: request.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(request)),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ModelGatewayError("PROVIDER_FAILED");
      }
      const result = completedText(await readResponse(response));
      if (result.text.length > request.maxOutputChars)
        throw new ModelGatewayError("OUTPUT_TOO_LARGE");
      return result;
    } catch (error) {
      // Never expose provider bodies, prompts, credentials or transport exception messages.
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    }
  }
}
