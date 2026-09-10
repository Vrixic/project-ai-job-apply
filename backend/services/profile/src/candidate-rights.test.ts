import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
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
import {
  type CandidateDeletionConfirmationJournalEntry,
  type DatabaseHandle,
  PostgresProfileStore,
} from "./index.js";
import {
  accountDeletionRequests,
  auditEvents,
  idempotencyKeys,
  operations,
  outboxEvents,
  users,
} from "./schema.js";

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

function confirmationRetryFixture() {
  type Row = Record<string, unknown>;
  const request = requestedDeletion();
  const firstAt = new Date(now.getTime() + 1_000);
  const retryAt = new Date(now.getTime() + 31_000);
  const clock = vi.fn(() => firstAt);
  let committed = {
    request: {
      ...request,
      operationId: null,
      confirmedAt: null,
      completedAt: null,
      backupExpiresAt: null,
      backupExpiredAt: null,
    } as Row,
    quarantine: undefined as Row | undefined,
    ledger: undefined as Row | undefined,
    receipt: undefined as Row | undefined,
    inserts: [] as Array<{ kind: string; value: Row }>,
  };
  let rejectCommit = true;
  const dialect = new PgDialect();
  // This in-memory transaction seam tests binding/rollback decisions only. Real PostgreSQL
  // transaction and migration evidence remains a separate integration gate.
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    const next = structuredClone(committed);
    const tx = {
      execute: async (statement: SQL) => {
        const query = dialect.sqlToQuery(statement);
        if (query.sql.includes("INSERT INTO privacy.account_deletion_ledger")) {
          const [
            requestId,
            subjectDigest,
            policyVersion,
            policySha256,
            owners,
            subprocessors,
            confirmedAt,
            backupExpiresAt,
            updatedAt,
          ] = query.params;
          next.ledger = {
            requestId,
            subjectDigest,
            policyVersion,
            policySha256,
            owners,
            subprocessors,
            confirmedAt,
            backupExpiresAt,
            updatedAt,
          };
        }
        return [];
      },
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === idempotencyKeys) return next.receipt ? [next.receipt] : [];
              if (table === accountDeletionRequests) return [next.request];
              throw new Error("SyntheticUnexpectedRead");
            },
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: async (value: Row) => {
          const kind =
            table === operations
              ? "operation"
              : table === outboxEvents
                ? "outbox"
                : table === auditEvents
                  ? "audit"
                  : table === idempotencyKeys
                    ? "receipt"
                    : "unexpected";
          if (kind === "unexpected") throw new Error("SyntheticUnexpectedInsert");
          next.inserts.push({ kind, value });
          if (table === idempotencyKeys) next.receipt = value;
        },
      }),
      update: (table: unknown) => ({
        set: (value: Row) => ({
          where: () => {
            if (table === accountDeletionRequests) {
              next.request = { ...next.request, ...value };
              return { returning: async () => [next.request] };
            }
            if (table === users) {
              next.quarantine = value;
              return {};
            }
            throw new Error("SyntheticUnexpectedUpdate");
          },
        }),
      }),
    };
    const result = await run(tx);
    if (rejectCommit) {
      rejectCommit = false;
      throw new Error("SyntheticCommitFailure");
    }
    committed = next;
    return result;
  });
  let journaled: CandidateDeletionConfirmationJournalEntry | undefined;
  const recordConfirmed = vi.fn(async (entry: CandidateDeletionConfirmationJournalEntry) => {
    journaled ??= structuredClone(entry);
    return structuredClone(journaled);
  });
  const store = new PostgresProfileStore({ db: { transaction } } as unknown as DatabaseHandle, {
    candidateRightsPolicy: policy(),
    candidateDeletionConfirmationJournal: { recordConfirmed },
    clock,
  });
  const principal = {
    issuer: "https://retry-fixture.example.test/",
    subject: "generated-confirmation-retry",
    audience: ["ai-job-apply-api"],
    scopes: ["profile:write"],
    authenticatedAt: Math.floor(firstAt.getTime() / 1_000),
    authenticationMethods: ["pwd", "mfa"],
  };
  const confirm = () =>
    store.confirmAccountDeletionRequest(
      principal,
      request.userId,
      request.id,
      request.version,
      "synthetic-retry-key",
      "synthetic-trace",
    );
  return {
    confirm,
    recordConfirmed,
    transaction,
    clock,
    firstAt,
    retryAt,
    state: () => committed,
    journal: () => journaled,
  };
}

