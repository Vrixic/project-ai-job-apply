import type {
  BedrockConverseInput,
  BedrockConverseOutput,
  BedrockConversePort,
} from "@ai-job-apply/ai-sdk";
import { ProviderRefusedError } from "@ai-job-apply/ai-sdk/gateway";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { nativeTaskCredentials } from "./native-task-credentials.js";

const unavailable = () => Error("NativeImageConfigurationUnavailable");

/** The fixed regional runtime endpoint. With the private bedrock-runtime interface endpoint (ADR-059) its name resolves
 * to private addresses; the endpoint policy and the task role policy both limit the call to the reviewed model. */
export const NATIVE_BEDROCK_ENDPOINT = "https://bedrock-runtime.us-east-2.amazonaws.com";

type NativeCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };

/** Pure client configuration so the hardening is checkable without a network: one attempt, fixed region and endpoint,
 * no configured endpoint override, explicit ECS task credentials only and a silent logger (prompts and completions
 * are candidate material and must never reach a log, ADR-038). */
export function nativeBedrockClientConfig(options: {
  accountId: string;
  enabled: () => boolean;
  relativeUri: string | undefined;
  testCredentials?: NativeCredentials;
}) {
  return {
    region: "us-east-2",
    endpoint: NATIVE_BEDROCK_ENDPOINT,
    maxAttempts: 1,
    ignoreConfiguredEndpointUrls: true,
    credentials:
      options.testCredentials ??
      nativeTaskCredentials({
        relativeUri: options.relativeUri,
        accountId: options.accountId,
        enabled: options.enabled,
      }),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

/** Service errors that prove Bedrock rejected the request before any model work: permission denied (the kill switch
 * removes the invoke grant), a model or use case the account cannot call, a request the service did not accept, and
 * throttling. Anything else is an unknown outcome: ModelTimeoutException and ModelErrorException mean work happened,
 * server faults, aborts and transport errors may have happened (ADR-059 addendum 16). */
const DEFINITE_REFUSALS: ReadonlySet<string> = new Set([
  "AccessDeniedException",
  "ValidationException",
  "ResourceNotFoundException",
  "ThrottlingException",
  "ServiceQuotaExceededException",
  "ModelNotReadyException",
]);

/** Pure: true only for a service-reported client fault with a 4xx status, other than a request timeout. */
export function bedrockDefiniteRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $fault?: unknown; $metadata?: unknown };
  const metadata = candidate.$metadata;
  const status =
    metadata && typeof metadata === "object"
      ? (metadata as { httpStatusCode?: unknown }).httpStatusCode
      : undefined;
  return (
    typeof candidate.name === "string" &&
    DEFINITE_REFUSALS.has(candidate.name) &&
    candidate.$fault === "client" &&
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408
  );
}

/** One synchronous Converse call per request, on the task role of the native generation process. Nothing is stored at the
 * provider and nothing is logged here. Any failure is reported without provider text. */
export function createNativeBedrockConversePort(options: {
  accountId: string;
  enabled: () => boolean;
  testClient?: {
    send(
      command: ConverseCommand,
      options: { abortSignal: AbortSignal },
    ): Promise<ConverseCommandOutput>;
    destroy?(): void;
  };
  testCredentials?: NativeCredentials;
}): BedrockConversePort & { destroy(): void } {
  const injected = options.testClient;
  if (
    !/^[0-9]{12}$/u.test(options.accountId) ||
    ((injected || options.testCredentials) && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  const enabled = options.enabled;
  let sdk: BedrockRuntimeClient | undefined;
  let destroyed = false;
  const client = () => {
    if (injected) return injected;
    sdk ??= new BedrockRuntimeClient(
      nativeBedrockClientConfig({
        accountId: options.accountId,
        enabled,
        relativeUri: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
        ...(options.testCredentials ? { testCredentials: options.testCredentials } : {}),
      }),
    );
    return sdk;
  };
  return {
    async converse(
      input: BedrockConverseInput,
      callOptions: { abortSignal: AbortSignal },
    ): Promise<BedrockConverseOutput> {
      try {
        if (destroyed || !enabled()) throw unavailable();
        callOptions.abortSignal.throwIfAborted();
        // The provider builds this shape; the SDK's document type for the tool schema is wider than a plain record.
        const command = new ConverseCommand(input as unknown as ConverseCommandInput);
        let result: ConverseCommandOutput;
        try {
          result = await client().send(command, { abortSignal: callOptions.abortSignal });
        } catch (error) {
          // Only a definitive service rejection is a positive non-dispatch; it carries no provider text.
          if (!callOptions.abortSignal.aborted && bedrockDefiniteRefusal(error))
            throw new ProviderRefusedError();
          throw unavailable();
        }
        if (destroyed || !enabled() || callOptions.abortSignal.aborted) throw unavailable();
        return { stopReason: result.stopReason, output: result.output };
      } catch (error) {
        if (error instanceof ProviderRefusedError) throw error;
        throw unavailable();
      }
    },
    destroy() {
      destroyed = true;
      sdk?.destroy();
      injected?.destroy?.();
    },
  };
}
