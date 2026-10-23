import {
  type CandidateRightsPolicy,
  candidateRightsOwnerInventoryWithApplications,
  candidateRightsOwnerInventoryWithNotifications,
} from "./candidate-rights.js";

export interface CandidateExportAdmissionScope {
  ownerUserId: string;
  exportId: string;
  operationId: string;
  policyVersion: string;
}
export type CandidateExportAdmissionQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;
const rejected = () => Error("CandidateExportAdmissionUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
/** Profile-owned bounded same-transaction export authorization, default off. No values,
 * KMS/artifact/provider I/O or permission to read another candidate's request. */
export function createBuildingCandidateExportAuthorizer(options: {
  policy: CandidateRightsPolicy;
  enabled?: () => boolean;
}) {
  const policyVersion = options.policy.version;
  const inventory = options.policy.ownerInventory.join(",");
  const accountableHash = options.policy.accountablePolicySha256;
  const enabled = options.enabled ?? (() => false);
  return async (
    original: CandidateExportAdmissionScope,
    query: CandidateExportAdmissionQuery,
  ): Promise<void> => {
    try {
      if (
        !enabled() ||
        // Restricted packet export needs Applications in the inventory, with or without Notifications.
        (inventory !== candidateRightsOwnerInventoryWithApplications.join(",") &&
          inventory !== candidateRightsOwnerInventoryWithNotifications.join(",")) ||
        !/^[a-f0-9]{64}$/u.test(accountableHash)
      )
        throw rejected();
      if (
        !original ||
        Object.getPrototypeOf(original) !== Object.prototype ||
        Reflect.ownKeys(original).length !== 4
      )
        throw rejected();
      const descriptors = Object.getOwnPropertyDescriptors(original);
      if (
        !["ownerUserId", "exportId", "operationId", "policyVersion"].every((key) => {
          const property = descriptors[key];
          return property?.enumerable && "value" in property && typeof property.value === "string";
        })
      )
        throw rejected();
      const scope = { ...original };
      if (
        ![scope.ownerUserId, scope.exportId, scope.operationId].every((id) => uuid.test(id)) ||
        scope.policyVersion !== policyVersion ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(policyVersion)
      )
        throw rejected();
      const rows = await query<Array<{ id: string }>>`
        SELECT request.id FROM profile.candidate_data_exports AS request
        WHERE request.id = ${scope.exportId}::uuid AND request.user_id = ${scope.ownerUserId}::uuid
          AND request.operation_id = ${scope.operationId}::uuid AND request.policy_version = ${scope.policyVersion}
          AND request.state = 'building' AND request.format = 'candidate-data-export-v1'
        FOR SHARE
      `;
      if (rows.length !== 1 || rows[0]?.id !== scope.exportId) throw rejected();
      const operation = await query<Array<{ id: string }>>`
        SELECT id FROM platform.operations WHERE id = ${scope.operationId}::uuid AND user_id = ${scope.ownerUserId}::uuid
          AND kind = 'candidate_data_export' AND state = 'running' FOR SHARE
      `;
      if (operation.length !== 1 || operation[0]?.id !== scope.operationId || !enabled())
        throw rejected();
    } catch {
      throw rejected();
    }
  };
}
