import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import {
  type NativeOwnerRpcOutput,
  nativeOwnerJson,
  nativeOwnerRpcUnavailable,
} from "./native-owner-rpc-contract.js";
import type { NativeTaskCallerProof } from "./native-task-caller-contract.js";
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

/** Internal shared one-attempt transport. Public clients supply validated immutable kind-specific
 * binding, signer and request/response validation. No unscoped transport package export exists. */
export function createNativeOwnerRpcTransport<Request>(options: {
  binding: { allocation: { clusterArn: string } };
  targetArn: string;
  inputLimit: number;
  outputLimit: number;
  requestDigest(request: Request): string;
  validateOutput(value: unknown, request: Request): value is NativeOwnerRpcOutput;
  signer: { proof(digest: string): Promise<Readonly<NativeTaskCallerProof>> };
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
  testCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
}) {
  const binding = options.binding;
  const target = options.targetArn;
  const version = nativeLaunchControlVersion(target);
  const enabled = options.enabled ?? (() => false);
  const injected = options.testClient;
  const credentials = options.testCredentials ? { ...options.testCredentials } : undefined;
  const timeout = options.timeoutMs ?? 10_000;
  const inputLimit = options.inputLimit,
    outputLimit = options.outputLimit;
  const requestDigest = options.requestDigest,
    validateOutput = options.validateOutput;
  const signProof = options.signer.proof.bind(options.signer);
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    ((injected || credentials) && process.env.NODE_ENV !== "test")
  )
    throw nativeOwnerRpcUnavailable();
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
  async function run(raw: Request): Promise<unknown> {
    if (active || !permitted()) throw nativeOwnerRpcUnavailable();
    const digest = requestDigest(raw);
    const request = JSON.parse(nativeOwnerJson(raw)) as Request;
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let owned: LambdaClient | undefined;
    let payload: Uint8Array | undefined;
    let received: Uint8Array | undefined;
    try {
      const proof = await signProof(digest);
      if (!permitted() || controller.signal.aborted) throw nativeOwnerRpcUnavailable();
      payload = new TextEncoder().encode(
        nativeOwnerJson({ schemaVersion: 1, binding, request, proof }),
      );
      if (payload.length > inputLimit) throw nativeOwnerRpcUnavailable();
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
        received.length > outputLimit
      )
        throw nativeOwnerRpcUnavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(received);
      const output: unknown = JSON.parse(text);
      nativeOwnerJson(output);
      if (
        // Lambda preserves handler property order. Round-trip its compact JSON while still
        // rejecting duplicate keys and ambiguous encodings; digests remain canonical.
        JSON.stringify(output) !== text ||
        !validateOutput(output, request) ||
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
  return Object.freeze({ run });
}
