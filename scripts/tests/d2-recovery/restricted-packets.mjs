import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { canonicalJson } from "../../../backend/services/applications/dist/src/canonical.js";
import {
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "../../../backend/services/applications/dist/src/index.js";
import {
  candidateRightsOwnerInventoryWithApplications,
  createBuildingCandidateExportAuthorizer,
} from "../../../backend/services/profile/dist/src/index.js";

const fieldKey = "authorization.us_authorized";
const encryptionKeyArn =
  "arn:aws:kms:us-east-1:111111111111:key/11111111-1111-4111-8111-111111111111";
const fingerprintKeyArn =
  "arn:aws:kms:us-east-1:111111111111:key/22222222-2222-4222-8222-222222222222";
const key = () => `synthetic-restricted-restore-${randomUUID()}`;

/** Offline test authority shared only across this process's generated source/restore fixture. */
export function createSyntheticPacketProtection() {
  const aesKey = randomBytes(32);
  const macKey = randomBytes(32);
  const metrics = { encryptions: 0 };
  const options = {
    fingerprintKeyArn,
    enabled: () => true,
    cipher: {
      async encrypt(scope, bytes) {
        metrics.encryptions++;
        const iv = randomBytes(12);
        const aes = createCipheriv("aes-256-gcm", aesKey, iv);
        aes.setAAD(Buffer.from(canonicalJson(scope)));
        return {
          schemaVersion: 1,
          encryptionKeyArn,
          encryptedDataKey: randomBytes(40),
          iv,
          ciphertext: Buffer.concat([aes.update(bytes), aes.final()]),
          authenticationTag: aes.getAuthTag(),
        };
      },
      async decrypt(scope, envelope) {
        assert.equal(envelope.encryptionKeyArn, encryptionKeyArn);
        const aes = createDecipheriv("aes-256-gcm", aesKey, envelope.iv);
        aes.setAAD(Buffer.from(canonicalJson(scope)));
        aes.setAuthTag(Buffer.from(envelope.authenticationTag));
        return Buffer.concat([aes.update(envelope.ciphertext), aes.final()]);
      },
      async fingerprint(input) {
        return createHmac("sha256", macKey).update(canonicalJson(input)).digest("hex");
      },
    },
  };
  return {
    options,
    metrics,
    destroy() {
      aesKey.fill(0);
      macKey.fill(0);
    },
  };
}

function store(sql, protection, exportEnabled = false) {
  return new PostgresApplicationStore(sql, undefined, {
    definitions: defaultFieldDefinitions(),
    restrictedPackets: protection.options,
    ...(exportEnabled
      ? {
          authorizeRestrictedPacketExport: createBuildingCandidateExportAuthorizer({
            enabled: () => true,
            policy: {
              version: "synthetic-restricted-restore-v1",
              accountablePolicySha256: "a".repeat(64),
              exportArtifactLifetimeSeconds: 3600,
              downloadGrantLifetimeSeconds: 300,
              backupRetentionDays: 35,
              recentAuthenticationMaxAgeSeconds: 300,
              ownerInventory: candidateRightsOwnerInventoryWithApplications,
              subprocessorInventory: [],
            },
          }),
        }
      : {}),
  });
}

async function assertMetadataRole(sql, create = false) {
  if (create)
    await sql.unsafe(
      "CREATE ROLE generated_packet_metadata NOLOGIN; GRANT USAGE ON SCHEMA applications TO generated_packet_metadata; GRANT SELECT ON applications.packets TO generated_packet_metadata",
    );
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE generated_packet_metadata");
    const rows =
      await tx`SELECT fields FROM applications.packets WHERE restricted_value_id IS NOT NULL`;
    assert.ok(rows.length > 0);
    for (const row of rows)
      assert.equal(row.fields.find((field) => field.fieldKey === fieldKey).value, null);
  });
  for (const relation of ["packet_values", "packet_read_audit"]) {
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE generated_packet_metadata");
        await tx.unsafe(`SELECT * FROM applications_restricted.${relation}`);
      }),
      { code: "42501" },
    );
  }
}

export async function seedRestrictedPackets(sql, protection) {
  const writer = store(sql, protection);
  const fixtures = [];
  for (const chosen of [[true, false], [true]]) {
    const ownerUserId = randomUUID();
    await sql`INSERT INTO identity.users (id) VALUES (${ownerUserId})`;
    const created = await writer.createApplication({
      ownerUserId,
      canonicalJobId: randomUUID(),
      idempotencyKey: key(),
    });
    let revision = created.view.application.revision;
    const commands = [];
    for (const value of chosen) {
      const command = {
        ownerUserId,
        applicationId: created.view.application.id,
        expectedRevision: revision,
        idempotencyKey: key(),
        packet: {
          jobRevision: "a".repeat(64),
          form: null,
          artifactHashes: {},
          fields: [
            {
              fieldKey,
              value,
              origin: "user_entered",
              sourceFactIds: [],
              sourceConfirmed: true,
              confidence: 1,
            },
          ],
        },
      };
      const result = await writer.createPacket(command);
      revision = result.view.application.revision;
      commands.push(command);
    }
    const original = await writer.getApplication(ownerUserId, created.view.application.id);
    const result = await writer.readCurrentPacketValues({
      ownerUserId,
      applicationId: original.application.id,
      expectedRevision: original.application.revision,
      packetId: original.currentPacket.id,
      packetHash: original.currentPacket.packetHash,
    });
    assert.equal(result.values.get(fieldKey), chosen.at(-1));
    result.values.clear();
    fixtures.push({ ownerUserId, commands, original, chosen });
  }
  await assertMetadataRole(sql, true);
  return fixtures;
}

