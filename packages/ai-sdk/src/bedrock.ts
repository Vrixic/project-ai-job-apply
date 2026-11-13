import {
  ModelGatewayError,
  type ModelIdentity,
  type ModelProvider,
  type ProviderRequest,
} from "./gateway.js";
import { GROUNDED_PARAGRAPHS_NAME, GROUNDED_PARAGRAPHS_SCHEMA } from "./provider-output-schema.js";

/**
 * ADR-059: Amazon Bedrock in the platform's own AWS account, through the Converse API and a US inference profile.
 *
 * The provider owns the request shape and the strict reading of the reply; the transport (credentials, endpoint,
 * region, retries) is an injected port so this package carries no cloud SDK. The request asks for nothing the ADR
 * keeps off: no prompt caching, no guardrails or trace, no performance configuration, no extra model fields, no
 * reasoning blocks and no images. Output is forced through one tool so the model can only return JSON that matches
 * the schema, which the gateway and the grounding checks then validate again.
 */

const MODEL_ID = /^us\.[a-z0-9]+\.[a-z0-9][a-z0-9.-]{0,120}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const MAX_TOKEN_CAP = 4_096;

export interface BedrockConverseInput {
  modelId: string;
  system: readonly { text: string }[];
  messages: readonly { role: "user"; content: readonly { text: string }[] }[];
  inferenceConfig: { maxTokens: number; temperature: number };
  toolConfig: {
    tools: readonly {
      toolSpec: {
        name: string;
        description: string;
        inputSchema: { json: Record<string, unknown> };
      };
    }[];
    toolChoice: { tool: { name: string } };
  };
}

export interface BedrockConverseOutput {
  stopReason?: unknown;
  output?: unknown;
}

/** One synchronous Converse call. The implementation must make one attempt, send no content to a log and honour the abort signal. */
export interface BedrockConversePort {
  converse(
    input: BedrockConverseInput,
    options: { abortSignal: AbortSignal },
  ): Promise<BedrockConverseOutput>;
}

export interface BedrockOutputSchema {
  /** Tool name, and the schema's identity in diagnostics-free results. */
  name: string;
  schema: Record<string, unknown>;
}

export function validBedrockModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Exactly one assistant message holding exactly one tool use of the forced tool; anything else is a failure. */
export function toolJsonText(value: BedrockConverseOutput, toolName: string): { text: string } {
  if (!record(value) || value.stopReason !== "tool_use")
    throw new ModelGatewayError("PROVIDER_FAILED");
  const output: unknown = value.output;
  if (!record(output)) throw new ModelGatewayError("PROVIDER_FAILED");
  const message: unknown = output.message;
  if (
    !record(message) ||
    message.role !== "assistant" ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  )
    throw new ModelGatewayError("PROVIDER_FAILED");
  const block: unknown = message.content[0];
  if (!record(block) || Object.keys(block).join(",") !== "toolUse")
    throw new ModelGatewayError("PROVIDER_FAILED");
  const toolUse: unknown = block.toolUse;
  if (!record(toolUse) || toolUse.name !== toolName || !record(toolUse.input))
    throw new ModelGatewayError("PROVIDER_FAILED");
  const text = JSON.stringify(toolUse.input);
  if (typeof text !== "string" || text.length < 2) throw new ModelGatewayError("PROVIDER_FAILED");
  return { text };
}

/** Compose exclusively through ModelGateway and generation. Off unless `enabled` returns true. */
export class BedrockConverseProvider implements ModelProvider {
  readonly identity: Readonly<ModelIdentity>;
  private readonly output: Readonly<BedrockOutputSchema>;
  private readonly maxOutputTokens: number;

  constructor(
    private readonly options: {
      /** The inference profile id, for example `us.anthropic.claude-sonnet-4-6`. It must be one the role policy allows. */
      modelId: string;
      /** Explicit activation, separate from having credentials. Defaults off. */
      enabled?: () => boolean;
      port: BedrockConversePort;
      /** Defaults to the grounded paragraphs schema used for cover letters and answers. */
      output?: BedrockOutputSchema;
      /** Per-request output token cap (ADR-059 decision 6). Never more than 4,096. */
      maxOutputTokens?: number;
    },
  ) {
    if (!validBedrockModelId(options.modelId)) throw new ModelGatewayError("PROVIDER_FAILED");
    const output = options.output ?? {
      name: GROUNDED_PARAGRAPHS_NAME,
      schema: GROUNDED_PARAGRAPHS_SCHEMA,
    };
    const cap = options.maxOutputTokens ?? MAX_TOKEN_CAP;
    if (
      !TOOL_NAME.test(output.name) ||
      !Number.isSafeInteger(cap) ||
      cap < 1 ||
      cap > MAX_TOKEN_CAP
    )
      throw new ModelGatewayError("PROVIDER_FAILED");
    this.output = Object.freeze({ name: output.name, schema: structuredClone(output.schema) });
    this.maxOutputTokens = cap;
    // A US profile is an alias that AWS may repoint within a model generation; do not imply a dated snapshot.
    this.identity = Object.freeze({
      provider: "bedrock",
      model: options.modelId,
      version: options.modelId,
    });
  }

  async complete(request: ProviderRequest): Promise<{ text: string }> {
    const result = await this.completeForLifecycle(request);
    if (result.text.length > request.maxOutputChars)
      throw new ModelGatewayError("OUTPUT_TOO_LARGE");
    return result;
  }

  async completeForLifecycle(request: ProviderRequest): Promise<{ text: string }> {
    try {
      if (this.options.enabled?.() !== true) throw new ModelGatewayError("MODEL_DISABLED");
      request.signal.throwIfAborted();
      if (!Number.isSafeInteger(request.maxOutputChars) || request.maxOutputChars < 1)
        throw new ModelGatewayError("PROVIDER_FAILED");
      const response = await this.options.port.converse(
        {
          modelId: this.options.modelId,
          system: [{ text: request.system }],
          messages: [{ role: "user", content: [{ text: request.user }] }],
          inferenceConfig: {
            maxTokens: Math.min(this.maxOutputTokens, request.maxOutputChars),
            temperature: 0,
          },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: this.output.name,
                  description: "Return the answer in exactly this JSON shape.",
                  inputSchema: { json: this.output.schema },
                },
              },
            ],
            toolChoice: { tool: { name: this.output.name } },
          },
        },
        { abortSignal: request.signal },
      );
      request.signal.throwIfAborted();
      return toolJsonText(response, this.output.name);
    } catch (error) {
      // Never expose provider bodies, prompts, credentials or transport exception messages.
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    }
  }
}
