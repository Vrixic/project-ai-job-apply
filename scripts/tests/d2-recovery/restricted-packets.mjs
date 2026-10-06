import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createRestrictedPacketKmsCipher } from "../../../backend/services/applications/dist/src/restricted-packet-runtime.js";

const dependency = createRequire(
  new URL("../../../backend/services/applications/package.json", import.meta.url),
);
const { DecryptCommand, GenerateDataKeyCommand, GenerateMacCommand } = await import(
  pathToFileURL(dependency.resolve("@aws-sdk/client-kms")).href
);

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
const nextEncryptionKeyArn = encryptionKeyArn.replaceAll(
  "11111111-1111-4111-8111-111111111111",
  "33333333-3333-4333-8333-333333333333",
);
const nextFingerprintKeyArn = fingerprintKeyArn.replaceAll(
  "22222222-2222-4222-8222-222222222222",
  "44444444-4444-4444-8444-444444444444",
);
const key = () => `synthetic-restricted-restore-${randomUUID()}`;

/** Offline test authority shared only across this process's generated source/restore fixture. */
export function createSyntheticPacketProtection() {
  assert.equal(process.env.NODE_ENV, "test");
  const keys = new Map([
    [encryptionKeyArn, randomBytes(32)],
    [fingerprintKeyArn, randomBytes(32)],
    [nextEncryptionKeyArn, randomBytes(32)],
    [nextFingerprintKeyArn, randomBytes(32)],
  ]);
  const wrapped = new Map();
  const metrics = { encryptions: 0, decryptKeys: [], macKeys: [] };
  const testClient = {
    async send(command) {
      const arn = command.input.KeyId;
      const material = keys.get(arn);
      assert.ok(material);
      if (command instanceof GenerateDataKeyCommand) {
        assert.ok([encryptionKeyArn, nextEncryptionKeyArn].includes(arn));
        assert.equal(command.input.KeySpec, "AES_256");
        const blob = randomBytes(40);
        wrapped.set(blob.toString("hex"), arn);
        metrics.encryptions++;
        return { KeyId: arn, Plaintext: Buffer.from(material), CiphertextBlob: blob };
      }
      if (command instanceof DecryptCommand) {
        assert.equal(wrapped.get(Buffer.from(command.input.CiphertextBlob).toString("hex")), arn);
        assert.equal(command.input.EncryptionAlgorithm, "SYMMETRIC_DEFAULT");
        assert.equal(command.input.EncryptionContext.purpose, "restricted-application-packet.v1");
        metrics.decryptKeys.push(arn);
        return {
          KeyId: arn,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          Plaintext: Buffer.from(material),
        };
      }
      assert.ok(command instanceof GenerateMacCommand);
      assert.ok([fingerprintKeyArn, nextFingerprintKeyArn].includes(arn));
      assert.equal(command.input.MacAlgorithm, "HMAC_SHA_256");
      metrics.macKeys.push(arn);
      return {
        KeyId: arn,
        MacAlgorithm: "HMAC_SHA_256",
        Mac: createHmac("sha256", material).update(command.input.Message).digest(),
      };
    },
  };
  const optionsFor = (rotated, admitHistory = true) => {
    const pair = rotated
      ? { encryptionKeyArn: nextEncryptionKeyArn, fingerprintKeyArn: nextFingerprintKeyArn }
      : { encryptionKeyArn, fingerprintKeyArn };
    const historicalKeys = rotated && admitHistory ? [{ encryptionKeyArn, fingerprintKeyArn }] : [];
    return {
      fingerprintKeyArn: pair.fingerprintKeyArn,
      historicalFingerprintKeyArns: historicalKeys.map((pair) => pair.fingerprintKeyArn),
      enabled: () => true,
      // Mutable test facade permits call spies; the actual production adapter stays frozen.
      cipher: {
        ...createRestrictedPacketKmsCipher({
          ...pair,
          historicalKeys,
          enabled: () => true,
          testClient,
        }),
      },
    };
  };
  return {
    options: optionsFor(false),
    restoreOptions: optionsFor(true),
    withdrawnOptions: optionsFor(true, false),
    metrics,
    destroy() {
      for (const material of keys.values()) material.fill(0);
      keys.clear();
      wrapped.clear();
      metrics.decryptKeys.length = 0;
      metrics.macKeys.length = 0;
    },
  };
}

function store(sql, protection, exportEnabled = false) {
  return new PostgresApplicationStore(sql, undefined, {
    definitions: defaultFieldDefinitions(),
    restrictedPackets: exportEnabled ? protection.restoreOptions : protection.options,
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
  const rotatedWriter = new PostgresApplicationStore(sql, undefined, {
    definitions: defaultFieldDefinitions(),
    restrictedPackets: protection.restoreOptions,
  });
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
    const fingerprintKeys = [];
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
      const rotated = commands.length > 0;
      const result = await (rotated ? rotatedWriter : writer).createPacket(command);
      fingerprintKeys.push(rotated ? nextFingerprintKeyArn : fingerprintKeyArn);
      revision = result.view.application.revision;
      commands.push(command);
    }
    const original = await writer.getApplication(ownerUserId, created.view.application.id);
    const result = await rotatedWriter.readCurrentPacketValues({
      ownerUserId,
      applicationId: original.application.id,
      expectedRevision: original.application.revision,
      packetId: original.currentPacket.id,
      packetHash: original.currentPacket.packetHash,
    });
    assert.equal(result.values.get(fieldKey), chosen.at(-1));
    result.values.clear();
    fixtures.push({ ownerUserId, commands, fingerprintKeys, original, chosen });
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
    const originalReceipts =
      await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${fixture.ownerUserId} ORDER BY idempotency_key`;
    for (const [index, command] of fixture.commands.entries()) {
      assert.equal((await reader.createPacket(command)).replayed, true);
      assert.equal(protection.metrics.macKeys.at(-1), fixture.fingerprintKeys[index]);
    }
    assert.deepEqual(
      await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${fixture.ownerUserId} ORDER BY idempotency_key`,
      originalReceipts,
    );
    const unsupported = new PostgresApplicationStore(sql, undefined, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets: protection.withdrawnOptions,
    });
    const before = protection.metrics.macKeys.length;
    await assert.rejects(unsupported.createPacket(fixture.commands[0]), {
      name: "RestrictedPacketStoreUnavailableError",
    });
    assert.equal(protection.metrics.macKeys.length, before);
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
      assert.ok(fixture.fingerprintKeys.includes(receipt.request_key_arn));
    }
  }
  assert.deepEqual(
    [...new Set(protection.metrics.decryptKeys)].sort(),
    [encryptionKeyArn, nextEncryptionKeyArn].sort(),
  );
  assert.deepEqual(
    [...new Set(protection.metrics.macKeys)].sort(),
    [fingerprintKeyArn, nextFingerprintKeyArn].sort(),
  );
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
    restrictedPacketKeyEpochsRestored: 2,
    restrictedPacketOriginalKeyReceiptsUnchanged: true,
    restrictedPacketUnknownKeyReplayRejectedBeforeKms: fixtures.length,
    restrictedPacketOriginalValuesVerified: 3,
    restrictedPacketKeyedReplaysVerified: 3,
    restrictedMetadataRolePrivateReadsRejected: 4,
    restrictedPacketPrivacyDeletionVerified: true,
    restrictedPacketForeignOwnerPreserved: true,
  };
}
