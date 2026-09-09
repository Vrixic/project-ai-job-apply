import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import { createJobCatalogDatabase } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  type DatabaseHandle,
  PostgresProfileStore,
} from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
