import type { RestrictedPacketPlaintext } from "./restricted-packet-cipher.js";
import type { VaultAdmissionQuery } from "./vault.js";

export interface RestrictedPacketExportScope {
  ownerUserId: string;
  exportId: string;
  operationId: string;
  policyVersion: string;
}
/** Profile-owned exact building-request admission using the caller's bounded transaction.
 * It may run only database checks/locks; no KMS/provider/artifact I/O. */
export type RestrictedPacketExportAuthorizer = (
  scope: RestrictedPacketExportScope,
  query: VaultAdmissionQuery,
) => Promise<void>;
export interface RestrictedPacketExportReference {
  applicationId: string;
  packetId: string;
  packetHash: string;
  fieldKeys: readonly string[];
}
/** Private rights builder only; never the current-review or submission endpoint. */
export interface RestrictedPacketExportReader {
  readExportPacketValues(
    command: RestrictedPacketExportScope & {
      applicationId: string;
      packetId: string;
      packetHash: string;
    },
  ): Promise<RestrictedPacketPlaintext>;
}
