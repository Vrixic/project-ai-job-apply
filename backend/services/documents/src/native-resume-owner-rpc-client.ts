import { nativeOwnerJson, validateNativeOwnerPrincipal } from "./native-owner-rpc-contract.js";
import { createNativeOwnerRpcTransport } from "./native-owner-rpc-transport.js";
import {
  NATIVE_RESUME_OWNER_INPUT_LIMIT,
  NATIVE_RESUME_OWNER_OUTPUT_LIMIT,
  type NativeResumeOwnerRequest,
  nativeResumeOwnerRequestDigest,
  nativeResumeOwnerUnavailable,
  validateNativeResumeBootstrap,
  validateNativeResumeOwnerRpcOutput,
} from "./native-resume-owner-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerClient } from "./native-resume-task-caller-client.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

/** Scalar task controls only. No content, source read, issue/renew, SQL or launch capability. */
export function createNativeResumeOwnerRpcClient(options: {
  binding: NativeResumeTaskBinding;
  targetArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Parameters<typeof createNativeOwnerRpcTransport>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeResumeTaskCallerClient>[0]["testCredentials"];
}) {
  const binding = nativeResumeTaskBinding(options.binding);
  const transport = createNativeOwnerRpcTransport<NativeResumeOwnerRequest>({
    binding,
    targetArn: options.targetArn,
    inputLimit: NATIVE_RESUME_OWNER_INPUT_LIMIT,
    outputLimit: NATIVE_RESUME_OWNER_OUTPUT_LIMIT,
    requestDigest: (request) => nativeResumeOwnerRequestDigest(binding, request),
    validateOutput: (output, request) =>
      validateNativeResumeOwnerRpcOutput(output, binding, request),
    signer: createNativeResumeTaskCallerClient({
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
  async function run(request: NativeResumeOwnerRequest): Promise<unknown> {
    try {
      return await transport.run(request);
    } catch {
      throw nativeResumeOwnerUnavailable();
    }
  }
  return Object.freeze({
    run,
    async checkAdmission(raw: Readonly<NativeResumeTaskBinding>) {
      if (nativeOwnerJson(nativeResumeTaskBinding(raw)) !== nativeOwnerJson(binding))
        throw nativeResumeOwnerUnavailable();
      await run({ action: "admit" });
    },
    async bootstrap() {
      const result = await run({ action: "bootstrap" });
      if (!validateNativeResumeBootstrap(result, binding)) throw nativeResumeOwnerUnavailable();
      return structuredClone(result);
    },
    async principal(issuer: string) {
      const result = await run({ action: "principal", issuer });
      if (!validateNativeOwnerPrincipal(result, issuer)) throw nativeResumeOwnerUnavailable();
      return { ...result };
    },
    async claimOriginalCompletion(
      material: Readonly<TemporaryMaterialReference>,
    ): Promise<"claimed" | "already_completed" | "unavailable"> {
      try {
        const result = (await run({ action: "completion", material })) as {
          outcome: "claimed" | "already_completed";
        };
        return result.outcome;
      } catch {
        return "unavailable";
      }
    },
    async publishReady(material: Readonly<TemporaryMaterialReference>): Promise<void> {
      await run({ action: "publish_ready", material });
    },
  });
}
