import { lockNativeResumePreparationAdmission } from "@ai-job-apply/applications-service/native-resume-admission";
import type { NativeResumeGenerationOwnerPorts } from "@ai-job-apply/documents-service/native-resume-generation-store";
import { lockNativeResumeJobAdmission } from "@ai-job-apply/jobs-service/native-resume-admission";

/** Only scalar admission on Documents' original transaction. No content, pool, RPC, provider,
 * launch or generation capability. Managed composition remains independently default off. */
export function createNativeResumeGenerationOwnerPorts(
  enabled: () => boolean = () => false,
): NativeResumeGenerationOwnerPorts {
  const ports: NativeResumeGenerationOwnerPorts = {
    application: (intent, query) => lockNativeResumePreparationAdmission(intent, query, enabled),
    job: (intent, jobContextSha256, query) =>
      lockNativeResumeJobAdmission(
        {
          canonicalJobId: intent.canonicalJobId,
          jobRevision: intent.jobRevision,
          jobContextSha256,
        },
        query,
        enabled,
      ),
  };
  return Object.freeze(ports);
}
