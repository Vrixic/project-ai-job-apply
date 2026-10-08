import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  type NativePreparationRouteInput,
  type NativePreparationRouteOutput,
  nativePreparationRouteUnavailable,
  validateNativePreparationRouteInput,
  validateNativePreparationRouteOutput,
} from "./native-preparation-route-contract.js";

interface Client {
  send(
    command: InvokeCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<{
    StatusCode?: number;
    ExecutedVersion?: string;
    FunctionError?: string;
    LogResult?: string;
    Payload?: Uint8Array;
  }>;
}

/** Metadata-only trusted sender. Signed fixed regional Lambda, one attempt and exact numeric
 * target. Lost/late acknowledgements grant no local settlement, absence proof or launch retry.
 * Reviewed sender IAM is a deployment gate; target equality alone does not authenticate callers. */
export function createNativePreparationRouteClient(options: {
  functionArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
}) {
  const target = options.functionArn;
  const version = nativeLaunchControlVersion(target);
  const enabled = options.enabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const injected = options.testClient;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (injected && process.env.NODE_ENV !== "test")
  )
    throw nativePreparationRouteUnavailable();
  let active = false;
  async function call(
    raw: NativePreparationRouteInput,
    action: NativePreparationRouteInput["action"],
  ): Promise<NativePreparationRouteOutput> {
    if (
      active ||
      !validateNativePreparationRouteInput(raw) ||
      raw.action !== action ||
      !enabled() ||
      (injected && process.env.NODE_ENV !== "test")
    )
      throw nativePreparationRouteUnavailable();
    const input = structuredClone(raw);
    const payload = new TextEncoder().encode(JSON.stringify(input));
    if (payload.length > 8_192) throw nativePreparationRouteUnavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const permitted = () => {
      controller.signal.throwIfAborted();
      if (!enabled() || (injected && process.env.NODE_ENV !== "test"))
        throw nativePreparationRouteUnavailable();
    };
    let owned: LambdaClient | undefined;
    active = true;
    try {
      permitted();
      if (!injected)
        owned = new LambdaClient({
          region: "us-east-2",
          endpoint: "https://lambda.us-east-2.amazonaws.com",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      const client = injected ?? owned;
      if (!client) throw nativePreparationRouteUnavailable();
      const reply = await client.send(
        new InvokeCommand({
          FunctionName: target,
          InvocationType: "RequestResponse",
          LogType: "None",
          Payload: payload,
        }),
        { abortSignal: controller.signal },
      );
      permitted();
      if (
        reply.StatusCode !== 200 ||
        reply.ExecutedVersion !== version ||
        reply.FunctionError !== undefined ||
        reply.LogResult !== undefined ||
        !(reply.Payload instanceof Uint8Array) ||
        reply.Payload.length < 1 ||
        reply.Payload.length > 8_192
      )
        throw nativePreparationRouteUnavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(reply.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateNativePreparationRouteOutput(output) ||
        JSON.stringify(output.request) !== JSON.stringify(input) ||
        output.outcome === "pending"
      )
        throw nativePreparationRouteUnavailable();
      return structuredClone(output);
    } catch {
      throw nativePreparationRouteUnavailable();
    } finally {
      clearTimeout(timer);
      owned?.destroy();
      active = false;
      // Admission stays occupied until the original transport settles, even if it ignores abort.
    }
  }
  return Object.freeze({
    run: (input: NativePreparationRouteInput) => call(input, input.action),
  });
}
