import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import {
  NATIVE_OWNER_INPUT_LIMIT,
  NATIVE_OWNER_OUTPUT_LIMIT,
  type NativeOwnerRequest,
  nativeOwnerJson,
  nativeOwnerRequestDigest,
  nativeOwnerRpcUnavailable,
  validateNativeOwnerBootstrap,
  validateNativeOwnerPrincipal,
  validateNativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import { createNativeOwnerRpcTransport } from "./native-owner-rpc-transport.js";
import { createNativeTaskCallerClient } from "./native-task-caller-client.js";

/** Fixed original cover-letter task/recipient. Existing wire contract and digest are unchanged. */
export function createNativeOwnerRpcClient(options: {
  binding: NativeEvidenceBinding;
  targetArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Parameters<typeof createNativeOwnerRpcTransport>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeTaskCallerClient>[0]["testCredentials"];
}) {
  const binding = nativeEvidenceBinding(options.binding);
  const { run } = createNativeOwnerRpcTransport<NativeOwnerRequest>({
    binding,
    targetArn: options.targetArn,
    inputLimit: NATIVE_OWNER_INPUT_LIMIT,
    outputLimit: NATIVE_OWNER_OUTPUT_LIMIT,
    requestDigest: (request) => nativeOwnerRequestDigest(binding, request),
    validateOutput: (output, request) => validateNativeOwnerRpcOutput(output, binding, request),
    signer: createNativeTaskCallerClient({
      binding,
      targetArn: options.targetArn,
      ...(options.enabled ? { enabled: options.enabled } : {}),
      ...(options.testCredentials ? { testCredentials: options.testCredentials } : {}),
    }),
    ...(options.enabled ? { enabled: options.enabled } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.testClient ? { testClient: options.testClient } : {}),
    ...(options.testCredentials ? { testCredentials: options.testCredentials } : {}),
  });
  return Object.freeze({
    run,
    async principal(issuer: string) {
      const result = await run({ action: "principal", issuer });
      if (!validateNativeOwnerPrincipal(result, issuer)) throw nativeOwnerRpcUnavailable();
      return { ...result };
    },
    async bootstrap() {
      const result = await run({ action: "bootstrap" });
      if (!validateNativeOwnerBootstrap(result, binding)) throw nativeOwnerRpcUnavailable();
      return {
        ...result,
        approvedAt: new Date(result.approvedAt),
        expiresAt: new Date(result.expiresAt),
      };
    },
    async checkAdmission(raw: Readonly<NativeEvidenceBinding>) {
      if (nativeOwnerJson(nativeEvidenceBinding(raw)) !== nativeOwnerJson(binding))
        throw nativeOwnerRpcUnavailable();
      await run({ action: "admit" });
    },
  });
}
