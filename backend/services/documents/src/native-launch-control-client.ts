import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  type NativeLaunchControlCapture,
  type NativeLaunchControlInput,
  nativeLaunchControlUnavailable,
  nativeLaunchControlVersion,
  validateNativeLaunchControlInput,
  validateNativeLaunchControlOutput,
} from "./native-launch-control-contract.js";

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
export function createNativeLaunchControlClient(options: {
  functionArn: string;
  enabled?: () => boolean;
  launchEnabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
}) {
  const target = options.functionArn;
  const version = nativeLaunchControlVersion(target);
  const enabled = options.enabled ?? (() => false);
  const launchEnabled = options.launchEnabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const injected = options.testClient;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (injected && process.env.NODE_ENV !== "test")
  )
    throw nativeLaunchControlUnavailable();
  let active = false;
  async function call(
    raw: NativeLaunchControlInput,
    action: NativeLaunchControlInput["action"],
  ): Promise<NativeLaunchControlCapture> {
    if (
      active ||
      !validateNativeLaunchControlInput(raw) ||
      raw.action !== action ||
      !enabled() ||
      (raw.action === "launch" && !launchEnabled()) ||
      (injected && process.env.NODE_ENV !== "test")
    )
      throw nativeLaunchControlUnavailable();
    const input = structuredClone(raw);
    const payload = new TextEncoder().encode(JSON.stringify(input));
    if (payload.length > 8_192) throw nativeLaunchControlUnavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const permitted = () => {
      controller.signal.throwIfAborted();
      if (
        !enabled() ||
        (input.action === "launch" && !launchEnabled()) ||
        (injected && process.env.NODE_ENV !== "test")
      )
        throw nativeLaunchControlUnavailable();
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
      if (!client) throw nativeLaunchControlUnavailable();
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
        throw nativeLaunchControlUnavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(reply.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateNativeLaunchControlOutput(output) ||
        JSON.stringify(output.request) !== JSON.stringify(input) ||
        output.outcome !== "captured" ||
        !output.capture
      )
        throw nativeLaunchControlUnavailable();
      return structuredClone(output.capture);
    } catch {
      throw nativeLaunchControlUnavailable();
    } finally {
      clearTimeout(timer);
      owned?.destroy();
      active = false;
      // Admission stays occupied until the original transport settles, even if it ignores abort.
    }
  }
  return Object.freeze({
    launch: (input: Extract<NativeLaunchControlInput, { action: "launch" }>) =>
      call(input, "launch"),
    recover: (input: Extract<NativeLaunchControlInput, { action: "recover" }>) =>
      call(input, "recover"),
  });
}
