import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
  type RestrictedPacketExportReader,
} from "@ai-job-apply/applications-service";
import { restrictedPacketExportFromEnvironment } from "@ai-job-apply/applications-service/restricted-packet-runtime";
import {
  type CandidateRightsPolicy,
  createBuildingCandidateExportAuthorizer,
} from "@ai-job-apply/profile-service";

/** Owning pool and exact Profile authority. Exposes only historical export reads, never writers. */
export function createNativeRestrictedPacketExportReader(
  databaseUrl: string,
  policy: CandidateRightsPolicy,
  environment: Record<string, string | undefined>,
) {
  const protection = restrictedPacketExportFromEnvironment(environment);
  if (!protection) return undefined;
  const authorize = createBuildingCandidateExportAuthorizer({
    enabled: protection.enabled,
    policy,
  });
  const client = createApplicationsDatabase(databaseUrl, { maxConnections: 1 });
  const store = new PostgresApplicationStore(client, undefined, {
    definitions: defaultFieldDefinitions(),
    restrictedPackets: protection,
    authorizeRestrictedPacketExport: authorize,
  });
  return Object.freeze({
    reader: Object.freeze({
      readExportPacketValues: store.readExportPacketValues.bind(store),
    }) satisfies RestrictedPacketExportReader,
    close: () => client.end({ timeout: 5 }),
  });
}
