import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import { createJobCatalogDatabase } from "@ai-job-apply/jobs-service";
import {
  type CandidateDeletionConfirmationJournalEntry,
  createDatabase,
  type DatabaseHandle,
  PostgresProfileStore,
} from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  diagnoseHistoricalCompletion,
  historicalCompletionEvidenceSha256,
  readHistoricalCompletionRepairCandidate,
} from "./candidate-deletion-completion-diagnosis.js";
import {
  collectHistoricalCompletionEvidence,
  type HistoricalCompletionEvidenceTarget,
} from "./candidate-deletion-completion-evidence.js";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
} from "./candidate-deletion-restore-policy.js";
import { PostgresCandidateDeletionRestoreStore } from "./candidate-deletion-restore-store.js";
import { PostgresCandidateRightsActivityStore } from "./candidate-rights-activities.js";
import type { CandidateRightsActivityInputV1 } from "./candidate-rights-durable.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

const requested = process.env.CANDIDATE_DELETION_RESTORE_INTEGRATION === "1";
const databaseUrl = process.env.CANDIDATE_DELETION_RESTORE_TEST_DATABASE_URL;
if (requested) {
  let parsed: URL | undefined;
  try {
    parsed = new URL(databaseUrl ?? "");
  } catch {
    /* Refused below, without leaking a URL. */
  }
  if (
    !parsed ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !/^\/d2_restore_replay_[a-z0-9_]{1,40}$/u.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("CandidateDeletionRestoreIntegrationTargetRejected");
  }
}

const execute = promisify(execFile);
const migrationEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
  ),
);
const issuer = "https://generated-restore-replay.invalid/";

