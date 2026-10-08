import type { ApplicationStoreOptions } from "@ai-job-apply/applications-service";
import { lockNativeResumePreparationAdmission } from "@ai-job-apply/applications-service/native-resume-admission";
import {
  lockNativeResumeReadyForPacket,
  type NativeResumeGenerationOwnerPorts,
} from "@ai-job-apply/documents-service/native-resume-generation-store";
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

/** Applications holds its existing transaction while each owner supplies scalar admission. */
export function createNativeResumePacketAuthority(
  enabled: () => boolean = () => false,
): NonNullable<ApplicationStoreOptions["nativeResumeMaterials"]> {
  const owners = createNativeResumeGenerationOwnerPorts(enabled);
  return Object.freeze({
    enabled,
    lockReady: (intent, reference, query) =>
      lockNativeResumeReadyForPacket(intent, reference, query, owners.job, enabled),
  });
}
