import { lockNativeResumePreparationAdmission } from "@ai-job-apply/applications-service/native-resume-admission";
import {
  createNativeMaterialLocationRuntime,
  createNativeResumeLocationRuntime,
} from "@ai-job-apply/documents-service/native-material-location";
import { lockNativeResumeJobAdmission } from "@ai-job-apply/jobs-service/native-resume-admission";

/** Reviewed metadata discovery only. Does not activate DNS/TLS or route generated bodies. */
export function nativeMaterialLocationsFromEnvironment(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv,
  packetProtectionEnabled: () => boolean,
) {
  if (environment.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED !== "true") return undefined;
  const baseHost = environment.NATIVE_MATERIAL_BASE_HOST ?? "";
  return createNativeMaterialLocationRuntime(
    databaseUrl,
    baseHost,
    () =>
      environment.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED === "true" &&
      environment.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED === "true" &&
      environment.NATIVE_MATERIAL_BASE_HOST === baseHost &&
      packetProtectionEnabled(),
  );
}

export function nativeResumeLocationsFromEnvironment(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv,
  packetProtectionEnabled: () => boolean,
) {
  if (environment.NATIVE_RESUME_READ_LOCATIONS_ENABLED !== "true") return undefined;
  const baseHost = environment.NATIVE_RESUME_BASE_HOST ?? "";
  const enabled = () =>
    environment.NATIVE_RESUME_READ_LOCATIONS_ENABLED === "true" &&
    environment.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED === "true" &&
    environment.NATIVE_RESUME_BASE_HOST === baseHost &&
    packetProtectionEnabled();
  return createNativeResumeLocationRuntime(
    databaseUrl,
    baseHost,
    {
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
    },
    enabled,
  );
}
