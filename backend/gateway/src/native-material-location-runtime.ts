import { createNativeMaterialLocationRuntime } from "@ai-job-apply/documents-service/native-material-location";

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
