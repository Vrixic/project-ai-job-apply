import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import { createNativeOwnerRpcTransport } from "./native-owner-rpc-transport.js";
import {
  type NativeResumeBootstrap,
  validateNativeResumeBootstrap,
} from "./native-resume-owner-rpc-contract.js";
import type { NativeResumeIdentity } from "./native-resume-session.js";
import {
  nativeResumeSourceUnavailable,
  type NativeResumeSourceValue,
} from "./native-resume-source.js";
import {
  NATIVE_RESUME_SOURCE_INPUT_LIMIT,
  NATIVE_RESUME_SOURCE_OUTPUT_LIMIT,
  type NativeResumeSourceRequest,
  nativeResumeSourceRequestDigest,
  validateNativeResumeSourceOutput,
} from "./native-resume-source-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerClient } from "./native-resume-task-caller-client.js";

/** Original retained source only, over a separate pinned authenticated recipient. No scalar
 * completion, S3 credentials, rendering or source-location authority is supplied to the task. */
export function createNativeResumeSourceRpcClient(options: {
  binding: NativeResumeTaskBinding;
  bootstrap: NativeResumeBootstrap;
  targetArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: NonNullable<Parameters<typeof createNativeOwnerRpcTransport>[0]["testClient"]>;
  testCredentials?: NonNullable<
    Parameters<typeof createNativeResumeTaskCallerClient>[0]["testCredentials"]
  >;
}) {
  const binding = nativeResumeTaskBinding(options.binding);
  if (!validateNativeResumeBootstrap(options.bootstrap, binding))
    throw nativeResumeSourceUnavailable();
  const bootstrap: NativeResumeBootstrap = JSON.parse(nativeOwnerJson(options.bootstrap));
  const transport = createNativeOwnerRpcTransport<NativeResumeSourceRequest>({
    ...options,
    binding,
    inputLimit: NATIVE_RESUME_SOURCE_INPUT_LIMIT,
    outputLimit: NATIVE_RESUME_SOURCE_OUTPUT_LIMIT,
    requestDigest: (r) => nativeResumeSourceRequestDigest(binding, r),
    validateOutput: (v, r) => validateNativeResumeSourceOutput(v, binding, r),
    signer: createNativeResumeTaskCallerClient({ ...options, binding }),
  });
  return Object.freeze({
    async load(identity: Readonly<NativeResumeIdentity>): Promise<NativeResumeSourceValue> {
      try {
        if (nativeOwnerJson(identity) !== nativeOwnerJson(bootstrap.identity))
          throw nativeResumeSourceUnavailable();
        return (await transport.run({
          action: "load_source",
          bootstrap,
        })) as NativeResumeSourceValue;
      } catch {
        throw nativeResumeSourceUnavailable();
      }
    },
  });
}
