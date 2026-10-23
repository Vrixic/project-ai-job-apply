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

  it("activates exactly the seven-owner or the eight-owner Applications inventory", () => {
    expect(policy().ownerInventory).toEqual([
      "identity",
      "profile",
      "documents",
      "jobs",
      "matching",
      "billing",
      "trust",
    ]);
    expect(
      loadCandidateRightsPolicy({
        ...policyEnvironment,
        CANDIDATE_RIGHTS_OWNER_INVENTORY:
          "identity,profile,documents,jobs,matching,billing,trust,applications",
      }).ownerInventory,
    ).toEqual([
      "identity",
      "profile",
      "documents",
      "jobs",
      "matching",
      "billing",
      "trust",
      "applications",
    ]);
    expect(
      loadCandidateRightsPolicy({
        ...policyEnvironment,
        CANDIDATE_RIGHTS_OWNER_INVENTORY:
          "identity,profile,documents,jobs,matching,billing,trust,applications,notifications",
      }).ownerInventory,
    ).toEqual([
      "identity",
      "profile",
      "documents",
      "jobs",
      "matching",
      "billing",
      "trust",
      "applications",
      "notifications",
    ]);
    for (const inventory of [
      // Reordered, without Trust, duplicated, unknown, or with a trailing owner.
      "identity,profile,documents,jobs,matching,billing,applications,trust",
      "identity,profile,documents,jobs,matching,billing,applications",
      "identity,profile,documents,jobs,matching,billing,trust,applications,applications",
      "identity,profile,documents,jobs,matching,billing,trust,applications,outcomes",
      "applications",
      "identity,profile,documents,jobs,matching,billing,trust,notifications",
      "identity,profile,documents,jobs,matching,billing,trust,notifications,applications",
      "identity,profile,documents,jobs,matching,billing,trust,applications,notifications,notifications",
    ]) {
      expect(() =>
        loadCandidateRightsPolicy({
          ...policyEnvironment,
          CANDIDATE_RIGHTS_OWNER_INVENTORY: inventory,
        }),
      ).toThrow(CandidateRightsPolicyError);
    }
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

type TerminalRetryState = "queued" | "running" | "retryable_failure" | "succeeded" | "failed";
type TerminalRetryKind = "deletion" | "export";

function terminalRetryFixture(
  kind: TerminalRetryKind,
  initialState: TerminalRetryState | undefined,
  options: {
    pending?: boolean;
    attempts?: number;
    concurrentCompletion?: boolean;
    failInsert?: boolean;
    invalidEvent?: boolean;
    duplicateEvent?: boolean;
  } = {},
) {
  const operationId = "019d04cf-1f80-7000-8000-000000000092";
  const eventId = "019d04cf-1f80-7000-8000-000000000093";
  const resourceId = "019d04cf-1f80-7000-8000-000000000094";
  const event = {
    id: eventId,
    type:
      kind === "deletion"
        ? "profile.account-deletion.confirmed.v1"
        : "profile.data-export.requested.v1",
    source: "urn:ai-job-apply:profile-service",
    subject: (kind === "deletion" ? "account-deletion-request/" : "data-export/") + resourceId,
    dataSchema:
      "https://schemas.ai-job-apply.internal/events/profile." +
      (kind === "deletion" ? "account-deletion.confirmed" : "data-export.requested") +
      ".v1.json",
    data: {
      ...(kind === "deletion" ? { deletionRequestId: resourceId } : { dataExportId: resourceId }),
      operationId,
      policyVersion: "d1-synthetic-v1",
    },
    traceparent: null,
  };
  let committed = {
    state: initialState,
    attempts: options.attempts ?? 1,
    pending: options.pending ?? false,
    inserts: [] as unknown[][],
  };
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  // This seam models conditional-row results and transaction rollback. It is not evidence of
  // real PostgreSQL row locking; the maintained database integration remains a separate gate.
  const begin = vi.fn(async (run: (tx: unknown) => Promise<void>) => {
    const next = structuredClone(committed);
    const transaction = async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const statement = parts.join("?").replace(/\s+/gu, " ").trim();
      calls.push({ sql: statement, values });
      if (
        statement.startsWith("SELECT id, type, source, subject, data_schema") &&
        statement.includes("WHERE durable_execution_name =")
      ) {
        expect(values).toEqual(["outbox-" + eventId]);
        const selected = options.invalidEvent ? { ...event, data: {} } : event;
        return options.duplicateEvent ? [selected, selected] : [selected];
      }
      if (statement.startsWith("SELECT pg_advisory_xact_lock")) {
        expect(values).toEqual([operationId]);
        return [];
      }
      if (statement.startsWith("SELECT EXISTS")) {
        expect(values).toEqual([event.type, operationId, eventId]);
        return [{ present: next.pending }];
      }
      if (statement.startsWith("SELECT count(*)::int")) {
        expect(values).toEqual([event.type, operationId]);
        return [{ count: next.attempts }];
      }
      if (statement.startsWith("UPDATE platform.operations SET state = 'retryable_failure'")) {
        expect(values).toEqual(["WorkflowFailed", operationId]);
        expect(statement).toContain("state IN ('queued', 'running', 'retryable_failure')");
        if (options.concurrentCompletion) next.state = "succeeded";
        const changed = ["queued", "running", "retryable_failure"].includes(next.state ?? "");
        if (changed) next.state = "retryable_failure";
        return changed && statement.endsWith("RETURNING id") ? [{ id: operationId }] : [];
      }
      if (statement.startsWith("INSERT INTO platform.outbox_events")) {
        if (options.failInsert) throw new Error("SyntheticTerminalRetryInsertFailed");
        expect(values).toEqual([
          expect.stringMatching(/^[a-f0-9-]{36}$/u),
          event.type,
          event.source,
          event.subject,
          event.dataSchema,
          JSON.stringify(event.data),
          event.traceparent,
        ]);
        next.inserts.push(values);
        next.attempts += 1;
        next.pending = true;
        return [];
      }
      if (statement.startsWith("UPDATE profile.candidate_data_exports SET state = 'failed'")) {
        expect(kind).toBe("export");
        expect(values).toEqual([resourceId, operationId]);
        return [];
      }
      if (statement.startsWith("UPDATE platform.operations SET state = 'failed'")) {
        expect(kind).toBe("export");
        expect(values).toEqual(["WorkflowFailed", operationId]);
        if (["queued", "running", "retryable_failure"].includes(next.state ?? "")) {
          next.state = "failed";
        }
        return [];
      }
      throw new Error("SyntheticTerminalRetryUnexpectedQuery");
    };
    await run(transaction);
    committed = next;
  });
  const store = new PostgresProfileStore({ client: { begin } } as unknown as DatabaseHandle);
  return {
    invoke: () => store.reconcileDurableOperationFailure("outbox-" + eventId, "WorkflowFailed"),
    state: () => structuredClone(committed),
    calls,
    begin,
  };
}

describe.each(["deletion", "export"] as const)("%s terminal retry transition", (kind) => {
  it.each(["succeeded", "failed", undefined] as const)(
    "does not enqueue after a zero-row transition for %s",
    async (state) => {
      const fixture = terminalRetryFixture(kind, state);
      const before = fixture.state();
      await fixture.invoke();
      expect(fixture.state()).toEqual(before);
      expect(fixture.calls.some(({ sql: statement }) => statement.startsWith("INSERT"))).toBe(
        false,
      );
    },
  );

  it.each(["queued", "running", "retryable_failure"] as const)(
    "keeps one bounded retry for a %s operation",
    async (state) => {
      const fixture = terminalRetryFixture(kind, state);
      await fixture.invoke();
      expect(fixture.state()).toMatchObject({
        state: "retryable_failure",
        attempts: 2,
        pending: true,
      });
      expect(fixture.state().inserts).toHaveLength(1);
    },
  );

  it("does not enqueue when completion wins the conditional transition", async () => {
    const fixture = terminalRetryFixture(kind, "running", { concurrentCompletion: true });
    await fixture.invoke();
    expect(fixture.state()).toEqual({
      state: "succeeded",
      attempts: 1,
      pending: false,
      inserts: [],
    });
  });

  it("keeps the pending-event guard before any operation update", async () => {
    const fixture = terminalRetryFixture(kind, "running", { pending: true });
    const before = fixture.state();
    await fixture.invoke();
    expect(fixture.state()).toEqual(before);
    expect(fixture.calls.some(({ sql: statement }) => statement.startsWith("UPDATE"))).toBe(false);
  });

  it("does not duplicate the retry while its new event is unpublished", async () => {
    const fixture = terminalRetryFixture(kind, "running");
    await fixture.invoke();
    const afterFirst = fixture.state();
    await fixture.invoke();
    expect(fixture.state()).toEqual(afterFirst);
    expect(fixture.begin).toHaveBeenCalledTimes(2);
  });

  it("preserves the existing three-attempt exhaustion without new events", async () => {
    const fixture = terminalRetryFixture(kind, "running", { attempts: 3 });
    await fixture.invoke();
    expect(fixture.state()).toEqual({
      state: kind === "export" ? "failed" : "retryable_failure",
      attempts: 3,
      pending: false,
      inserts: [],
    });
  });

  it("rolls back the operation transition when the new event insert fails", async () => {
    const fixture = terminalRetryFixture(kind, "running", { failInsert: true });
    const before = fixture.state();
    await expect(fixture.invoke()).rejects.toThrow("SyntheticTerminalRetryInsertFailed");
    expect(fixture.state()).toEqual(before);
  });

  it("keeps malformed input rejected before updates", async () => {
    const fixture = terminalRetryFixture(kind, "running", { invalidEvent: true });
    await expect(fixture.invoke()).rejects.toThrow("DurableTerminalInputRejected");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.state().inserts).toEqual([]);
  });

  it("keeps ambiguous event identity rejected before updates", async () => {
    const fixture = terminalRetryFixture(kind, "running", { duplicateEvent: true });
    await expect(fixture.invoke()).rejects.toThrow("DurableTerminalInputNotFound");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.state().inserts).toEqual([]);
  });
});
