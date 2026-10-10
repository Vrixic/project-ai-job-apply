import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadApplicationMigrations } from "../../../backend/services/applications/dist/src/application-migrations.js";
import { createLegacyReceiptKmsCipher } from "../../../backend/services/applications/dist/src/legacy-receipt-cipher.js";
import { verifyLegacyReceiptRestore } from "../../../backend/services/applications/dist/src/legacy-receipt-restore-verifier.js";
import { transitionLegacyReceipts } from "../../../backend/services/applications/dist/src/legacy-receipt-transition.js";
import { reconcileApplicationRestore } from "../../../backend/services/database-migrations/dist/src/application-restore-reconciliation.js";
import { loadCurrentRestoreManifest } from "../../../backend/services/database-migrations/dist/src/restore-verifier.js";
import { verifyRestoreCandidateOwners } from "../../../backend/services/profile/dist/src/restore-candidate-admission.js";

// The caller owns an ephemeral, labeled PostgreSQL container and tracks every client for cleanup.
// Fixed generated databases only; no inherited database/cloud/provider configuration is read.
export async function exerciseApplicationReconciliation({
  docker,
  container,
  sourceUrl,
  writeClient,
  readClient,
  clients,
}) {
  const invoke = (...args) => docker(["exec", container, ...args]);
  const oldUrl = new URL(sourceUrl);
  oldUrl.pathname = "/d3_original";
  const newUrl = new URL(sourceUrl);
  newUrl.pathname = "/d3_transition";
  for (const url of [oldUrl, newUrl]) assert.equal(url.hostname, "127.0.0.1");
  await invoke("createdb", "-U", "ai_job_apply", "--template=template0", "d3_original");
  await invoke(
    "pg_restore",
    "-U",
    "ai_job_apply",
    "-d",
    "d3_original",
    "--exit-on-error",
    "--single-transaction",
    "/d2-recovery/source.dump",
  );
  const original = writeClient(oldUrl.toString());
  clients.push(original);
  // Only the new generated copy may be rebuilt to the actual old Applications contract.
  await original.unsafe(`DROP SCHEMA applications_restricted CASCADE; DROP SCHEMA applications CASCADE;
    CREATE SCHEMA applications; CREATE TABLE applications.schema_migrations (
      version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());`);
  const migrations = await loadApplicationMigrations();
  await original.begin(async (tx) => {
    for (const migration of migrations.slice(0, 3)) {
      await tx.unsafe(migration.sql);
      await tx`INSERT INTO applications.schema_migrations(version,checksum) VALUES (${migration.version},${migration.checksum})`;
    }
    const owner = "11111111-1111-4111-8111-000000000001";
    await tx`INSERT INTO identity.users(id) VALUES (${owner})`;
    for (let index = 0; index < 7; index++) {
      const id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
      const packet = `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
      await tx`INSERT INTO applications.applications(id,owner_user_id,canonical_job_id,status,revision,current_packet_id,created_at,updated_at)
        VALUES (${id},${owner},${id},'review_required',2,${packet},'2026-01-01T00:00:00.123456Z','2026-01-01T00:00:00.123456Z')`;
      await tx`INSERT INTO applications.packets(id,application_id,owner_user_id,version,packet_hash,job_revision,fields,created_at)
        VALUES (${packet},${id},${owner},1,${"a".repeat(64)},${"b".repeat(64)},'[]'::jsonb,'2026-01-01T00:00:00.123456Z')`;
      for (const operation of ["create_packet", "create_application"]) {
        await tx`INSERT INTO applications.command_receipts(owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,created_at)
          VALUES (${owner},${`synthetic-${operation}-${index}`},${operation},${"c".repeat(64)},${id},2,'2026-01-01T00:00:00.123456Z')`;
      }
    }
  });
  await invoke(
    "pg_dump",
    "-U",
    "ai_job_apply",
    "-d",
    "d3_original",
    "--format=custom",
    "--file=/d2-recovery/old-applications.dump",
  );
  await invoke("createdb", "-U", "ai_job_apply", "--template=template0", "d3_transition");
  await invoke(
    "pg_restore",
    "-U",
    "ai_job_apply",
    "-d",
    "d3_transition",
    "--exit-on-error",
    "--single-transaction",
    "/d2-recovery/old-applications.dump",
  );
  const restored = writeClient(newUrl.toString());
  clients.push(restored);
  const key = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
  const buffers = [],
    commands = [];
  const transport = {
    send: async (command) => {
      commands.push(command.constructor.name);
      const aad = Buffer.from(
        JSON.stringify([command.input.KeyId, command.input.EncryptionContext]),
      );
      if (command.constructor.name === "EncryptCommand") {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 8), iv);
        cipher.setAAD(aad);
        const body = Buffer.concat([cipher.update(command.input.Plaintext), cipher.final()]);
        return {
          KeyId: key,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), body]),
        };
      }
      assert.equal(command.constructor.name, "DecryptCommand");
      const bytes = Buffer.from(command.input.CiphertextBlob);
      const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 8), bytes.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
      buffers.push(plaintext);
      return { KeyId: key, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", Plaintext: plaintext };
    },
  };
  const writer = createLegacyReceiptKmsCipher({
    encryptionKeyArn: key,
    enabled: () => true,
    testClient: transport,
  });
  const startedAt = new Date().toISOString();
  assert.deepEqual(
    await transitionLegacyReceipts(restored, {
      enabled: () => true,
      cipher: writer,
      expectedAppliedMigrations: 3,
      expectedLegacyReceipts: 7,
    }),
    { archivedReceipts: 7, appliedMigrations: 12 },
  );
  const endedAt = new Date().toISOString();
  commands.length = 0;
  const oldReader = readClient(oldUrl.toString()),
    newReader = readClient(newUrl.toString());
  clients.push(oldReader, newReader);
  const current = loadCurrentRestoreManifest();
  const originalSource = {
    sha256: "1a67ddc33ab3fa2bd84cce4a3d452728a90f8ee755c04b953c13ca5ba8aefb3b",
    manifest: {
      ...current.manifest,
      manifestId: "d3-latest-pretransition-applications-three-v1",
      contributors: current.manifest.contributors.map((owner) =>
        owner.owner === "applications"
          ? {
              ...owner,
              schemas: ["applications"],
              migrations: owner.migrations.slice(0, 3),
              relations: [
                "applications",
                "approvals",
                "attempts",
                "command_receipts",
                "history",
                "outbox",
                "packets",
                "schema_migrations",
              ].map((name) => `applications.${name}`),
            }
          : owner,
      ),
    },
  };
  let admission = () => {};
  const reader = createLegacyReceiptKmsCipher({
    encryptionKeyArn: key,
    enabled: () => {
      admission();
      return true;
    },
    readOnly: true,
    testClient: transport,
  });
  const run = () =>
    reconcileApplicationRestore(oldReader, newReader, {
      originalSource,
      transitionStartedAt: startedAt,
      transitionEndedAt: endedAt,
      enabled: () => true,
      verifyReceipts: (old, next, admit) => {
        admission = admit;
        return verifyLegacyReceiptRestore(old, next, {
          encryptionKeyArn: key,
          enabled: () => {
            admit();
            return true;
          },
          cipher: reader,
          verifyActiveOwners: verifyRestoreCandidateOwners,
        });
      },
    });
  assert.equal((await run()).transitionReconciled, true);
  assert.equal(commands.length, 7);
  assert.ok(commands.every((command) => command === "DecryptCommand"));
  let cases = 1;
  const corrupt = (client, query) =>
    client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role=replica");
      await tx.unsafe(query);
    });
  const first = "22222222-2222-4222-8222-000000000001";
  // Fixed corruption probes apply only in this generated copy; triggers are suppressed locally
  // to model damaged snapshots, and each original value is restored before the next probe.
  for (const [change, restore] of [
    [
      `UPDATE applications.packets SET job_revision=repeat('d',64) WHERE application_id='${first}'`,
      `UPDATE applications.packets SET job_revision=repeat('b',64) WHERE application_id='${first}'`,
    ],
    [
      `UPDATE applications.schema_migrations SET applied_at=applied_at+interval '1 microsecond' WHERE version='0001_applications_foundation'`,
      `UPDATE applications.schema_migrations SET applied_at=applied_at-interval '1 microsecond' WHERE version='0001_applications_foundation'`,
    ],
    [
      `UPDATE applications.command_receipts SET response_revision=3 WHERE application_id='${first}' AND operation='archived_legacy'`,
      `UPDATE applications.command_receipts SET response_revision=2 WHERE application_id='${first}' AND operation='archived_legacy'`,
    ],
    [
      `ALTER TABLE applications_restricted.legacy_receipts ADD COLUMN unreconciled text`,
      `ALTER TABLE applications_restricted.legacy_receipts DROP COLUMN unreconciled`,
    ],
  ]) {
    await corrupt(restored, change);
    await assert.rejects(run, { message: "ApplicationRestoreReconciliationFailed" });
    await corrupt(restored, restore);
    assert.equal((await run()).transitionReconciled, true);
    cases++;
  }
  // Both catalogs/data still agree; the owning Identity read must independently refuse quarantine.
  for (const client of [original, restored])
    await client.unsafe(
      "UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id='11111111-1111-4111-8111-000000000001'",
    );
  // Set the same exact timestamp so this refusal is not merely a cross-snapshot digest mismatch.
  for (const client of [original, restored])
    await client.unsafe(
      "UPDATE identity.users SET quarantined_at='2026-01-02T00:00:00Z' WHERE id='11111111-1111-4111-8111-000000000001'",
    );
  await assert.rejects(run, { message: "ApplicationRestoreReconciliationFailed" });
  for (const client of [original, restored])
    await client.unsafe(
      "UPDATE identity.users SET account_state='active',quarantined_at=NULL WHERE id='11111111-1111-4111-8111-000000000001'",
    );
  assert.equal((await run()).transitionReconciled, true);
  cases++;
  await corrupt(
    original,
    "UPDATE applications.command_receipts SET request_hash=repeat('d',64) WHERE operation='create_packet'",
  );
  await assert.rejects(run, { message: "ApplicationRestoreReconciliationFailed" });
  await corrupt(
    original,
    "UPDATE applications.command_receipts SET request_hash=repeat('c',64) WHERE operation='create_packet'",
  );
  assert.equal((await run()).transitionReconciled, true);
  cases++;
  assert.ok(buffers.every((bytes) => bytes.every((value) => value === 0)));
  return {
    applicationTransitionReconciliationProbes: cases,
    applicationReconciliationLiveKms: false,
  };
}
