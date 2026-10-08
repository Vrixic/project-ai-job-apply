import { nativeEvidenceBinding } from "./native-evidence-binding.js";
import { readNativeTaskAllocation } from "./native-task-metadata-core.js";
/** Cover-letter original work binding over the shared AWS self-metadata reader. */
export async function readNativeTaskBinding(
  options: Parameters<typeof readNativeTaskAllocation>[0],
) {
  try {
    if (!(options.enabled ?? (() => false))()) throw Error("NativeTaskBootstrapUnavailable");
    const environment = { ...options.environment };
    const work = environment.NATIVE_MATERIAL_WORK_ID,
      request = environment.NATIVE_MATERIAL_REQUEST_SHA256;
    if (
      typeof work !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(work) ||
      typeof request !== "string" ||
      !/^[a-f0-9]{64}$/u.test(request)
    )
      throw Error("NativeTaskBootstrapUnavailable");
    const task = await readNativeTaskAllocation({ ...options, environment });
    return nativeEvidenceBinding({
      ...task,
      original: {
        id: work,
        documentId: task.scope.generationId,
        purpose: "provider_dispatch",
        requestSha256: request,
      },
    });
  } catch {
    throw Error("NativeTaskBootstrapUnavailable");
  }
}
