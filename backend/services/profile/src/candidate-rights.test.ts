import { describe, expect, it } from "vitest";
import {
  type AccountDeletionRecord,
  advanceAccountDeletion,
  assertCandidateRightsAuthentication,
  beginCandidateDataExport,
  type CandidateDataExportRecord,
  CandidateRightsAuthenticationError,
  CandidateRightsMfaError,
  CandidateRightsPolicyError,
  CandidateRightsTransitionError,
  cancelAccountDeletion,
  completeCandidateDataExport,
  confirmAccountDeletion,
  expireCandidateDataExport,
  failCandidateDataExport,
  loadCandidateRightsPolicy,
  loadCandidateRightsPolicyIfConfigured,
  markAccountDeletionBackupExpired,
} from "./candidate-rights.js";

const now = new Date("2026-08-25T15:00:00.000Z");
const policyEnvironment = {
  CANDIDATE_RIGHTS_POLICY_VERSION: "d1-synthetic-v1",
  CANDIDATE_RIGHTS_POLICY_SHA256: "a".repeat(64),
  CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS: "3600",
  CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS: "300",
  CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS: "7",
  CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS: "300",
  CANDIDATE_RIGHTS_OWNER_INVENTORY: "identity,profile,documents,jobs,matching,billing,trust",
  CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY: "auth0,aws",
};

function policy() {
  return loadCandidateRightsPolicy(policyEnvironment);
}

function queuedExport(): CandidateDataExportRecord {
  return {
    id: "019d04cf-1f80-7000-8000-000000000030",
    userId: "019d04cf-1f80-7000-8000-000000000031",
    operationId: "019d04cf-1f80-7000-8000-000000000032",
    policyVersion: "d1-synthetic-v1",
    state: "queued",
    requestedAt: now,
    updatedAt: now,
  };
}

function requestedDeletion(): AccountDeletionRecord {
  return {
    id: "019d04cf-1f80-7000-8000-000000000033",
    userId: "019d04cf-1f80-7000-8000-000000000031",
    policyVersion: "d1-synthetic-v1",
    state: "requested",
    version: 1,
    requestedAt: now,
    updatedAt: now,
  };
}