describe.skipIf(!requested)("isolated restored PostgreSQL seven-owner deletion replay", () => {
  let database: DatabaseHandle;
  let raw: ReturnType<typeof createJobCatalogDatabase>;
  let store: PostgresCandidateDeletionRestoreStore;
  let seedD2: (client: unknown, profile: unknown) => Promise<{ ownerUserId: string }>;

  beforeAll(async () => {
    // Root/operator creates the exact isolated local database. This test neither starts
    // Docker nor creates/drops databases, and never inherits cloud/provider credentials.
    for (const owner of ["profile", "documents", "jobs", "matching", "billing", "trust"]) {
      await execute(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        {
          env: { ...migrationEnvironment, NODE_ENV: "test", DATABASE_URL: databaseUrl },
        },
      );
    }
    database = createDatabase(databaseUrl as string, { maxConnections: 1 });
    raw = createJobCatalogDatabase(databaseUrl as string, { maxConnections: 2 });
    store = new PostgresCandidateDeletionRestoreStore(database);
    const fixtures = await import(
      new URL("../../../scripts/tests/d2-recovery/fixtures.mjs", import.meta.url).href
    );
    seedD2 = fixtures.seedD2RecoveryFixtures;
  }, 90_000);

  afterAll(async () => {
    await raw?.end();
    await database?.client.end();
  });

  async function seed(policyIndex: number) {
    const seeded = await seedD2(raw, database.client);
    const userId = seeded.ownerUserId;
    const subject = `generated-${userId}`;
    await database.client`INSERT INTO identity.external_identities (issuer, subject, user_id) VALUES (${issuer}, ${subject}, ${userId})`;
    const documentId = uuidv7();
    await database.client`
      INSERT INTO documents.resume_documents (id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status)
      VALUES (${documentId}, ${userId}, 'synthetic-restore.pdf', 'application/pdf', 1, ${"1".repeat(64)}, ${`quarantine/${documentId}/source`}, 'awaiting_upload')
    `;
    await database.client`
      INSERT INTO billing.entitlement_accounts (id, user_id, version, plan, effective_at, updated_at)
      VALUES (${uuidv7()}, ${userId}, 1, 'free', now(), now())
    `;
    const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[policyIndex];
    if (!policy) throw new Error("Synthetic historical policy missing");
    const confirmedAt = new Date();
    const entry: CandidateDeletionRecoveryEntry = {
      userId,
      requestId: uuidv7(),
      operationId: uuidv7(),
      policyVersion: policy.version,
      policySha256: policy.sha256,
      subjectDigest: createHash("sha256")
        .update(`ai-job-apply/account-deletion-subject/v1\0${issuer}\0${subject}`)
        .digest("hex"),
      confirmedAt,
      backupExpiresAt: new Date(confirmedAt.getTime() + 35 * 86_400_000),
      completedAt: new Date(confirmedAt.getTime()),
    };
    return { entry, documentId };
  }

  async function counts(userId: string) {
    const [row] = await database.client<
      {
        identity: number;
        profile: number;
        documents: number;
        jobs: number;
        matching: number;
        billing: number;
        trust: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM identity.external_identities WHERE user_id = ${userId}) AS identity,
        (SELECT count(*)::int FROM profile.ugc_contribution_consents WHERE owner_user_id = ${userId}) AS profile,
        (SELECT count(*)::int FROM documents.resume_documents WHERE user_id = ${userId}) AS documents,
        (SELECT count(*)::int FROM jobs.job_contributions WHERE owner_user_id = ${userId}) AS jobs,
        (SELECT count(*)::int FROM matching.private_saved_page_captures WHERE owner_user_id = ${userId}) AS matching,
        (SELECT count(*)::int FROM billing.entitlement_accounts WHERE user_id = ${userId}) AS billing,
        (SELECT count(*)::int FROM trust.contribution_cases WHERE contributor_user_id = ${userId}) AS trust
    `;
    if (!row) throw new Error("Synthetic owner inventory missing");
    return row;
  }

  async function finishAndRemove(entry: CandidateDeletionRecoveryEntry) {
    // Exact generated fixture cleanup uses the same authorized seven-owner ports,
    // never broad table deletion or a production identity call.
    const preflight = await store.preflight([entry]);
    await store.reconcile([entry], preflight);
    await database.client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${entry.requestId}`;
    await database.client`DELETE FROM identity.users WHERE id = ${entry.userId}`;
  }

  it("persists journaled confirmation and completion times across real SQL rollback and marker retries", async () => {
    const userId = uuidv7();
    const subject = `generated-retry-${userId}`;
    const requestedAt = new Date(Date.now() - 60_000);
    const confirmedAt = new Date(requestedAt.getTime() + 1_000);
    const retryAt = new Date(requestedAt.getTime() + 2_000);
    const completedAt = new Date(requestedAt.getTime() + 3_000);
    const accepted = ACCEPTED_CANDIDATE_DELETION_POLICIES[1];
    if (!accepted) throw new Error("SyntheticPolicyMissing");
    const policy: CandidateRightsPolicy = {
      version: accepted.version,
      accountablePolicySha256: accepted.sha256,
      exportArtifactLifetimeSeconds: 3_600,
      downloadGrantLifetimeSeconds: 300,
      backupRetentionDays: accepted.backupRetentionDays,
      recentAuthenticationMaxAgeSeconds: 300,
      ownerInventory: RESTORED_CANDIDATE_RIGHTS_OWNERS,
      subprocessorInventory: [],
    };
    let at = requestedAt;
    let journaled: CandidateDeletionConfirmationJournalEntry | undefined;
    let journalCalls = 0;
    const journal = {
      recordConfirmed: async (entry: CandidateDeletionConfirmationJournalEntry) => {
        journalCalls += 1;
        journaled ??= structuredClone(entry);
        return structuredClone(journaled);
      },
    };
    let rollback = true;
    const rollbackDatabase: DatabaseHandle = {
      client: database.client,
      db: new Proxy(database.db, {
        get(target, property, receiver) {
          if (property !== "transaction") return Reflect.get(target, property, receiver);
          return (run: Parameters<DatabaseHandle["db"]["transaction"]>[0]) =>
            target.transaction(async (transaction) => {
              const result = await run(transaction);
              if (rollback) {
                rollback = false;
                // Throw after all real SQL ran: PostgreSQL must roll back the request,
                // quarantine, ledger, operation, receipt, audit and outbox together.
                throw new Error("SyntheticConfirmationCommitFailure");
              }
              return result;
            });
        },
      }),
    };
    const options = {
      candidateRightsPolicy: policy,
      candidateDeletionConfirmationJournal: journal,
      clock: () => at,
    };
    const profile = new PostgresProfileStore(database, options);
    const retryingProfile = new PostgresProfileStore(rollbackDatabase, options);
    const principal = {
      issuer,
      subject,
      audience: ["synthetic-deletion-retry"],
      scopes: ["profile:write"],
      authenticatedAt: Math.floor(requestedAt.getTime() / 1_000),
      authenticationMethods: ["pwd", "mfa"],
    };
    let requestId: string | undefined;
    const iso = (value: unknown) =>
      value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
    try {
      await database.client`INSERT INTO identity.users (id, created_at) VALUES (${userId}, ${requestedAt.toISOString()}::timestamptz)`;
      await database.client`INSERT INTO identity.external_identities (issuer, subject, user_id) VALUES (${issuer}, ${subject}, ${userId})`;
      const request = await profile.createAccountDeletionRequest(
        principal,
        userId,
        "synthetic-retry-request",
        "synthetic-retry-trace",
      );
      requestId = request.id;
      at = confirmedAt;
      const confirm = () =>
        retryingProfile.confirmAccountDeletionRequest(
          principal,
          userId,
          request.id,
          request.version,
          "synthetic-retry-confirm",
          "synthetic-retry-trace",
        );
      await expect(confirm()).rejects.toThrow("SyntheticConfirmationCommitFailure");
      const [rolledBack] = await database.client<Record<string, unknown>[]>`
        SELECT request.state, candidate.account_state,
          (SELECT count(*)::int FROM privacy.account_deletion_ledger WHERE request_id = ${request.id}) AS ledger_count,
          (SELECT count(*)::int FROM platform.operations WHERE user_id = ${userId}) AS operation_count,
          (SELECT count(*)::int FROM platform.outbox_events WHERE data ->> 'deletionRequestId' = ${request.id}) AS event_count
        FROM profile.account_deletion_requests request JOIN identity.users candidate ON candidate.id = request.user_id
        WHERE request.id = ${request.id}
      `;
      expect(rolledBack).toMatchObject({
        state: "requested",
        accountState: "active",
        ledgerCount: 0,
        operationCount: 0,
        eventCount: 0,
      });
      at = retryAt;
      const confirmed = await confirm();
      expect(await confirm()).toEqual(confirmed);
      expect(journalCalls).toBe(2);
      if (!journaled) throw new Error("SyntheticJournalMissing");
      const [persisted] = await database.client<Record<string, unknown>[]>`
        SELECT request.confirmed_at AS request_confirmed_at, ledger.confirmed_at AS ledger_confirmed_at,
          candidate.quarantined_at, request.updated_at AS request_updated_at,
          ledger.updated_at AS ledger_updated_at
        FROM profile.account_deletion_requests request
        JOIN privacy.account_deletion_ledger ledger ON ledger.request_id = request.id
        JOIN identity.users candidate ON candidate.id = request.user_id
        WHERE request.id = ${request.id}
      `;
      expect(iso(persisted?.requestConfirmedAt)).toBe(confirmedAt.toISOString());
      expect(iso(persisted?.ledgerConfirmedAt)).toBe(confirmedAt.toISOString());
      expect(iso(persisted?.quarantinedAt)).toBe(confirmedAt.toISOString());
      expect(iso(persisted?.requestUpdatedAt)).toBe(retryAt.toISOString());
      expect(iso(persisted?.ledgerUpdatedAt)).toBe(retryAt.toISOString());
      at = completedAt;
      const tags: Date[] = [];
      const activities = new PostgresCandidateRightsActivityStore({
        database,
        policy,
        clock: () => at,
        artifactStore: {
          putIfAbsent: async () => {
            throw new Error("SyntheticUnexpectedExport");
          },
        },
        documentObjectStore: {
          deleteAllVersionsAndMarkers: async (objects) => {
            expect(objects).toEqual([]);
            return { exactInventoryEmpty: true };
          },
        },
        identityProvider: {
          revokeAndDelete: async (identities) => {
            expect(identities).toEqual([{ issuer, subject }]);
          },
        },
        subprocessors: [],
        recoveryLedger: {
          recordConfirmed: async (entry) => entry,
          markCompleted: async (id, persistedCompletion) => {
            expect(id).toBe(request.id);
            tags.push(new Date(persistedCompletion));
            if (tags.length === 1) throw new Error("SyntheticMarkerTagFailure");
          },
        },
      });
      const input: CandidateRightsActivityInputV1 = {
        schemaVersion: 1,
        workflowDefinitionVersion: 1,
        action: "deletion_delete_active_systems",
        eventId: uuidv7(),
        resourceId: request.id,
        operationId: journaled.operationId,
        policyVersion: policy.version,
      };
      await activities.deleteActiveSystems(input);
      await activities.reconcileSubprocessors({
        ...input,
        action: "deletion_reconcile_subprocessors",
      });
      const completion = { ...input, action: "deletion_complete" as const };
      await expect(activities.completeDeletion(completion)).rejects.toThrow(
        "SyntheticMarkerTagFailure",
      );
      const [beforeRetry] = await database.client<Record<string, unknown>[]>`
        SELECT request.state, request.completed_at, request.version, ledger.completed_at AS ledger_completed_at
        FROM profile.account_deletion_requests request JOIN privacy.account_deletion_ledger ledger ON ledger.request_id = request.id
        WHERE request.id = ${request.id}
      `;
      at = new Date(completedAt.getTime() + 1_000);
      await activities.completeDeletion(completion);
      const [afterRetry] = await database.client<Record<string, unknown>[]>`
        SELECT request.state, request.completed_at, request.version, ledger.completed_at AS ledger_completed_at
        FROM profile.account_deletion_requests request JOIN privacy.account_deletion_ledger ledger ON ledger.request_id = request.id
        WHERE request.id = ${request.id}
      `;
      expect(beforeRetry).toEqual(afterRetry);
      expect(beforeRetry?.state).toBe("completed");
      expect(iso(beforeRetry?.completedAt)).toBe(completedAt.toISOString());
      expect(iso(beforeRetry?.ledgerCompletedAt)).toBe(completedAt.toISOString());
      expect(tags).toEqual([completedAt, completedAt]);
      const entry = { ...journaled, completedAt };
      const preflight = await store.preflight([entry]);
      expect(await store.reconcile([entry], preflight)).toEqual({
        restoredUsersReconciled: 0,
        restoredUsersAbsent: 0,
        restoredUsersAlreadyReconciled: 1,
      });
    } finally {
      // Only these generated rows are removed; no database or external object is deleted.
      if (requestId) {
        await database.client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
        await database.client`DELETE FROM platform.outbox_events WHERE data ->> 'deletionRequestId' = ${requestId}`;
      }
      await database.client`DELETE FROM platform.audit_events WHERE user_id = ${userId}`;
      await database.client`DELETE FROM identity.users WHERE id = ${userId}`;
    }
  }, 60_000);

  it("assembles a schema-valid owner-isolated export from all current nonempty PostgreSQL D2 owners", async () => {
    const first = await seed(1);
    const second = await seed(1);
    const written: Uint8Array[] = [];
    try {
      expect(Object.values(await counts(first.entry.userId)).every((count) => count > 0)).toBe(
        true,
      );
      const otherBefore = await counts(second.entry.userId);
      const generatedAt = new Date();
      const policy: CandidateRightsPolicy = {
        version: "synthetic-d2-composed-export-v1",
        accountablePolicySha256: "a".repeat(64),
        exportArtifactLifetimeSeconds: 3_600,
        downloadGrantLifetimeSeconds: 300,
        backupRetentionDays: 35,
        recentAuthenticationMaxAgeSeconds: 300,
        ownerInventory: RESTORED_CANDIDATE_RIGHTS_OWNERS,
        subprocessorInventory: [],
      };
      const profile = new PostgresProfileStore(database, {
        candidateRightsPolicy: policy,
        clock: () => generatedAt,
      });
      const principal = {
        issuer,
        subject: `generated-${first.entry.userId}`,
        audience: ["synthetic-export"],
        scopes: ["profile:export"],
        authenticatedAt: Math.floor(generatedAt.getTime() / 1_000),
      };
      const requestedExport = await profile.createCandidateDataExport(
        principal,
        first.entry.userId,
        "synthetic-composed-export",
        "synthetic-composed-export",
      );
      expect(
        await profile.createCandidateDataExport(
          principal,
          first.entry.userId,
          "synthetic-composed-export",
          "synthetic-composed-export",
        ),
      ).toEqual(requestedExport);
      const requestedRecord = await profile.getCandidateDataExport(
        first.entry.userId,
        requestedExport.id,
      );
      if (!requestedRecord) throw new Error("Synthetic export request missing");
      expect(await profile.getCandidateDataExport(second.entry.userId, requestedExport.id)).toBe(
        null,
      );
      const unexpectedExternalCall = async (): Promise<never> => {
        throw new Error("The generated export must not call an external deletion adapter");
      };
      const activities = new PostgresCandidateRightsActivityStore({
        database,
        policy,
        clock: () => generatedAt,
        // The real activity composes all six SQL exports and runs the shared validator before
        // this in-memory sink. Nothing is uploaded, persisted on the host, or logged.
        artifactStore: {
          putIfAbsent: async ({ body, sha256, expiresAt }) => {
            expect(createHash("sha256").update(body).digest("hex")).toBe(sha256);
            expect(expiresAt.getTime()).toBe(generatedAt.getTime() + 3_600_000);
            written.push(Uint8Array.from(body));
            return { objectVersion: "synthetic-composed-export-version" };
          },
        },
        documentObjectStore: { deleteAllVersionsAndMarkers: unexpectedExternalCall },
        identityProvider: { revokeAndDelete: unexpectedExternalCall },
        subprocessors: [],
        recoveryLedger: {
          recordConfirmed: unexpectedExternalCall,
          markCompleted: unexpectedExternalCall,
        },
      });
      const input: CandidateRightsActivityInputV1 = {
        schemaVersion: 1,
        workflowDefinitionVersion: 1,
        action: "export_begin",
        eventId: uuidv7(),
        resourceId: requestedRecord.id,
        operationId: requestedRecord.operationId,
        policyVersion: policy.version,
      };
      await activities.beginExport(input);
      await activities.assembleExport({ ...input, action: "export_assemble" });
      await activities.assembleExport({ ...input, action: "export_assemble" });
      expect(written).toHaveLength(1);
      const serialized = Buffer.from(written[0] ?? []).toString("utf8");
      const envelope = JSON.parse(serialized) as Record<string, unknown>;
      expect(validateCandidateDataExportV1(envelope)).toBe(true);
      const exported = envelope as unknown as {
        candidate: { connectedAccounts: unknown[] };
        profile: { contributionConsents: Record<string, unknown>[] };
        documents: { resumes: Record<string, unknown>[] };
        jobs: { contributions: Record<string, unknown>[] };
        matching: { privateSavedPageCaptures: Record<string, unknown>[] };
        billing: { entitlement: Record<string, unknown> };
        trust: { cases: Record<string, unknown>[]; caseEvents: Record<string, unknown>[] };
      };
      expect(exported.candidate.connectedAccounts).toHaveLength(1);
      expect(exported.profile.contributionConsents.length).toBeGreaterThan(0);
      expect(
        exported.profile.contributionConsents.some((consent) => consent.state === "revoked"),
      ).toBe(true);
      expect(exported.documents.resumes).toEqual([
        expect.objectContaining({ id: first.documentId, status: "awaiting_upload" }),
      ]);
      expect(exported.jobs.contributions).toHaveLength(5);
      expect(
        exported.jobs.contributions.every((contribution) =>
          Array.isArray(contribution.processingHistory),
        ),
      ).toBe(true);
      expect(
        exported.jobs.contributions.some(
          (contribution) =>
            Array.isArray(contribution.trustHistory) && contribution.trustHistory.length > 0,
        ),
      ).toBe(true);
      expect(exported.matching.privateSavedPageCaptures).toEqual([
        expect.objectContaining({ externalJobId: null, resolution: null }),
      ]);
      expect(exported.billing.entitlement).toMatchObject({ plan: "free", version: 1 });
      expect(exported.trust.cases).toHaveLength(4);
      expect(exported.trust.caseEvents.length).toBeGreaterThan(4);
      expect(
        exported.trust.cases.every(
          (trustCase) => typeof trustCase.independentEvidenceDigestSha256 === "string",
        ),
      ).toBe(true);
      const privateActors = await raw<{ actorId: string }[]>`
        SELECT DISTINCT actor_id FROM trust.case_events AS event
        JOIN trust.contribution_cases AS trust_case ON trust_case.id = event.case_id
        WHERE trust_case.contributor_user_id = ${first.entry.userId}
      `;
      const otherContributions = await raw<{ id: string }[]>`
        SELECT id FROM jobs.job_contributions WHERE owner_user_id = ${second.entry.userId}
      `;
      for (const value of [
        first.entry.userId,
        second.entry.userId,
        principal.subject,
        `quarantine/${first.documentId}/source`,
        ...privateActors.map((actor) => actor.actorId),
        ...otherContributions.map((contribution) => contribution.id),
      ]) {
        expect(serialized).not.toContain(value);
      }
      expect(
        await profile.getCandidateDataExport(first.entry.userId, requestedExport.id),
      ).toMatchObject({
        state: "ready",
        artifact: { objectVersion: "synthetic-composed-export-version" },
      });
      expect(await counts(second.entry.userId)).toEqual(otherBefore);
    } finally {
      for (const body of written) body.fill(0);
      await finishAndRemove(first.entry);
      await finishAndRemove(second.entry);
    }
  }, 60_000);

  it.each([0, 1])(
    "replays retained policy %i across all seven nonempty owners, preserves another owner and is idempotent",
    async (policyIndex) => {
      const first = await seed(policyIndex);
      const second = await seed(1);
      try {
        expect(Object.values(await counts(first.entry.userId)).every((count) => count > 0)).toBe(
          true,
        );
        const otherBefore = await counts(second.entry.userId);
        expect(Object.values(otherBefore).every((count) => count > 0)).toBe(true);
        // A snapshot taken before confirmation legitimately contains this requested
        // row, but not the later operation, quarantine or confirmation ledger.
        const requestedAt = first.entry.confirmedAt.toISOString();
        await database.client`
        INSERT INTO profile.account_deletion_requests (id, user_id, policy_version, state, version, requested_at, updated_at)
        VALUES (${first.entry.requestId}, ${first.entry.userId}, ${first.entry.policyVersion}, 'requested', 1, ${requestedAt}::timestamptz, ${requestedAt}::timestamptz)
      `;
        const preflight = await store.preflight([first.entry]);
        expect(preflight).toMatchObject({ restoredSubjectsPresent: 1, restoredSubjectsAbsent: 0 });
        expect(preflight.documentObjects).toEqual([
          {
            userId: first.entry.userId,
            documentId: first.documentId,
            sourceObjectKey: `quarantine/${first.documentId}/source`,
          },
        ]);
        // No external adapter is provided to the store. The root orchestration proves
        // source object absence before invoking reconciliation; all fixture objects are synthetic.
        expect(await store.reconcile([first.entry], preflight)).toEqual({
          restoredUsersReconciled: 1,
          restoredUsersAbsent: 0,
          restoredUsersAlreadyReconciled: 0,
        });
        expect(Object.values(await counts(first.entry.userId))).toEqual(Array(7).fill(0));
        expect(await counts(second.entry.userId)).toEqual(otherBefore);
        const [completed] = await database.client<Record<string, unknown>[]>`
        SELECT request.policy_version, request.requested_at, request.state, ledger.policy_sha256, ledger.owner_inventory
        FROM profile.account_deletion_requests request JOIN privacy.account_deletion_ledger ledger ON ledger.request_id = request.id
        WHERE request.id = ${first.entry.requestId}
      `;
        expect(completed).toMatchObject({
          policyVersion: first.entry.policyVersion,
          policySha256: first.entry.policySha256,
          state: "completed",
          ownerInventory: Object.fromEntries(
            RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, "completed"]),
          ),
        });
        expect(new Date(String(completed?.requestedAt)).toISOString()).toBe(requestedAt);
        const after = await store.preflight([first.entry]);
        expect(after.documentObjects).toEqual([]);
        expect(await store.reconcile([first.entry], after)).toEqual({
          restoredUsersReconciled: 0,
          restoredUsersAbsent: 0,
          restoredUsersAlreadyReconciled: 1,
        });
        expect((await store.preflight([first.entry])).sha256).toBe(after.sha256);
        expect(await counts(second.entry.userId)).toEqual(otherBefore);
        const [identity] = await database.client<
          { accountState: string }[]
        >`SELECT account_state FROM identity.users WHERE id = ${first.entry.userId}`;
        expect(identity?.accountState).toBe("quarantined");
      } finally {
        await finishAndRemove(first.entry);
        await finishAndRemove(second.entry);
      }
    },
    60_000,
  );

  it("diagnoses a synthetic historical completion mismatch in a real read-only snapshot without row changes", async () => {
    const generated = await seed(0);
    const entry = generated.entry;
    if (!entry.completedAt) throw new Error("SyntheticCompletionMissing");
    const persistedCompletion = entry.completedAt.toISOString();
    const eventId = uuidv7();
    const executionName = "outbox-" + eventId;
    const executionArn =
      "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-profile-readiness-durable:12/durable-execution/" +
      executionName +
      "/synthetic-execution";
    let conflictingLedger = false;
    const modes: { readOnly: string; isolation: string }[] = [];
    const readOnlyDatabase: DatabaseHandle = {
      ...database,
      client: new Proxy(database.client, {
        get(target, property, receiver) {
          if (property !== "begin") return Reflect.get(target, property, receiver);
          return (
            mode: string,
            run: (sql: Pick<DatabaseHandle["client"], "unsafe">) => Promise<unknown>,
          ) =>
            target.begin(mode, async (transaction) => {
              // Test observation only; the collector retains four LIMIT 2 selectors,
              // one exact-operation LIMIT 4 selector and no writable transaction mode.
              const [settings] = await transaction<{ readOnly: string; isolation: string }[]>`
              SELECT current_setting('transaction_read_only') AS "readOnly",
                     current_setting('transaction_isolation') AS isolation
            `;
              if (!settings) throw new Error("SyntheticTransactionSettingsMissing");
              modes.push({ readOnly: settings.readOnly, isolation: settings.isolation });
              return run(transaction);
            });
        },
      }),
    };
    const snapshotRows = async () => {
      const [observed] = await database.client<{ snapshot: unknown }[]>`
        SELECT jsonb_build_object(
          'user', (SELECT jsonb_build_object('row', to_jsonb(candidate), 'xmin', candidate.xmin::text)
                   FROM identity.users candidate WHERE candidate.id = ${entry.userId}),
          'request', (SELECT jsonb_build_object('row', to_jsonb(request), 'xmin', request.xmin::text)
                      FROM profile.account_deletion_requests request WHERE request.id = ${entry.requestId}),
          'operation', (SELECT jsonb_build_object('row', to_jsonb(operation), 'xmin', operation.xmin::text)
                        FROM platform.operations operation WHERE operation.id = ${entry.operationId}),
          'ledger', (SELECT jsonb_build_object('row', to_jsonb(ledger), 'xmin', ledger.xmin::text)
                     FROM privacy.account_deletion_ledger ledger WHERE ledger.request_id = ${entry.requestId}),
          'dispatch', (SELECT jsonb_build_object('row', to_jsonb(event), 'xmin', event.xmin::text)
                       FROM platform.outbox_events event WHERE event.id = ${eventId})
        ) AS snapshot
      `;
      if (!observed) throw new Error("SyntheticRowSnapshotMissing");
      return observed.snapshot;
    };
    try {
      // Existing generated seven-owner fixture and maintained restore ports seed
      // a coherent terminal request/ledger/operation, without any external adapter.
      await store.reconcile([entry], await store.preflight([entry]));
      // Synthetic persisted acknowledgment with deliberate nonzero microseconds.
      // A retained retry schedule is legitimate after publication; it is not a claim.
      await database.client`
        INSERT INTO platform.outbox_events
          (id, type, source, subject, data_schema, data, dispatch_target,
           created_at, published_at, durable_started_at, nudge_claimed_at,
           nudge_next_attempt_at, durable_execution_name, durable_execution_arn)
        VALUES
          (${eventId}, 'profile.account-deletion.confirmed.v1', 'urn:ai-job-apply:profile-service',
           ${"account-deletion-request/" + entry.requestId},
           'https://schemas.ai-job-apply.internal/events/profile.account-deletion.confirmed.v1.json',
           ${JSON.stringify({ deletionRequestId: entry.requestId, operationId: entry.operationId, policyVersion: entry.policyVersion })}::text::jsonb,
           'lambda_durable',
           ${persistedCompletion}::timestamptz + interval '123 microseconds',
           ${persistedCompletion}::timestamptz + interval '456 microseconds',
           ${persistedCompletion}::timestamptz + interval '789 microseconds',
           NULL, now() + interval '1 day', ${executionName}, ${executionArn})
      `;
      const wrongTag = new Date(entry.completedAt.getTime() + 1).toISOString();
      const target: HistoricalCompletionEvidenceTarget = {
        sourceSha: "a".repeat(40),
        restoreContextSha256: "b".repeat(64),
        configurationSha256: "c".repeat(64),
        markerSnapshotSha256: "d".repeat(64),
        marker: {
          bucketName: "synthetic-completion-integration",
          expectedBucketOwner: "123456789012",
          key: "candidate-deletion-recovery/" + entry.requestId + ".json",
          versionId: "synthetic-retained-completion-version",
          etag: '"synthetic-etag"',
          contentLength: 1024,
          lastModified: entry.confirmedAt.toISOString(),
          bodySha256: "1".repeat(64),
          checksumSha256: "1".repeat(64),
          metadataSha256: "2".repeat(64),
          encryptionSha256: "3".repeat(64),
          retentionSha256: "4".repeat(64),
          versionInventorySha256: "5".repeat(64),
          oldTagSet: [
            { Key: "state", Value: "completed" },
            { Key: "completed-at", Value: wrongTag },
          ],
          entry: {
            ...entry,
            confirmedAt: entry.confirmedAt.toISOString(),
            backupExpiresAt: entry.backupExpiresAt.toISOString(),
            completedAt: wrongTag,
          },
        },
      };
      await expect(
        store.preflight([{ ...entry, completedAt: new Date(wrongTag) }]),
      ).rejects.toThrow("CompletionCollision");
      const before = await snapshotRows();
      const beforeCounts = await counts(entry.userId);
      const evidence = await collectHistoricalCompletionEvidence(
        readOnlyDatabase,
        target,
        new AbortController().signal,
      );
      expect(evidence.requestRows[0]?.completedAt).toBe(persistedCompletion.slice(0, -1) + "000Z");
      expect(evidence.ledgerRows[0]?.completedAt).toBe(evidence.requestRows[0]?.completedAt);
      expect(evidence.operationRows[0]?.updatedAt).toBe(evidence.requestRows[0]?.completedAt);
      const diagnosis = diagnoseHistoricalCompletion(
        evidence,
        historicalCompletionEvidenceSha256(evidence) ?? "",
        new Date(),
      );
      expect(diagnosis.outcome).toBe("persisted_candidate");
      expect(diagnosis.dispatchEvidence).toEqual({
        status: "acknowledged_unclaimed",
        attemptCount: 1,
        bindingSha256: [expect.stringMatching(/^[a-f0-9]{64}$/u)],
        latestCreatedAt: persistedCompletion.slice(0, -1) + "123Z",
        latestAcknowledgedAt: persistedCompletion.slice(0, -1) + "789Z",
      });
      expect(readHistoricalCompletionRepairCandidate(diagnosis)?.correctedCompletedAt).toBe(
        persistedCompletion,
      );
      expect(modes).toEqual([{ readOnly: "on", isolation: "repeatable read" }]);
      expect(await snapshotRows()).toEqual(before);
      expect(await counts(entry.userId)).toEqual(beforeCounts);

      // The actual terminal UPDATE ... RETURNING must produce no retry event.
      // This proves the already-terminal path, not a synthetic concurrent lock race.
      const [dispatchBefore] = await database.client<{ count: number }[]>`
        SELECT count(*)::int AS count FROM platform.outbox_events
        WHERE data ->> 'operationId' = ${entry.operationId}
      `;
      expect(dispatchBefore?.count).toBe(1);
      await new PostgresProfileStore(database).reconcileDurableOperationFailure(
        executionName,
        "WorkflowFailed",
      );
      const [dispatchAfter] = await database.client<{ count: number }[]>`
        SELECT count(*)::int AS count FROM platform.outbox_events
        WHERE data ->> 'operationId' = ${entry.operationId}
      `;
      expect(dispatchAfter?.count).toBe(1);
      expect(await snapshotRows()).toEqual(before);

      // A controlled conflicting *synthetic* ledger proves the reader does not
      // select a timestamp or silently repair rows when persisted authorities differ.
      await database.client`
        UPDATE privacy.account_deletion_ledger
        SET completed_at = ${persistedCompletion}::timestamptz + interval '2 milliseconds',
            updated_at = ${persistedCompletion}::timestamptz + interval '2 milliseconds'
        WHERE request_id = ${entry.requestId}
      `;
      conflictingLedger = true;
      const conflictBefore = await snapshotRows();
      const conflictEvidence = await collectHistoricalCompletionEvidence(
        readOnlyDatabase,
        target,
        new AbortController().signal,
      );
      const refused = diagnoseHistoricalCompletion(
        conflictEvidence,
        historicalCompletionEvidenceSha256(conflictEvidence) ?? "",
        new Date(),
      );
      expect(refused).toMatchObject({
        outcome: "refused",
        reason: "persisted_completion_disagreement",
      });
      expect(readHistoricalCompletionRepairCandidate(refused)).toBeUndefined();
      expect(modes[1]).toEqual({ readOnly: "on", isolation: "repeatable read" });
      expect(await snapshotRows()).toEqual(conflictBefore);
    } finally {
      await database.client`DELETE FROM platform.outbox_events WHERE id = ${eventId} AND data ->> 'operationId' = ${entry.operationId}`;
      if (conflictingLedger) {
        await database.client`
          UPDATE privacy.account_deletion_ledger
          SET completed_at = ${persistedCompletion}::timestamptz,
              updated_at = ${persistedCompletion}::timestamptz
          WHERE request_id = ${entry.requestId}
        `;
      }
      await finishAndRemove(entry);
    }
  }, 60_000);

  it("rejects a later operation-owner collision without quarantining an earlier valid restored account", async () => {
    const first = await seed(0);
    const second = await seed(1);
    try {
      await database.client`INSERT INTO platform.operations (id, user_id, kind, state) VALUES (${second.entry.operationId}, ${first.entry.userId}, 'account_deletion', 'queued')`;
      const beforeFirst = await counts(first.entry.userId);
      await expect(store.preflight([first.entry, second.entry])).rejects.toThrow(
        "OperationCollision",
      );
      const [identity] = await database.client<
        { accountState: string }[]
      >`SELECT account_state FROM identity.users WHERE id = ${first.entry.userId}`;
      expect(identity?.accountState).toBe("active");
      expect(await counts(first.entry.userId)).toEqual(beforeFirst);
    } finally {
      await database.client`DELETE FROM platform.operations WHERE id = ${second.entry.operationId} AND user_id = ${first.entry.userId}`;
      await finishAndRemove(first.entry);
      await finishAndRemove(second.entry);
    }
  }, 60_000);
});
