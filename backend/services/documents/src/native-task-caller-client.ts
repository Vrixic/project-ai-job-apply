import type { NativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeTaskCallerScope } from "./native-task-caller-contract.js";
import { createScopedNativeTaskCallerClient } from "./native-task-caller-client-core.js";

/** Existing cover-letter binding and wire digest remain unchanged. */
export function createNativeTaskCallerClient(options: {
  binding: NativeEvidenceBinding;
  targetArn: string;
  enabled?: () => boolean;
  testCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
}) {
  const scope = nativeTaskCallerScope(options.binding, options.targetArn);
  return createScopedNativeTaskCallerClient({
    ...options,
    scope: { allocation: scope.binding.allocation, digest: scope.digest },
  });
}