describe("account deletion confirmation journal replay", () => {
  it.each(["request", "quarantine", "ledger"] as const)(
    "retains the journaled %s confirmation time after a SQL rollback",
    async (boundary) => {
      const fixture = confirmationRetryFixture();
      await expect(fixture.confirm()).rejects.toThrow("SyntheticCommitFailure");
      expect(fixture.journal()?.confirmedAt).toEqual(fixture.firstAt);
      expect(fixture.state().request.state).toBe("requested");
      expect(fixture.state().inserts).toEqual([]);
      fixture.clock.mockReturnValue(fixture.retryAt);
      const result = await fixture.confirm();
      expect(result?.confirmedAt).toBe(fixture.firstAt.toISOString());
      const state = fixture.state();
      const confirmation =
        boundary === "request"
          ? state.request.confirmedAt
          : boundary === "quarantine"
            ? state.quarantine?.quarantinedAt
            : state.ledger?.confirmedAt;
      expect(confirmation).toEqual(
        boundary === "ledger" ? fixture.firstAt.toISOString() : fixture.firstAt,
      );
      expect(state.request.updatedAt).toEqual(fixture.retryAt);
      expect(state.ledger?.updatedAt).toBe(fixture.retryAt.toISOString());
      expect(state.request.operationId).toBe(fixture.journal()?.operationId);
      expect(state.request.backupExpiresAt).toEqual(fixture.journal()?.backupExpiresAt);
      expect(state.ledger?.backupExpiresAt).toBe(fixture.journal()?.backupExpiresAt.toISOString());
      expect(state.quarantine?.accountState).toBe("quarantined");
      expect(state.inserts.map(({ kind }) => kind)).toEqual([
        "operation",
        "outbox",
        "receipt",
        "audit",
      ]);
      expect(state.inserts.find(({ kind }) => kind === "operation")?.value.createdAt).toEqual(
        fixture.retryAt,
      );
      expect(state.inserts.find(({ kind }) => kind === "audit")?.value.occurredAt).toEqual(
        fixture.retryAt,
      );
    },
  );

  it("returns the committed confirmation receipt without journaling or publishing again", async () => {
    const fixture = confirmationRetryFixture();
    await expect(fixture.confirm()).rejects.toThrow("SyntheticCommitFailure");
    fixture.clock.mockReturnValue(fixture.retryAt);
    const result = await fixture.confirm();
    const before = structuredClone(fixture.state());
    expect(await fixture.confirm()).toEqual(result);
    expect(fixture.recordConfirmed).toHaveBeenCalledTimes(2);
    expect(fixture.state()).toEqual(before);
  });

  it.each(["userId", "requestId", "policySha256", "subjectDigest"] as const)(
    "refuses a replayed journal with changed %s before committing owner state",
    async (field) => {
      const fixture = confirmationRetryFixture();
      await expect(fixture.confirm()).rejects.toThrow("SyntheticCommitFailure");
      const journaled = fixture.journal();
      if (!journaled) throw new Error("SyntheticJournalMissing");
      fixture.recordConfirmed.mockResolvedValueOnce({ ...journaled, [field]: "wrong-binding" });
      fixture.clock.mockReturnValue(fixture.retryAt);
      await expect(fixture.confirm()).rejects.toThrow(CandidateRightsTransitionError);
      expect(fixture.state().request.state).toBe("requested");
      expect(fixture.state().inserts).toEqual([]);
    },
  );
});

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