describe("candidate rights policy", () => {
  it("requires every activation input and the exact current owner inventory", () => {
    expect(loadCandidateRightsPolicyIfConfigured({})).toBeUndefined();
    expect(() =>
      loadCandidateRightsPolicyIfConfigured({ CANDIDATE_RIGHTS_POLICY_VERSION: "rights-v1" }),
    ).toThrow(CandidateRightsPolicyError);
    expect(policy()).toMatchObject({
      version: "d1-synthetic-v1",
      exportArtifactLifetimeSeconds: 3600,
      downloadGrantLifetimeSeconds: 300,
      backupRetentionDays: 7,
      recentAuthenticationMaxAgeSeconds: 300,
    });
    for (const key of Object.keys(policyEnvironment)) {
      expect(() => loadCandidateRightsPolicy({ ...policyEnvironment, [key]: undefined })).toThrow(
        CandidateRightsPolicyError,
      );
    }
    expect(() =>
      loadCandidateRightsPolicy({
        ...policyEnvironment,
        CANDIDATE_RIGHTS_OWNER_INVENTORY: "identity,profile,documents,jobs,matching,billing",
      }),
    ).toThrow(CandidateRightsPolicyError);
  });

  it("requires an explicit none marker when no subprocessors are in scope", () => {
    expect(
      loadCandidateRightsPolicy({
        ...policyEnvironment,
        CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY: "none",
      }).subprocessorInventory,
    ).toEqual([]);
    expect(() =>
      loadCandidateRightsPolicy({
        ...policyEnvironment,
        CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY: "none,auth0",
      }),
    ).toThrow(CandidateRightsPolicyError);
  });

  it("requires bounded fresh authentication and exact MFA for deletion", () => {
    const authenticatedAt = Math.floor(now.getTime() / 1000) - 60;
    expect(() =>
      assertCandidateRightsAuthentication(
        {
          issuer: "https://issuer.example.test/",
          subject: "candidate",
          audience: ["ai-job-apply-api"],
          scopes: ["profile:write"],
          authenticatedAt,
        },
        now,
        policy(),
        false,
      ),
    ).not.toThrow();
    expect(() =>
      assertCandidateRightsAuthentication(
        {
          issuer: "https://issuer.example.test/",
          subject: "candidate",
          audience: ["ai-job-apply-api"],
          scopes: ["profile:write"],
          authenticatedAt,
        },
        now,
        policy(),
        true,
      ),
    ).toThrow(CandidateRightsMfaError);
    expect(() =>
      assertCandidateRightsAuthentication(
        {
          issuer: "https://issuer.example.test/",
          subject: "candidate",
          audience: ["ai-job-apply-api"],
          scopes: ["profile:write"],
          authenticatedAt,
          authenticationMethods: ["pwd", "mfa"],
        },
        now,
        policy(),
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertCandidateRightsAuthentication(
        {
          issuer: "https://issuer.example.test/",
          subject: "candidate",
          audience: ["ai-job-apply-api"],
          scopes: ["profile:write"],
          authenticatedAt: Math.floor(now.getTime() / 1000) - 301,
        },
        now,
        policy(),
        false,
      ),
    ).toThrow(CandidateRightsAuthenticationError);
  });
});

describe("candidate data export transitions", () => {
  it("moves queued to building to ready and expires only after exact-object deletion", () => {
    const building = beginCandidateDataExport(queuedExport(), new Date(now.getTime() + 1_000));
    expect(beginCandidateDataExport(building, new Date(now.getTime() + 2_000))).toBe(building);
    const expiresAt = new Date(now.getTime() + 3_600_000);
    const ready = completeCandidateDataExport(
      building,
      {
        objectKey: `exports/${building.id}/candidate-data-export-v1.json`,
        objectVersion: "synthetic-version",
        sha256: "b".repeat(64),
        expiresAt,
      },
      new Date(now.getTime() + 2_000),
    );
    expect(ready.state).toBe("ready");
    expect(() => expireCandidateDataExport(ready, expiresAt, false)).toThrow(
      CandidateRightsTransitionError,
    );
    expect(expireCandidateDataExport(ready, expiresAt, true).state).toBe("expired");
    expect(() => beginCandidateDataExport(ready, expiresAt)).toThrow(
      CandidateRightsTransitionError,
    );
  });

  it("uses fixed value-free failure codes and never revives a failed export", () => {
    const failed = failCandidateDataExport(queuedExport(), "owner_unavailable", now);
    expect(failed).toMatchObject({ state: "failed", failureCode: "owner_unavailable" });
    expect(() => beginCandidateDataExport(failed, now)).toThrow(CandidateRightsTransitionError);
  });
});

describe("account deletion transitions", () => {
  it("allows cancellation only before confirmation", () => {
    expect(() => cancelAccountDeletion(requestedDeletion(), 1)).not.toThrow();
    expect(() => cancelAccountDeletion(requestedDeletion(), 2)).toThrow(
      CandidateRightsTransitionError,
    );
  });

  it("quarantines first and advances monotonically through confirmed backup expiry", () => {
    const quarantined = confirmAccountDeletion(
      requestedDeletion(),
      1,
      "019d04cf-1f80-7000-8000-000000000034",
      now,
      policy(),
    );
    expect(quarantined).toMatchObject({ state: "quarantined", version: 2, confirmedAt: now });
    expect(quarantined.backupExpiresAt?.toISOString()).toBe("2026-09-01T15:00:00.000Z");
    const activeDeleted = advanceAccountDeletion(quarantined, "active_systems_deleted", now);
    const providerPending = advanceAccountDeletion(activeDeleted, "subprocessors_pending", now);
    const completed = advanceAccountDeletion(providerPending, "completed", now);
    expect(completed).toMatchObject({ state: "completed", version: 5, completedAt: now });
    const backupBoundary = completed.backupExpiresAt;
    expect(backupBoundary).toBeInstanceOf(Date);
    if (!backupBoundary) throw new Error("Test deletion did not retain its backup boundary");
    expect(() => markAccountDeletionBackupExpired(completed, now, true)).toThrow(
      CandidateRightsTransitionError,
    );
    expect(() => markAccountDeletionBackupExpired(completed, backupBoundary, false)).toThrow(
      CandidateRightsTransitionError,
    );
    expect(markAccountDeletionBackupExpired(completed, backupBoundary, true)).toMatchObject({
      state: "backup_expired",
      version: 6,
    });
    expect(() => advanceAccountDeletion(completed, "active_systems_deleted", now)).toThrow(
      CandidateRightsTransitionError,
    );
  });
});
