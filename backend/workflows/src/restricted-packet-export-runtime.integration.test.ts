import { execFile } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { restrictedPacketWriterFromEnvironment } from "@ai-job-apply/applications-service/restricted-packet-runtime";
import {
  type CandidateRightsPolicy,
  candidateRightsOwnerInventoryWithApplications,
} from "@ai-job-apply/profile-service";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNativeRestrictedPacketExportReader } from "./restricted-packet-export-runtime.js";

const requested = process.env.RESTRICTED_PACKET_RUNTIME_INTEGRATION === "1";
const url = process.env.RESTRICTED_PACKET_RUNTIME_TEST_DATABASE_URL ?? "postgres://invalid";
if (requested) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/restricted_packet_runtime_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("RestrictedPacketRuntimeIntegrationTargetRejected");
}
const execute = promisify(execFile);
const policy: CandidateRightsPolicy = {
  version: "synthetic-packet-runtime-v1",
  accountablePolicySha256: "a".repeat(64),
  exportArtifactLifetimeSeconds: 3600,
  downloadGrantLifetimeSeconds: 300,
  backupRetentionDays: 35,
  recentAuthenticationMaxAgeSeconds: 300,
  ownerInventory: candidateRightsOwnerInventoryWithApplications,
  subprocessorInventory: [],
};
const encryptionKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000001";
const fingerprintKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000002";
const nextEncryptionKeyArn = encryptionKeyArn.replace(/1$/u, "3");
const nextFingerprintKeyArn = fingerprintKeyArn.replace(/2$/u, "4");
const configuration = () => ({
  RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
  RESTRICTED_PACKET_EXPORT_ENABLED: "true",
  RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: encryptionKeyArn,
  RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: fingerprintKeyArn,
});

