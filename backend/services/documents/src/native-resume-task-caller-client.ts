import { createScopedNativeTaskCallerClient } from "./native-task-caller-client-core.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskCallerScope,
} from "./native-resume-task-binding.js";

export function createNativeResumeTaskCallerClient(
  options: Omit<Parameters<typeof createScopedNativeTaskCallerClient>[0], "scope"> & {
    binding: NativeResumeTaskBinding;
    targetArn: string;
  },
) {
  const scope = nativeResumeTaskCallerScope(options.binding, options.targetArn);
  return createScopedNativeTaskCallerClient({
    ...options,
    scope: { allocation: scope.binding.allocation, digest: scope.digest },
  });
}