export async function exerciseRestoredRestrictedPackets(sql, protection, fixtures) {
  const reader = store(sql, protection, true);
  await assertMetadataRole(sql);
  for (const fixture of fixtures) {
    assert.deepEqual(
      await reader.getApplication(fixture.ownerUserId, fixture.original.application.id),
      fixture.original,
    );
    const encryptedBefore = protection.metrics.encryptions;
    for (const command of fixture.commands)
      assert.equal((await reader.createPacket(command)).replayed, true);
    assert.equal(protection.metrics.encryptions, encryptedBefore);
    const exportId = randomUUID();
    const operationId = randomUUID();
    await sql`INSERT INTO platform.operations (id,user_id,kind,state) VALUES (${operationId},${fixture.ownerUserId},'candidate_data_export','running')`;
    await sql`INSERT INTO profile.candidate_data_exports (id,user_id,operation_id,format,policy_version,state) VALUES (${exportId},${fixture.ownerUserId},${operationId},'candidate-data-export-v1','synthetic-restricted-restore-v1','building')`;
    const [exported] =
      await sql`SELECT applications.export_candidate_data(${fixture.ownerUserId}::uuid) AS data`;
    const values = [];
    for (const reference of exported.data.restrictedPacketReferences.packets) {
      const result = await reader.readExportPacketValues({
        ownerUserId: fixture.ownerUserId,
        exportId,
        operationId,
        policyVersion: "synthetic-restricted-restore-v1",
        applicationId: reference.applicationId,
        packetId: reference.packetId,
        packetHash: reference.packetHash,
      });
      values.push(result.values.get(fieldKey));
      result.values.clear();
    }
    assert.deepEqual(values, fixture.chosen);
    assert.equal(JSON.stringify(exported.data.applications).includes("protectedValue"), false);
    const receipts =
      await sql`SELECT request_hash_scheme,request_key_arn FROM applications.command_receipts WHERE owner_user_id=${fixture.ownerUserId} AND operation='create_packet'`;
    assert.equal(receipts.length, fixture.commands.length);
    for (const receipt of receipts) {
      assert.equal(receipt.request_hash_scheme, "kms-hmac-sha256.v1");
      assert.equal(receipt.request_key_arn, fingerprintKeyArn);
    }
  }
  const doomed = fixtures[0];
  const survivor = fixtures[1];
  await assert.rejects(
    sql`DELETE FROM applications_restricted.packet_values WHERE owner_user_id=${doomed.ownerUserId}`,
    { code: "55000" },
  );
  const requestId = randomUUID();
  const operationId = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 35 * 86400000);
  await sql`INSERT INTO platform.operations (id,user_id,kind,state) VALUES (${operationId},${doomed.ownerUserId},'account_deletion','queued')`;
  await sql`INSERT INTO profile.account_deletion_requests (id,user_id,operation_id,policy_version,state,version,requested_at,updated_at,confirmed_at,backup_expires_at) VALUES (${requestId},${doomed.ownerUserId},${operationId},'synthetic-restricted-delete-v1','quarantined',2,${now},${now},${now},${expires})`;
  await sql`INSERT INTO privacy.account_deletion_ledger (request_id,subject_digest,policy_version,policy_sha256,state,owner_inventory,subprocessor_inventory,confirmed_at,backup_expires_at,updated_at) VALUES (${requestId},${"1".repeat(64)},'synthetic-restricted-delete-v1',${"2".repeat(64)},'quarantined',${sql.json({ applications: "pending" })},${sql.json({})},${now},${expires},${now})`;
  await sql`SELECT applications.delete_candidate_data(${doomed.ownerUserId}::uuid,${requestId}::uuid)`;
  for (const relation of ["packet_values", "packet_read_audit"]) {
    assert.equal(
      (
        await sql.unsafe(
          `SELECT id FROM applications_restricted.${relation} WHERE owner_user_id=$1`,
          [doomed.ownerUserId],
        )
      ).length,
      0,
    );
    assert.ok(
      (
        await sql.unsafe(
          `SELECT id FROM applications_restricted.${relation} WHERE owner_user_id=$1`,
          [survivor.ownerUserId],
        )
      ).length > 0,
    );
  }
  assert.deepEqual(
    await reader.getApplication(survivor.ownerUserId, survivor.original.application.id),
    survivor.original,
  );
  return {
    restrictedPacketSnapshotsRestored: 3,
    restrictedPacketOriginalValuesVerified: 3,
    restrictedPacketKeyedReplaysVerified: 3,
    restrictedMetadataRolePrivateReadsRejected: 4,
    restrictedPacketPrivacyDeletionVerified: true,
    restrictedPacketForeignOwnerPreserved: true,
  };
}