describe.skipIf(!requested)(
  "native restricted export composition through actual Profile/Applications persistence",
  () => {
    const sql = createApplicationsDatabase(url, { maxConnections: 2 });
    const encryptionKey = randomBytes(32);
    const macKey = randomBytes(32);
    const commands: unknown[] = [];
    let kmsSpy: ReturnType<typeof vi.spyOn>;
    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of ["profile", "applications"])
        await execute(
          process.execPath,
          [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
          { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url } },
        );
      // Only the KMS boundary is offline; owning authorization, ciphertext and audit use real SQL.
      const send = async (command: unknown) => {
        commands.push(command);
        if (command instanceof GenerateDataKeyCommand) {
          expect([encryptionKeyArn, nextEncryptionKeyArn]).toContain(command.input.KeyId);
          return {
            KeyId: command.input.KeyId,
            Plaintext: Buffer.from(encryptionKey),
            CiphertextBlob: Buffer.alloc(40, 1),
          };
        }
        if (command instanceof GenerateMacCommand) {
          expect([fingerprintKeyArn, nextFingerprintKeyArn]).toContain(command.input.KeyId);
          return {
            KeyId: command.input.KeyId,
            MacAlgorithm: "HMAC_SHA_256",
            Mac: createHmac("sha256", macKey)
              .update(command.input.KeyId as string)
              .update(command.input.Message as Uint8Array)
              .digest(),
          };
        }
        if (command instanceof DecryptCommand) {
          expect([encryptionKeyArn, nextEncryptionKeyArn]).toContain(command.input.KeyId);
          expect(command.input.EncryptionContext?.purpose).toBe("restricted-application-packet.v1");
          return {
            KeyId: command.input.KeyId,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            Plaintext: Buffer.from(encryptionKey),
          };
        }
        throw Error("UnexpectedSyntheticPacketKmsCommand");
      };
      kmsSpy = vi
        .spyOn(KMSClient.prototype, "send")
        .mockImplementation(send as typeof KMSClient.prototype.send);
    }, 60_000);
    afterAll(async () => {
      kmsSpy?.mockRestore();
      encryptionKey.fill(0);
      macKey.fill(0);
      commands.length = 0;
      await sql.end({ timeout: 5 });
    });

    async function fixture() {
      const env = configuration();
      const protection = restrictedPacketWriterFromEnvironment(env);
      if (!protection) throw Error("MissingSyntheticPacketWriter");
      const store = new PostgresApplicationStore(sql, undefined, {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: protection,
      });
      const owner = uuidv7();
      await sql`INSERT INTO identity.users (id) VALUES (${owner}::uuid)`;
      const created = await store.createApplication({
        ownerUserId: owner,
        canonicalJobId: uuidv7(),
        idempotencyKey: uuidv7(),
      });
      const packet = {
        jobRevision: "a".repeat(64),
        form: null,
        artifactHashes: {},
        fields: [
          {
            fieldKey: "authorization.us_authorized",
            value: false,
            origin: "user_entered" as const,
            sourceFactIds: [],
            sourceConfirmed: true,
            confidence: 1,
          },
        ],
      };
      const originalCommand = {
        ownerUserId: owner,
        applicationId: created.view.application.id,
        expectedRevision: 1,
        idempotencyKey: uuidv7(),
        packet,
      };
      const first = await store.createPacket(originalCommand);
      await store.createPacket({
        ownerUserId: owner,
        applicationId: created.view.application.id,
        expectedRevision: first.view.application.revision,
        idempotencyKey: uuidv7(),
        packet: { ...packet, fields: packet.fields.map((field) => ({ ...field, value: true })) },
      });
      const exportId = uuidv7();
      const operationId = uuidv7();
      await sql`INSERT INTO platform.operations (id, user_id, kind, state) VALUES (${operationId}, ${owner}, 'candidate_data_export', 'running')`;
      await sql`INSERT INTO profile.candidate_data_exports (id, user_id, operation_id, format, policy_version, state)
      VALUES (${exportId}, ${owner}, ${operationId}, 'candidate-data-export-v1', ${policy.version}, 'building')`;
      const original = first.view.currentPacket;
      if (!original) throw Error("MissingSyntheticOriginalPacket");
      const command = {
        ownerUserId: owner,
        exportId,
        operationId,
        policyVersion: policy.version,
        applicationId: created.view.application.id,
        packetId: original.id,
        packetHash: original.packetHash,
      };
      return { env, command, originalCommand };
    }

    it("reads the exact original chosen value after a later packet, with decrypt-only KMS use", async () => {
      const f = await fixture();
      const runtime = createNativeRestrictedPacketExportReader(url, policy, f.env);
      if (!runtime) throw Error("MissingSyntheticExportRuntime");
      try {
        expect(Object.keys(runtime.reader)).toEqual(["readExportPacketValues"]);
        const prior = commands.length;
        const result = await runtime.reader.readExportPacketValues(f.command);
        expect(result.packetId).toBe(f.command.packetId);
        expect(result.values).toEqual(new Map([["authorization.us_authorized", false]]));
        Map.prototype.clear.call(result.values);
        expect(commands.slice(prior)).toHaveLength(1);
        expect(commands[prior]).toBeInstanceOf(DecryptCommand);
        const audit = await sql`SELECT purpose, stage FROM applications_restricted.packet_read_audit
        WHERE owner_user_id = ${f.command.ownerUserId} ORDER BY stage`;
        expect(audit.map((row) => ({ purpose: row.purpose, stage: row.stage }))).toEqual([
          { purpose: "candidate_export", stage: "admitted" },
          { purpose: "candidate_export", stage: "validated" },
        ]);
      } finally {
        await runtime.close();
      }
    });
    it("replays original receipts and exports original values after explicit key rotation", async () => {
      const f = await fixture();
      const rotated = {
        ...f.env,
        RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: nextEncryptionKeyArn,
        RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: nextFingerprintKeyArn,
        RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: JSON.stringify([
          { encryptionKeyArn, fingerprintKeyArn },
        ]),
      };
      const protection = restrictedPacketWriterFromEnvironment(rotated);
      if (!protection) throw Error("MissingSyntheticRotatedProtection");
      const store = new PostgresApplicationStore(sql, undefined, {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: protection,
      });
      const receiptsBefore =
        await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id = ${f.command.ownerUserId} ORDER BY idempotency_key`;
      const prior = commands.length;
      const replay = await store.createPacket(f.originalCommand);
      expect(replay.replayed).toBe(true);
      expect(commands.slice(prior)).toHaveLength(1);
      const mac = commands[prior];
      expect(mac).toBeInstanceOf(GenerateMacCommand);
      expect((mac as GenerateMacCommand).input.KeyId).toBe(fingerprintKeyArn);
      expect(
        await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id = ${f.command.ownerUserId} ORDER BY idempotency_key`,
      ).toEqual(receiptsBefore);
      const runtime = createNativeRestrictedPacketExportReader(url, policy, rotated);
      if (!runtime) throw Error("MissingSyntheticRotatedExport");
      try {
        const result = await runtime.reader.readExportPacketValues(f.command);
        expect(result.values).toEqual(new Map([["authorization.us_authorized", false]]));
        Map.prototype.clear.call(result.values);
        expect((commands.at(-1) as DecryptCommand).input.KeyId).toBe(encryptionKeyArn);
      } finally {
        await runtime.close();
      }
      const written = await store.createPacket({
        ...f.originalCommand,
        expectedRevision: replay.view.application.revision,
        idempotencyKey: uuidv7(),
      });
      const [receipt] =
        await sql`SELECT request_key_arn FROM applications.command_receipts WHERE owner_user_id = ${f.command.ownerUserId} AND idempotency_key <> ${f.originalCommand.idempotencyKey} ORDER BY created_at DESC LIMIT 1`;
      expect(receipt?.request_key_arn).toBe(nextFingerprintKeyArn);
      const binding = written.view.currentPacket?.restrictedValues;
      if (!binding) throw Error("MissingSyntheticRotatedBinding");
      const [value] =
        await sql`SELECT encryption_key_arn FROM applications_restricted.packet_values WHERE id = ${binding.id}`;
      expect(value?.encryption_key_arn).toBe(nextEncryptionKeyArn);
      const removed = restrictedPacketWriterFromEnvironment({
        ...rotated,
        RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: "[]",
      });
      if (!removed) throw Error("MissingSyntheticRemovedHistory");
      const closedStore = new PostgresApplicationStore(sql, undefined, {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: removed,
      });
      const calls = commands.length;
      await expect(closedStore.createPacket(f.originalCommand)).rejects.toThrow();
      expect(commands.length).toBe(calls);
      expect(
        await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id = ${f.command.ownerUserId} AND idempotency_key = ${f.originalCommand.idempotencyKey}`,
      ).toEqual(
        receiptsBefore.filter((row) => row.idempotency_key === f.originalCommand.idempotencyKey),
      );
    });
    it("refuses foreign authority and withdrawn export configuration before KMS", async () => {
      const f = await fixture();
      const runtime = createNativeRestrictedPacketExportReader(url, policy, f.env);
      if (!runtime) throw Error("MissingSyntheticExportRuntime");
      try {
        const prior = commands.length;
        await expect(
          runtime.reader.readExportPacketValues({ ...f.command, exportId: uuidv7() }),
        ).rejects.toThrow();
        f.env.RESTRICTED_PACKET_EXPORT_ENABLED = "false";
        await expect(runtime.reader.readExportPacketValues(f.command)).rejects.toThrow();
        expect(commands.length).toBe(prior);
        const [audit] =
          await sql`SELECT count(*)::int AS count FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${f.command.ownerUserId}`;
        expect(audit?.count).toBe(0);
      } finally {
        await runtime.close();
      }
    });
  },
);
