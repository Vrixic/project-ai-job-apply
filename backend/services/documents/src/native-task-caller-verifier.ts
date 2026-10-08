import type { NativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeTaskCallerScope } from "./native-task-caller-contract.js";
import { createScopedNativeTaskCallerVerifier } from "./native-task-caller-verifier-core.js";

/** Existing cover-letter binding and wire digest remain unchanged. */
export function createNativeTaskCallerVerifier(options: {
  binding: NativeEvidenceBinding;
  targetArn: string;
  taskRoleArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testFetch?: typeof fetch;
}) {
  const scope = nativeTaskCallerScope(options.binding, options.targetArn);
  return createScopedNativeTaskCallerVerifier({
    ...options,
    scope: { allocation: scope.binding.allocation, digest: scope.digest },
  });
}
