import { nativeResumeTaskBinding } from "./native-resume-task-binding.js";
import { readNativeTaskAllocation } from "./native-task-metadata-core.js";
/** Resume scope has no provider work grant. Exact task identity comes from AWS self metadata. */
export async function readNativeResumeTaskBinding(
  options: Parameters<typeof readNativeTaskAllocation>[0],
) {
  try {
    if (!(options.enabled ?? (() => false))()) throw Error("NativeTaskBootstrapUnavailable");
    const environment = { ...options.environment };
    const configurationSha256 = environment.NATIVE_RESUME_CONFIGURATION_SHA256;
    if (
      environment.NATIVE_MATERIAL_WORK_ID !== undefined ||
      environment.NATIVE_MATERIAL_REQUEST_SHA256 !== undefined ||
      typeof configurationSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(configurationSha256)
    )
      throw Error("NativeTaskBootstrapUnavailable");
    const task = await readNativeTaskAllocation({ ...options, environment });
    return nativeResumeTaskBinding({
      schemaVersion: 1,
      kind: "tailored_resume",
      ...task,
      configurationSha256,
    });
  } catch {
    throw Error("NativeTaskBootstrapUnavailable");
  }
}
