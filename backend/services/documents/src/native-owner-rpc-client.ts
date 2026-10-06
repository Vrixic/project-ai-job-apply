import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import {
  NATIVE_OWNER_INPUT_LIMIT,
  NATIVE_OWNER_OUTPUT_LIMIT,
  type NativeOwnerRequest,
  nativeOwnerJson,
  nativeOwnerRequestDigest,
  nativeOwnerRpcUnavailable,
  validateNativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import { createNativeTaskCallerClient } from "./native-task-caller-client.js";
import { nativeTaskCredentials } from "./native-task-credentials.js";

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
/** Fixed original task/recipient. No retry, issue, renewal, background settlement, SQL or storage.
 * Ephemeral proof/request bytes remain admitted until the original transport settles. */
export function createNativeOwnerRpcClient(options: {
  binding: NativeEvidenceBinding;
  targetArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
  testCredentials?: Parameters<typeof createNativeTaskCallerClient>[0]["testCredentials"];
}) {
  const binding = nativeEvidenceBinding(options.binding);
  const target = options.targetArn;
  const version = nativeLaunchControlVersion(target);
  const enabled = options.enabled ?? (() => false);
  const injected = options.testClient;
  const credentials = options.testCredentials;
  const timeout = options.timeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    ((injected || credentials) && process.env.NODE_ENV !== "test")
  )
    throw nativeOwnerRpcUnavailable();
  const signer = createNativeTaskCallerClient({
    binding,
    targetArn: target,
    enabled,
    ...(credentials ? { testCredentials: credentials } : {}),
  });
  const taskCredentials = nativeTaskCredentials({
    relativeUri: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
    accountId: binding.allocation.clusterArn.split(":")[4] ?? "",
    enabled,
  });
  let active = false;
  const permitted = () => {
    try {
      return enabled() && (!(injected || credentials) || process.env.NODE_ENV === "test");
    } catch {
      return false;
    }
  };
  async function run(raw: NativeOwnerRequest): Promise<unknown> {
    if (active || !permitted()) throw nativeOwnerRpcUnavailable();
    const digest = nativeOwnerRequestDigest(binding, raw);
    const request = JSON.parse(nativeOwnerJson(raw)) as NativeOwnerRequest;
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let owned: LambdaClient | undefined;
    let payload: Uint8Array | undefined;
    let received: Uint8Array | undefined;
    try {
      const proof = await signer.proof(digest);
      if (!permitted() || controller.signal.aborted) throw nativeOwnerRpcUnavailable();
      payload = new TextEncoder().encode(
        nativeOwnerJson({ schemaVersion: 1, binding, request, proof }),
      );
      if (payload.length > NATIVE_OWNER_INPUT_LIMIT) throw nativeOwnerRpcUnavailable();
      if (!injected)
        owned = new LambdaClient({
          region: "us-east-2",
          endpoint: "https://lambda.us-east-2.amazonaws.com",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          credentials: credentials ?? taskCredentials,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      const client = injected ?? owned;
      if (!client || !permitted()) throw nativeOwnerRpcUnavailable();
      const reply = await client.send(
        new InvokeCommand({
          FunctionName: target,
          InvocationType: "RequestResponse",
          LogType: "None",
          Payload: payload,
        }),
        { abortSignal: controller.signal },
      );
      received = reply.Payload;
      if (
        !permitted() ||
        controller.signal.aborted ||
        reply.StatusCode !== 200 ||
        reply.ExecutedVersion !== version ||
        reply.FunctionError !== undefined ||
        reply.LogResult !== undefined ||
        !(received instanceof Uint8Array) ||
        received.length < 1 ||
        received.length > NATIVE_OWNER_OUTPUT_LIMIT
      )
        throw nativeOwnerRpcUnavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(received);
      const output: unknown = JSON.parse(text);
      if (
        nativeOwnerJson(output) !== text ||
        !validateNativeOwnerRpcOutput(output, binding, request) ||
        output.outcome !== "ready"
      )
        throw nativeOwnerRpcUnavailable();
      const result = structuredClone(output.result);
      return result;
    } catch {
      throw nativeOwnerRpcUnavailable();
    } finally {
      clearTimeout(timer);
      payload?.fill(0);
      received?.fill(0);
      owned?.destroy();
      active = false;
    }
  }
  return Object.freeze({
    run,
    async checkAdmission(raw: Readonly<NativeEvidenceBinding>) {
      if (nativeOwnerJson(nativeEvidenceBinding(raw)) !== nativeOwnerJson(binding))
        throw nativeOwnerRpcUnavailable();
      await run({ action: "admit" });
    },
  });
}
