import { describe, expect, it, vi } from "vitest";
import {
  type CandidateExportAdmissionQuery,
  createBuildingCandidateExportAuthorizer,
} from "./candidate-export-admission.js";
import {
  type CandidateRightsPolicy,
  candidateRightsOwnerInventoryWithApplications,
  candidateRightsOwnerInventoryWithNotifications,
} from "./candidate-rights.js";

const owner = "0192f7c2-0000-7000-8000-000000000001";
const request = "0192f7c2-0000-7000-8000-000000000002";
const operation = "0192f7c2-0000-7000-8000-000000000003";
const scope = {
  ownerUserId: owner,
  exportId: request,
  operationId: operation,
  policyVersion: "synthetic-v1",
};
const policy: CandidateRightsPolicy = {
  version: "synthetic-v1",
  accountablePolicySha256: "a".repeat(64),
  exportArtifactLifetimeSeconds: 3600,
  downloadGrantLifetimeSeconds: 300,
  backupRetentionDays: 35,
  recentAuthenticationMaxAgeSeconds: 300,
  ownerInventory: candidateRightsOwnerInventoryWithApplications,
  subprocessorInventory: [],
};
function query() {
  return vi.fn(async (parts: TemplateStringsArray) => [
    { id: parts.join("?").includes("candidate_data_exports") ? request : operation },
  ]);
}
describe("Profile building export admission", () => {
  it("admits the nine-owner inventory that still includes Applications", async () => {
    const sql = query();
    await createBuildingCandidateExportAuthorizer({
      policy: { ...policy, ownerInventory: candidateRightsOwnerInventoryWithNotifications },
      enabled: () => true,
    })(scope, sql as unknown as CandidateExportAdmissionQuery);
    expect(sql).toHaveBeenCalled();
  });
  it("refuses an inventory without Applications", async () => {
    const sql = query();
    await expect(
      createBuildingCandidateExportAuthorizer({
        policy: {
          ...policy,
          ownerInventory: candidateRightsOwnerInventoryWithApplications.slice(0, 7),
        },
        enabled: () => true,
      })(scope, sql as unknown as CandidateExportAdmissionQuery),
    ).rejects.toThrow("CandidateExportAdmissionUnavailable");
    expect(sql).not.toHaveBeenCalled();
  });
  it("defaults off before database access", async () => {
    const sql = query();
    await expect(
      createBuildingCandidateExportAuthorizer({ policy })(
        scope,
        sql as unknown as CandidateExportAdmissionQuery,
      ),
    ).rejects.toThrow("CandidateExportAdmissionUnavailable");
    expect(sql).not.toHaveBeenCalled();
  });
  it("checks exact request and operation through the supplied transaction only", async () => {
    const sql = query();
    await createBuildingCandidateExportAuthorizer({ policy, enabled: () => true })(
      scope,
      sql as unknown as CandidateExportAdmissionQuery,
    );
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.mock.calls[0]?.[0].join("?")).toContain("request.state = 'building'");
    expect(sql.mock.calls[1]?.[0].join("?")).toContain("state = 'running'");
  });
  it.each(["owner", "policy", "extra", "getter"])(
    "rejects invalid %s before querying",
    async (kind) => {
      const sql = query();
      const changed = { ...scope };
      const getter = vi.fn(() => owner);
      if (kind === "owner") changed.ownerUserId = "invalid";
      if (kind === "policy") changed.policyVersion = "another-v1";
      if (kind === "extra") Object.assign(changed, { rawBody: "synthetic" });
      if (kind === "getter")
        Object.defineProperty(changed, "ownerUserId", { enumerable: true, get: getter });
      await expect(
        createBuildingCandidateExportAuthorizer({ policy, enabled: () => true })(
          changed,
          sql as unknown as CandidateExportAdmissionQuery,
        ),
      ).rejects.toThrow("CandidateExportAdmissionUnavailable");
      expect(sql).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    },
  );
  it("refuses missing request rows and changed operations without exposing provider errors", async () => {
    for (const rows of [[], [{ id: owner }]]) {
      const sql = vi.fn(async () => rows);
      await expect(
        createBuildingCandidateExportAuthorizer({ policy, enabled: () => true })(
          scope,
          sql as unknown as CandidateExportAdmissionQuery,
        ),
      ).rejects.toThrow("CandidateExportAdmissionUnavailable");
    }
  });
});
