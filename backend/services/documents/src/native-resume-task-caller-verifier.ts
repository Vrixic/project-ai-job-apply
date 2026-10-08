import { createScopedNativeTaskCallerVerifier } from "./native-task-caller-verifier-core.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskCallerScope,
} from "./native-resume-task-binding.js";

export function createNativeResumeTaskCallerVerifier(options: {
  binding: NativeResumeTaskBinding;
  targetArn: string;
  taskRoleArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testFetch?: typeof fetch;
}) {
  const scope = nativeResumeTaskCallerScope(options.binding, options.targetArn);
  return createScopedNativeTaskCallerVerifier({
    ...options,
    scope: { allocation: scope.binding.allocation, digest: scope.digest },
  });
}
