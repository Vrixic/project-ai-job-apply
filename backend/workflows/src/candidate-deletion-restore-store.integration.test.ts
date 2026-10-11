import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ApplicationStoreOptions,
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import { createJobCatalogDatabase } from "@ai-job-apply/jobs-service";
import {
  type CandidateDeletionConfirmationJournalEntry,
  createBuildingCandidateExportAuthorizer,
  createDatabase,
  type DatabaseHandle,
  PostgresProfileStore,
} from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
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
import { digestRestoredData } from "./candidate-deletion-restore-preservation.js";
import { AwsReadOnlyCandidateRestoreDocuments } from "./candidate-deletion-restore-aws.js";
import { verifyReconciledCandidateDeletionCopy } from "./candidate-deletion-reconciled-copy.js";
import {
  restoreInspectionSha256,
  type CandidateDeletionRestoreReplayResult,
} from "./candidate-deletion-restore-contract.js";
import { inspectReconciledCandidateDeletionRows } from "./candidate-deletion-restore-postconditions.js";
import { PostgresCandidateRightsActivityStore } from "./candidate-rights-activities.js";
import { AwsCandidateDocumentObjectStore } from "./candidate-rights-aws.js";
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

describe.skipIf(!requested)("isolated restored PostgreSQL eight-owner deletion replay", () => {
  let database: DatabaseHandle;
  let raw: ReturnType<typeof createJobCatalogDatabase>;
  let store: PostgresCandidateDeletionRestoreStore;
  let seedD2: (client: unknown, profile: unknown) => Promise<{ ownerUserId: string }>;
  let restrictedPackets: ApplicationStoreOptions["restrictedPackets"];
  let applicationsSql: ReturnType<typeof createApplicationsDatabase>;
  let releaseProtection: (() => void) | undefined;

  beforeAll(async () => {
    // Root/operator creates the exact isolated local database. This test neither starts
    // Docker nor creates/drops databases, and never inherits cloud/provider credentials.
    for (const owner of [
      "profile",
      "documents",
      "jobs",
      "matching",
      "billing",
      "trust",
      "applications",
    ]) {
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
    const { createSyntheticPacketProtection } = await import(
      new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
    );
    const protection = createSyntheticPacketProtection();
    restrictedPackets = protection.options;
    releaseProtection = protection.destroy;
    applicationsSql = createApplicationsDatabase(databaseUrl as string, { maxConnections: 2 });
  }, 90_000);

  afterAll(async () => {
    releaseProtection?.();
    await applicationsSql?.end();
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
    // Applications data written before a candidate-rights policy tracked it must still be purged.
    const applicationId = uuidv7();
    await database.client`
      INSERT INTO applications.applications
        (id, owner_user_id, canonical_job_id, status, revision, created_at, updated_at)
      VALUES (${applicationId}, ${userId}, ${uuidv7()}, 'preparing', 1, now(), now())
    `;
    await database.client`
      INSERT INTO applications.history
        (id, application_id, owner_user_id, seq, kind, to_status, occurred_at)
      VALUES (${uuidv7()}, ${applicationId}, ${userId}, 1, 'application_created', 'preparing', now())
    `;
    // A paired synthetic encrypted archive exercises deletion, never live KMS or digest replay.
    const legacyKey = uuidv7();
    const ciphertext = randomBytes(80);
    const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");
    await database.client.begin(async (tx) => {
      await tx`
        INSERT INTO applications.command_receipts
          (owner_user_id, idempotency_key, application_id, operation, request_hash,
           request_hash_scheme, response_revision, created_at)
        VALUES (${userId}, ${legacyKey}, ${applicationId}, 'archived_legacy', ${ciphertextHash},
          'legacy-ciphertext-sha256.v1', 1, now())
      `;
      await tx`
        INSERT INTO applications_restricted.legacy_receipts
          (owner_user_id, idempotency_key, application_id, protection_id, original_operation,
           metadata_sha256, encryption_key_arn, ciphertext)
        VALUES (${userId}, ${legacyKey}, ${applicationId}, ${uuidv7()}, 'create_packet',
          ${"a".repeat(64)}, 'arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111',
          ${ciphertext})
      `;
    });
    ciphertext.fill(0);
    const packets = new PostgresApplicationStore(applicationsSql, undefined, {
      definitions: defaultFieldDefinitions(),
      ...(restrictedPackets ? { restrictedPackets } : {}),
    });
    const created = await packets.createApplication({
      ownerUserId: userId,
      canonicalJobId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    const protectedPacket = await packets.createPacket({
      ownerUserId: userId,
      applicationId: created.view.application.id,
      expectedRevision: created.view.application.revision,
      idempotencyKey: uuidv7(),
      packet: {
        jobRevision: "a".repeat(64),
        form: null,
        artifactHashes: {},
        fields: [
          {
            fieldKey: "authorization.us_authorized",
            value: true,
            origin: "user_entered",
            sourceFactIds: [],
            sourceConfirmed: true,
            confidence: 1,
          },
        ],
      },
    });
    const current = protectedPacket.view.currentPacket;
    if (!current) throw Error("Missing generated protected packet");
    const values = await packets.readCurrentPacketValues({
      ownerUserId: userId,
      applicationId: created.view.application.id,
      expectedRevision: protectedPacket.view.application.revision,
      packetId: current.id,
      packetHash: current.packetHash,
    });
    expect(values.values.get("authorization.us_authorized")).toBe(true);
    if (values.values instanceof Map) values.values.clear();
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
        applications: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM identity.external_identities WHERE user_id = ${userId}) AS identity,
        (SELECT count(*)::int FROM profile.ugc_contribution_consents WHERE owner_user_id = ${userId}) AS profile,
        (SELECT count(*)::int FROM documents.resume_documents WHERE user_id = ${userId}) AS documents,
        (SELECT count(*)::int FROM jobs.job_contributions WHERE owner_user_id = ${userId}) AS jobs,
        (SELECT count(*)::int FROM matching.private_saved_page_captures WHERE owner_user_id = ${userId}) AS matching,
        (SELECT count(*)::int FROM billing.entitlement_accounts WHERE user_id = ${userId}) AS billing,
        (SELECT count(*)::int FROM trust.contribution_cases WHERE contributor_user_id = ${userId}) AS trust,
        ((SELECT count(*)::int FROM applications.applications WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.packets WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.approvals WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.attempts WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.history WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.command_receipts WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.outbox WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.packet_preparations WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.preparation_outbox WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.preparation_audit WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.native_material_withdrawals WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications.native_material_cleanup_queue WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications_restricted.legacy_receipts WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications_restricted.packet_values WHERE owner_user_id = ${userId}) +
         (SELECT count(*)::int FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${userId})) AS applications
    `;
    if (!row) throw new Error("Synthetic owner inventory missing");
    return row;
  }

  async function finishAndRemove(entry: CandidateDeletionRecoveryEntry) {
    // Exact generated fixture cleanup uses the same authorized eight-owner ports,
    // never broad table deletion or a production identity call.
    const preflight = await store.preflight([entry]);
    await store.reconcile([entry], preflight);
    await database.client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${entry.requestId}`;
    await database.client`DELETE FROM identity.users WHERE id = ${entry.userId}`;
  }

  it.each(["restricted_answer", "cover_letter", "native_admission"] as const)(
    "reconciles a completed historical deletion with ONLY independent %s remaining",
    async (kind) => {
      const target = await seed(1);
      const other = await seed(1);
      const rootId = uuidv7();
      try {
        await store.reconcile([target.entry], await store.preflight([target.entry]));
        const otherBefore = await counts(other.entry.userId);
        if (kind === "restricted_answer") {
          await database.client`INSERT INTO profile.restricted_answers (id,user_id,field_key) VALUES (${rootId},${target.entry.userId},'authorization.us_authorized')`;
          await database.client`INSERT INTO profile.restricted_answer_versions
            (answer_id,version,value_type,sensitivity,ciphertext,kms_key_id,encryption_algorithm,state,source_reference,confirmed_at)
            VALUES (${rootId},1,'boolean','restricted',${randomBytes(80)},'synthetic-key','SYMMETRIC_DEFAULT','active','synthetic',now())`;
        } else if (kind === "cover_letter") {
          await database.client`INSERT INTO documents.cover_letters
            (id,user_id,application_id,version,job_revision,confirmed_facts_hash,object_key)
            VALUES (${rootId},${target.entry.userId},${uuidv7()},1,${"a".repeat(64)},${"b".repeat(64)},${`normalized/${rootId}/cover-letter.v1.json`})`;
        } else {
          await database.client`INSERT INTO documents.native_material_admission (user_id,application_id,epoch_id)
            VALUES (${target.entry.userId},${rootId},${uuidv7()})`;
        }
        const reviewed = await store.preflight([target.entry]);
        await expect(
          database.client.begin("read only isolation level repeatable read", (sql) =>
            inspectReconciledCandidateDeletionRows(
              sql,
              [target.entry],
              Date.now() + 90_000,
              new AbortController().signal,
            ),
          ),
        ).rejects.toThrow("PostconditionsRejected");
        if (kind === "cover_letter") {
          expect(reviewed.documentObjects).toEqual([
            {
              kind: "cover_letter",
              userId: target.entry.userId,
              documentId: rootId,
              objectKey: `normalized/${rootId}/cover-letter.v1.json`,
            },
          ]);
          const objects = new AwsReadOnlyCandidateRestoreDocuments({
            bucketName: "generated-restore-documents",
            expectedBucketOwner: "123456789012",
            s3: {
              send: async (command: unknown) => {
                if (!(command instanceof ListObjectVersionsCommand))
                  throw new Error("UnexpectedSyntheticCloudWrite");
                return {
                  Name: command.input.Bucket,
                  Prefix: command.input.Prefix,
                  MaxKeys: command.input.MaxKeys,
                  IsTruncated: false,
                  Versions: [
                    {
                      Key: `normalized/${rootId}/generation/result.v1.json`,
                      VersionId: "unregistered-original",
                      IsLatest: true,
                    },
                  ],
                };
              },
            },
          });
          await expect(
            objects.inspectExpectedAbsentDocuments(reviewed.documentObjects),
          ).rejects.toThrow("CloudInspectionRejected");
          expect((await store.preflight([target.entry])).documentObjects).toEqual(
            reviewed.documentObjects,
          );
        }
        expect(await store.reconcile([target.entry], reviewed)).toMatchObject({
          restoredUsersReconciled: 1,
          restoredUsersAlreadyReconciled: 0,
        });
        expect(
          await database.client.begin("read only isolation level repeatable read", (sql) =>
            inspectReconciledCandidateDeletionRows(
              sql,
              [target.entry],
              Date.now() + 90_000,
              new AbortController().signal,
            ),
          ),
        ).toEqual({ restoredSubjectsPresent: 1, restoredSubjectsAbsent: 0 });
        expect(await counts(other.entry.userId)).toEqual(otherBefore);
        expect(
          await store.reconcile([target.entry], await store.preflight([target.entry])),
        ).toMatchObject({ restoredUsersReconciled: 0, restoredUsersAlreadyReconciled: 1 });
      } finally {
        await finishAndRemove(target.entry);
        await finishAndRemove(other.entry);
      }
    },
    60_000,
  );

  it("verifies exact reconciled data read-only and refuses same-count changes and microsecond terminal conflicts", async () => {
    const target = await seed(1);
    const other = await seed(1);
    try {
      const replay = await store.reconcile([target.entry], await store.preflight([target.entry]));
      const configurationSha256 = "a".repeat(64),
        markerSnapshotSha256 = "b".repeat(64),
        restoredPreflightSha256 = "c".repeat(64);
      // Optional diagnostic receipt: compute its digest explicitly in the test,
      // without making production replay depend on a whole-database proof.
      const diagnosticDigest = await database.client.begin(
        "read only isolation level repeatable read",
        (tx) =>
          digestRestoredData(tx, [], { deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 }),
      );
      // Numeric deployment/immutable receipt provenance is SIMULATED; SQL/digest/transaction behavior is real.
      const receipt: CandidateDeletionRestoreReplayResult = {
        schemaVersion: 1,
        action: "replay",
        outcome: "replayed",
        runId: "d".repeat(32),
        sourceSha: "e".repeat(40),
        configurationSha256,
        functionVersion: "3",
        expiresAt: "2026-09-01T00:30:00.000Z",
        markerSnapshotSha256,
        restoredPreflightSha256,
        inspectionSha256: restoreInspectionSha256(
          configurationSha256,
          markerSnapshotSha256,
          restoredPreflightSha256,
        ),
        markersValidated: 1,
        historicalPolicyMarkers: 0,
        currentPolicyMarkers: 1,
        restoredSubjectsPresent: 1,
        restoredSubjectsAbsent: 0,
        documentKeysChecked: 1,
        documentVersionsObserved: 0,
        s3Writes: 0,
        recoveryLedgerWrites: 0,
        identityProviderCalls: 0,
        ...replay,
        preservation: {
          schemaVersion: 1,
          unchanged: diagnosticDigest,
          reconciled: diagnosticDigest,
        },
      };
      const snapshot = {
        entries: [target.entry],
        sha256: markerSnapshotSha256,
        historicalPolicyMarkers: 0,
        currentPolicyMarkers: 1,
      };
      const ledger = {
        inspectCompletedMarkers: async () => snapshot,
        assertUnchanged: async () => undefined,
      };
      const verified = await verifyReconciledCandidateDeletionCopy(database, ledger, receipt);
      expect(verified.reconciled.relationCount).toBe(96);
      await expect(
        database.client.begin("read only isolation level repeatable read", async (sql) => {
          await inspectReconciledCandidateDeletionRows(
            sql,
            [target.entry],
            Date.now() + 90_000,
            new AbortController().signal,
          );
          await sql.unsafe("UPDATE identity.users SET account_state='active' WHERE id=$1::uuid", [
            target.entry.userId,
          ]);
        }),
      ).rejects.toMatchObject({ code: "25006" });
      expect(
        (await verifyReconciledCandidateDeletionCopy(database, ledger, receipt)).reconciled,
      ).toEqual(verified.reconciled);
      await database.client`UPDATE billing.entitlement_accounts SET effective_at=effective_at-interval '1 second' WHERE user_id=${other.entry.userId}`;
      await expect(
        verifyReconciledCandidateDeletionCopy(database, ledger, receipt),
      ).rejects.toThrow("ReconciledCopyRejected");
      await database.client`UPDATE billing.entitlement_accounts SET effective_at=effective_at+interval '1 second' WHERE user_id=${other.entry.userId}`;
      // A 1us difference has the same JavaScript millisecond projection; SQL must still reject it.
      await database.client`UPDATE profile.account_deletion_requests SET completed_at=completed_at+interval '1 microsecond' WHERE id=${target.entry.requestId}`;
      await expect(
        database.client.begin("read only isolation level repeatable read", (sql) =>
          inspectReconciledCandidateDeletionRows(
            sql,
            [target.entry],
            Date.now() + 90_000,
            new AbortController().signal,
          ),
        ),
      ).rejects.toThrow("PostconditionsRejected");
      await database.client`UPDATE profile.account_deletion_requests SET completed_at=completed_at-interval '1 microsecond' WHERE id=${target.entry.requestId}`;
      expect(
        (await verifyReconciledCandidateDeletionCopy(database, ledger, receipt)).reconciled,
      ).toEqual(verified.reconciled);
    } finally {
      await finishAndRemove(target.entry);
      await finishAndRemove(other.entry);
    }
  }, 60_000);

  it("rejects nine real terminal-state corruptions without retaining any mutation", async () => {
    const target = await seed(1);
    try {
      await store.reconcile([target.entry], await store.preflight([target.entry]));
      const fingerprint = () =>
        database.client.begin("read only isolation level repeatable read", (sql) =>
          digestRestoredData(sql, [], { deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 }),
        );
      const before = await fingerprint();
      const corruptions = [
        "UPDATE identity.users SET account_state='active',quarantined_at=NULL WHERE id=$1::uuid",
        "UPDATE platform.operations SET kind='candidate_data_export' WHERE id=$3::uuid",
        "UPDATE platform.operations SET state='queued' WHERE id=$3::uuid",
        "UPDATE platform.operations SET error_code='generated-conflict' WHERE id=$3::uuid",
        "UPDATE platform.operations SET result=jsonb_build_object('resourceId',$1::text,'resourceType','account_deletion_request') WHERE id=$3::uuid",
        'UPDATE privacy.account_deletion_ledger SET owner_inventory=\'{"profile":"completed"}\'::jsonb WHERE request_id=$2::uuid',
        'UPDATE privacy.account_deletion_ledger SET subprocessor_inventory=\'{"generated":"pending"}\'::jsonb WHERE request_id=$2::uuid',
        "UPDATE privacy.account_deletion_ledger SET completed_at=completed_at+interval '1 microsecond' WHERE request_id=$2::uuid",
        "INSERT INTO privacy.account_deletion_ledger (request_id,subject_digest,policy_version,policy_sha256,state,owner_inventory,subprocessor_inventory,confirmed_at,backup_expires_at,completed_at) SELECT $1::uuid,subject_digest,policy_version,policy_sha256,state,owner_inventory,subprocessor_inventory,confirmed_at,backup_expires_at,completed_at FROM privacy.account_deletion_ledger WHERE request_id=$2::uuid",
      ];
      for (const mutation of corruptions) {
        await expect(
          database.client.begin(async (sql) => {
            // Cast every declared positional binding, including parameters unused by this fixed case.
            await sql.unsafe(`WITH bound AS (SELECT $1::uuid,$2::uuid,$3::uuid) ${mutation}`, [
              target.entry.userId,
              target.entry.requestId,
              target.entry.operationId,
            ]);
            await expect(
              inspectReconciledCandidateDeletionRows(
                sql,
                [target.entry],
                Date.now() + 90_000,
                new AbortController().signal,
              ),
            ).rejects.toThrow("PostconditionsRejected");
            throw new Error("SyntheticCorruptionRollback");
          }),
        ).rejects.toThrow("SyntheticCorruptionRollback");
      }
      expect(await fingerprint()).toEqual(before);
    } finally {
      await finishAndRemove(target.entry);
    }
  }, 60_000);

  it("preserves valid historical backup-expired inventory while proving every current owner empty", async () => {
    const target = await seed(1);
    try {
      target.entry.confirmedAt = new Date(Date.now() - 40 * 86_400_000);
      target.entry.backupExpiresAt = new Date(target.entry.confirmedAt.getTime() + 35 * 86_400_000);
      target.entry.completedAt = new Date(target.entry.confirmedAt.getTime() + 1000);
      await database.client`UPDATE identity.users SET created_at=${new Date(target.entry.confirmedAt.getTime() - 1000).toISOString()}::timestamptz WHERE id=${target.entry.userId}`;
      await store.reconcile([target.entry], await store.preflight([target.entry]));
      const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[1];
      if (!policy) throw new Error("SyntheticPolicyMissing");
      const historical = JSON.stringify(
        Object.fromEntries(policy.ownerInventory.map((owner) => [owner, "completed"])),
      );
      const expiredAt = new Date(Date.now() - 86_400_000).toISOString();
      await database.client`UPDATE profile.account_deletion_requests SET state='backup_expired',backup_expired_at=${expiredAt}::timestamptz WHERE id=${target.entry.requestId}`;
      await database.client`UPDATE privacy.account_deletion_ledger SET state='backup_expired',backup_expired_at=${expiredAt}::timestamptz,owner_inventory=${historical}::jsonb WHERE request_id=${target.entry.requestId}`;
      const before = await database.client.begin(
        "read only isolation level repeatable read",
        (sql) =>
          digestRestoredData(sql, [], { deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 }),
      );
      expect(
        await store.reconcile([target.entry], await store.preflight([target.entry])),
      ).toMatchObject({ restoredUsersAlreadyReconciled: 1, restoredUsersReconciled: 0 });
      expect(
        await database.client.begin("read only isolation level repeatable read", (sql) =>
          inspectReconciledCandidateDeletionRows(
            sql,
            [target.entry],
            Date.now() + 90_000,
            new AbortController().signal,
          ),
        ),
      ).toMatchObject({ restoredSubjectsPresent: 1 });
      const after = await database.client.begin(
        "read only isolation level repeatable read",
        (sql) =>
          digestRestoredData(sql, [], { deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 }),
      );
      expect(after).toEqual(before);
    } finally {
      await finishAndRemove(target.entry);
    }
  }, 60_000);

  it("includes same-user unrelated requests, operations, keys, exports and nullable audit in preservation", async () => {
    const target = await seed(1);
    try {
      await expect(
        database.client.begin("isolation level serializable", async (tx) => {
          const fingerprint = () =>
            digestRestoredData(tx, [target.entry], {
              deadline: Date.now() + 90_000,
              rowCount: 0,
              byteCount: 0,
            });
          let prior = await fingerprint();
          const operationId = uuidv7();
          const statements: Array<() => Promise<unknown>> = [
            () =>
              tx`INSERT INTO platform.operations (id,user_id,kind,state) VALUES (${operationId},${target.entry.userId},'candidate_data_export','queued')`,
            () =>
              tx`INSERT INTO profile.account_deletion_requests (id,user_id,policy_version,state,version) VALUES (${uuidv7()},${target.entry.userId},${target.entry.policyVersion},'requested',1)`,
            () =>
              tx`INSERT INTO platform.idempotency_keys (user_id,scope,key,request_hash,response) VALUES (${target.entry.userId},'synthetic.unrelated','synthetic','synthetic','{}'::jsonb)`,
            () =>
              tx`INSERT INTO profile.candidate_data_exports (id,user_id,operation_id,format,policy_version,state) VALUES (${uuidv7()},${target.entry.userId},${operationId},'candidate-data-export-v1',${target.entry.policyVersion},'queued')`,
            () =>
              tx`INSERT INTO platform.audit_events (id,user_id,action,resource_type,trace_id) VALUES (${uuidv7()},NULL,'synthetic.unrooted','synthetic','synthetic')`,
            () =>
              tx`INSERT INTO platform.audit_events (id,user_id,action,resource_type,trace_id) VALUES (${uuidv7()},${target.entry.userId},'profile.account-deletion.synthetic','synthetic','synthetic')`,
            () =>
              tx`INSERT INTO platform.outbox_events (id,type,source,subject,data_schema,data) VALUES (${uuidv7()},'synthetic','synthetic',${target.entry.userId},'synthetic','{}'::jsonb)`,
          ];
          for (const insert of statements) {
            await insert();
            const next = await fingerprint();
            expect(next.rowCount).toBe(prior.rowCount + 1);
            expect(next.sha256).not.toBe(prior.sha256);
            prior = next;
          }
          throw new Error("SyntheticProjectionRollback");
        }),
      ).rejects.toThrow("SyntheticProjectionRollback");
    } finally {
      await finishAndRemove(target.entry);
    }
  }, 60_000);

  it("preserves every unrelated whole row during replay and detects same-count value changes", async () => {
    const target = await seed(1);
    const other = await seed(1);
    const fingerprint = () =>
      database.client.begin("read only isolation level repeatable read", (tx) =>
        digestRestoredData(tx, [target.entry], {
          deadline: Date.now() + 90_000,
          rowCount: 0,
          byteCount: 0,
        }),
      );
    try {
      const before = await fingerprint();
      const preflight = await store.preflight([target.entry]);
      const result = await store.reconcile([target.entry], preflight);
      expect(result).not.toHaveProperty("preservation");
      expect(await fingerprint()).toEqual(before);
      await database.client`UPDATE billing.entitlement_accounts SET effective_at = effective_at - interval '1 second' WHERE user_id = ${other.entry.userId}`;
      const changed = await fingerprint();
      expect(changed.rowCount).toBe(before.rowCount);
      expect(changed.sha256).not.toBe(before.sha256);
    } finally {
      await finishAndRemove(target.entry);
      await finishAndRemove(other.entry);
    }
  }, 60_000);

  it("persists confirmation across SQL rollback, retains quarantine on incomplete prefix purge, and retries completion", async () => {
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
      const documentId = uuidv7();
      const sourceKey = `quarantine/${documentId}/source`;
      const normalizedKey = `normalized/${documentId}/current-parser/resume.json`;
      const olderKey = `normalized/${documentId}/older-parser/resume.json`;
      const neighborKey = `normalized/${uuidv7()}/older-parser/resume.json`;
      const generationKey = `normalized/${documentId}/generation/result.v1.json`;
      const pendingLetterId = uuidv7();
      await database.client`
        INSERT INTO documents.cover_letters (id, user_id, application_id, version, job_revision,
          confirmed_facts_hash, object_key)
        VALUES (${pendingLetterId}, ${userId}, ${uuidv7()}, 1, ${"a".repeat(64)}, ${"b".repeat(64)},
          ${`normalized/${pendingLetterId}/cover-letter.v1.json`})
      `;
      await database.client`
        INSERT INTO documents.resume_documents (id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status)
        VALUES (${documentId}, ${userId}, 'generated.pdf', 'application/pdf', 1, ${"1".repeat(64)}, ${sourceKey}, 'awaiting_upload')
      `;
      type ObjectVersion = { Key: string; VersionId: string };
      let versions: ObjectVersion[] = [
        { Key: sourceKey, VersionId: "source" },
        { Key: normalizedKey, VersionId: "current" },
        { Key: olderKey, VersionId: "older" },
        { Key: olderKey, VersionId: "marker-older" },
        { Key: generationKey, VersionId: "generation-pending" },
        { Key: generationKey, VersionId: "generation-ready" },
        { Key: neighborKey, VersionId: "neighbor" },
      ];
      let reappear = true;
      let fenceSequence = 0;
      let generationQuiescent = false;
      const documentObjectStore = new AwsCandidateDocumentObjectStore(
        "generated-only-bucket",
        {
          send: async (command: unknown) => {
            if (command instanceof ListObjectVersionsCommand) {
              const prefix = command.input.Prefix;
              if (!prefix) throw new Error("SyntheticPrefixMissing");
              const matching = versions.filter((entry) => entry.Key.startsWith(prefix));
              const listed = matching.map((entry) => ({
                ...entry,
                IsLatest: versions.filter((item) => item.Key === entry.Key).at(-1) === entry,
              }));
              return {
                IsTruncated: false,
                Versions: listed.filter((entry) => !entry.VersionId.startsWith("marker")),
                DeleteMarkers: listed.filter((entry) => entry.VersionId.startsWith("marker")),
              };
            }
            if (command instanceof DeleteObjectCommand) {
              expect(command.input.Key).toBe(generationKey);
              expect(command.input.VersionId).toBeUndefined();
              const version = `marker-fence-${++fenceSequence}`;
              versions.push({ Key: generationKey, VersionId: version });
              return { $metadata: { httpStatusCode: 204 }, DeleteMarker: true, VersionId: version };
            }
            if (command instanceof DeleteObjectsCommand) {
              const objects = command.input.Delete?.Objects ?? [];
              versions = versions.filter(
                (entry) =>
                  !objects.some(
                    (object) => object.Key === entry.Key && object.VersionId === entry.VersionId,
                  ),
              );
              if (reappear) versions.push({ Key: olderKey, VersionId: "late" });
              return {};
            }
            throw new Error("SyntheticUnexpectedObjectCommand");
          },
        },
        { confirm: async () => generationQuiescent },
      );
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
        documentObjectStore,
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
      await expect(activities.deleteActiveSystems(input)).rejects.toThrow(
        "CandidateGenerationQuiescenceUnconfirmed",
      );
      expect(versions.some((entry) => entry.Key === sourceKey)).toBe(true);
      expect(fenceSequence).toBe(0);
      const [pendingHeld] = await database.client<Record<string, unknown>[]>`
        SELECT request.state, candidate.account_state,
          (SELECT count(*)::int FROM documents.cover_letters WHERE user_id = ${userId}) AS letter_count
        FROM profile.account_deletion_requests request JOIN identity.users candidate ON candidate.id = request.user_id
        WHERE request.id = ${request.id}
      `;
      expect(pendingHeld).toMatchObject({
        state: "quarantined",
        accountState: "quarantined",
        letterCount: 1,
      });
      generationQuiescent = true;
      await expect(activities.deleteActiveSystems(input)).rejects.toThrow(
        "ResumePurgeObjectDeletionIncomplete",
      );
      const [held] = await database.client<Record<string, unknown>[]>`
        SELECT request.state, candidate.account_state,
          (SELECT count(*)::int FROM documents.resume_documents WHERE user_id = ${userId}) AS document_count
        FROM profile.account_deletion_requests request JOIN identity.users candidate ON candidate.id = request.user_id
        WHERE request.id = ${request.id}
      `;
      expect(held).toMatchObject({
        state: "quarantined",
        accountState: "quarantined",
        documentCount: 1,
      });
      expect(versions.filter((entry) => entry.Key === generationKey)).toEqual([
        { Key: generationKey, VersionId: "marker-fence-1" },
      ]);
      reappear = false;
      await activities.deleteActiveSystems(input);
      expect(versions).toEqual([{ Key: neighborKey, VersionId: "neighbor" }]);
      expect(fenceSequence).toBe(2);
      const [purged] = await database.client<Record<string, unknown>[]>`
        SELECT count(*)::int AS count FROM documents.resume_documents WHERE user_id = ${userId}
      `;
      expect(purged?.count).toBe(0);
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
      expect(await store.reconcile([entry], preflight)).toMatchObject({
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
        restrictedPacketExport: new PostgresApplicationStore(applicationsSql, () => generatedAt, {
          definitions: defaultFieldDefinitions(),
          ...(restrictedPackets ? { restrictedPackets } : {}),
          authorizeRestrictedPacketExport: createBuildingCandidateExportAuthorizer({
            policy,
            enabled: () => true,
          }),
        }),
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
      const applicationSection = envelope.applications as {
        packets: Array<{ fields: Array<{ fieldKey: string; value: unknown }> }>;
      };
      expect(
        applicationSection.packets
          .flatMap((packet) => packet.fields)
          .filter((field) => field.fieldKey === "authorization.us_authorized")
          .map((field) => field.value),
      ).toEqual([true]);
      expect(serialized).not.toContain("restrictedPacketReferences");
      expect(serialized).not.toContain("protectedValue");
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
        expect(await store.reconcile([first.entry], preflight)).toMatchObject({
          restoredUsersReconciled: 1,
          restoredUsersAbsent: 0,
          restoredUsersAlreadyReconciled: 0,
        });
        expect(Object.values(await counts(first.entry.userId))).toEqual(Array(8).fill(0));
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
        expect(await store.reconcile([first.entry], after)).toMatchObject({
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

  it.each([false, true])(
    "reconciles completed deletion with only native withdrawal data remaining (cleanup queue: %s)",
    async (withCleanupQueue) => {
      const first = await seed(1);
      const second = await seed(1);
      try {
        const otherBefore = await counts(second.entry.userId);
        await store.reconcile([first.entry], await store.preflight([first.entry]));
        expect(Object.values(await counts(first.entry.userId))).toEqual(Array(8).fill(0));
        // Represent a restored completed ledger with this independent Applications root left over.
        const withdrawalId = uuidv7();
        await database.client`
          INSERT INTO applications.native_material_withdrawals (id, owner_user_id, requested_at)
          VALUES (${withdrawalId}, ${first.entry.userId}, ${first.entry.confirmedAt.toISOString()}::timestamptz)
        `;
        if (withCleanupQueue) {
          const completedAt = first.entry.completedAt;
          if (!completedAt) throw new Error("SyntheticCompletionMissing");
          await database.client`
            INSERT INTO applications.native_material_cleanup_queue
              (request_id, owner_user_id, state, completed_at)
            VALUES (${withdrawalId}, ${first.entry.userId}, 'native_tasks_settled',
              ${completedAt.toISOString()}::timestamptz)
          `;
        }
        expect((await counts(first.entry.userId)).applications).toBe(withCleanupQueue ? 2 : 1);
        expect(
          await store.reconcile([first.entry], await store.preflight([first.entry])),
        ).toMatchObject({
          restoredUsersReconciled: 1,
          restoredUsersAbsent: 0,
          restoredUsersAlreadyReconciled: 0,
        });
        expect(Object.values(await counts(first.entry.userId))).toEqual(Array(8).fill(0));
        expect(await counts(second.entry.userId)).toEqual(otherBefore);
        expect(
          await store.reconcile([first.entry], await store.preflight([first.entry])),
        ).toMatchObject({
          restoredUsersReconciled: 0,
          restoredUsersAbsent: 0,
          restoredUsersAlreadyReconciled: 1,
        });
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
