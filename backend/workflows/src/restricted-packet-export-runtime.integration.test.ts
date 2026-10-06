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
    let barrier: ((command: unknown) => Promise<void>) | undefined;
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
        await barrier?.(command);
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
    const races = ["mac", "data-key"].flatMap((phase) =>
      ["old", "new"].flatMap((winner) =>
        ["equivalent", "changed", "unknown"].map((kind) => ({ phase, winner, kind })),
      ),
    );
    it.each(races)(
      "preserves original authority during $phase, $winner winner, $kind request",
      async ({ phase, winner: epoch, kind }) => {
        const f = await fixture();
        const winnerOld = epoch === "old";
        const oldProtection = restrictedPacketWriterFromEnvironment({
          ...f.env,
          RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: JSON.stringify(
            kind === "unknown" && !winnerOld
              ? []
              : [
                  {
                    encryptionKeyArn: nextEncryptionKeyArn,
                    fingerprintKeyArn: nextFingerprintKeyArn,
                  },
                ],
          ),
        });
        const nextProtection = restrictedPacketWriterFromEnvironment({
          ...f.env,
          RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: nextEncryptionKeyArn,
          RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: nextFingerprintKeyArn,
          RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: JSON.stringify(
            kind === "unknown" && winnerOld ? [] : [{ encryptionKeyArn, fingerprintKeyArn }],
          ),
        });
        if (!oldProtection || !nextProtection) throw Error("MissingSyntheticRacingProtection");
        const oldStore = new PostgresApplicationStore(sql, undefined, {
          definitions: defaultFieldDefinitions(),
          restrictedPackets: oldProtection,
        });
        const nextStore = new PostgresApplicationStore(sql, undefined, {
          definitions: defaultFieldDefinitions(),
          restrictedPackets: nextProtection,
        });
        const winnerStore = winnerOld ? oldStore : nextStore;
        const loserStore = winnerOld ? nextStore : oldStore;
        const heldMac = winnerOld ? nextFingerprintKeyArn : fingerprintKeyArn;
        const heldEncryption = winnerOld ? nextEncryptionKeyArn : encryptionKeyArn;
        const winnerMac = winnerOld ? fingerprintKeyArn : nextFingerprintKeyArn;
        const current = await oldStore.getApplication(
          f.command.ownerUserId,
          f.command.applicationId,
        );
        const command = {
          ...f.originalCommand,
          expectedRevision: current.application.revision,
          idempotencyKey: uuidv7(),
        };
        const losingCommand =
          kind === "changed"
            ? {
                ...command,
                packet: {
                  ...command.packet,
                  fields: command.packet.fields.map((field) => ({ ...field, value: true })),
                },
              }
            : command;
        let arrived: () => void = () => {};
        let release: () => void = () => {};
        const reached = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        const resume = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held = false;
        let winnerCommitted = false;
        let unlockedChecks = 0;
        barrier = async (kms) => {
          const matches =
            phase === "mac"
              ? kms instanceof GenerateMacCommand && kms.input.KeyId === heldMac
              : kms instanceof GenerateDataKeyCommand && kms.input.KeyId === heldEncryption;
          if (!held && matches) {
            held = true;
            arrived();
            await resume;
          }
          if (
            winnerCommitted &&
            kms instanceof GenerateMacCommand &&
            kms.input.KeyId === winnerMac
          ) {
            // The losing transaction must already have rolled back before original-key KMS.
            await sql.begin(async (tx) => {
              await tx`SELECT id FROM applications.applications WHERE id=${command.applicationId} FOR UPDATE NOWAIT`;
            });
            unlockedChecks++;
          }
        };
        const pending = loserStore.createPacket(losingCommand).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        try {
          await reached;
          const winner = await winnerStore.createPacket(command);
          winnerCommitted = true;
          expect(winner.replayed).toBe(false);
          const before =
            await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${command.ownerUserId} AND idempotency_key=${command.idempotencyKey}`;
          const resumedAt = commands.length;
          release();
          const loser = await pending;
          if (kind === "equivalent") {
            if ("error" in loser) throw loser.error;
            expect(loser.value.replayed).toBe(true);
            expect(loser.value.view).toEqual(winner.view);
          } else {
            expect("error" in loser).toBe(true);
            if (!("error" in loser)) throw Error("MissingSyntheticRaceFailure");
            expect(loser.error.name).toBe(
              kind === "changed"
                ? "ApplicationIdempotencyConflictError"
                : "RestrictedPacketStoreUnavailableError",
            );
          }
          expect(unlockedChecks).toBe(kind === "unknown" ? 0 : 1);
          const resumed = commands.slice(resumedAt);
          expect(
            resumed
              .filter((kms) => kms instanceof GenerateMacCommand)
              .map((kms) => (kms as GenerateMacCommand).input.KeyId),
          ).toEqual(kind === "unknown" ? [] : [winnerMac]);
          expect(resumed.some((kms) => kms instanceof GenerateDataKeyCommand)).toBe(false);
          expect(
            await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${command.ownerUserId} AND idempotency_key=${command.idempotencyKey}`,
          ).toEqual(before);
          const [packets] =
            await sql`SELECT count(*)::int AS count FROM applications.packets WHERE application_id=${command.applicationId}`;
          expect(packets?.count).toBe(3);
          const [values] =
            await sql`SELECT count(*)::int AS count FROM applications_restricted.packet_values WHERE application_id=${command.applicationId}`;
          expect(values?.count).toBe(3);
        } finally {
          release();
          barrier = undefined;
          await pending;
        }
      },
    );
    const preparationRaces = ["queue-mac", "queue-data-key", "replay-mac"].flatMap((phase) =>
      ["old", "new"].flatMap((winner) =>
        ["equivalent", "changed", "unknown"].map((kind) => ({ phase, winner, kind })),
      ),
    );
    it.each(preparationRaces)(
      "preserves preparation authority during $phase, $winner winner, $kind request",
      async ({ phase, winner: epoch, kind }) => {
        const f = await fixture();
        const winnerOld = epoch === "old";
        const oldProtection = restrictedPacketWriterFromEnvironment({
          ...f.env,
          RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: JSON.stringify(
            kind === "unknown" && !winnerOld
              ? []
              : [
                  {
                    encryptionKeyArn: nextEncryptionKeyArn,
                    fingerprintKeyArn: nextFingerprintKeyArn,
                  },
                ],
          ),
        });
        const nextProtection = restrictedPacketWriterFromEnvironment({
          ...f.env,
          RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: nextEncryptionKeyArn,
          RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: nextFingerprintKeyArn,
          RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: JSON.stringify(
            kind === "unknown" && winnerOld ? [] : [{ encryptionKeyArn, fingerprintKeyArn }],
          ),
        });
        if (!oldProtection || !nextProtection)
          throw Error("MissingSyntheticPreparationRaceProtection");
        const oldStore = new PostgresApplicationStore(sql, undefined, {
          definitions: defaultFieldDefinitions(),
          restrictedPackets: oldProtection,
        });
        const nextStore = new PostgresApplicationStore(sql, undefined, {
          definitions: defaultFieldDefinitions(),
          restrictedPackets: nextProtection,
        });
        const winnerStore = winnerOld ? oldStore : nextStore;
        const loserStore = winnerOld ? nextStore : oldStore;
        const heldMac = winnerOld ? nextFingerprintKeyArn : fingerprintKeyArn;
        const heldEncryption = winnerOld ? nextEncryptionKeyArn : encryptionKeyArn;
        const winnerMac = winnerOld ? fingerprintKeyArn : nextFingerprintKeyArn;
        const current = await oldStore.getApplication(
          f.command.ownerUserId,
          f.command.applicationId,
        );
        const command = {
          ...f.originalCommand,
          idempotencyKey: uuidv7(),
          context: { jobContextHash: "a".repeat(64), confirmedFactsHash: "b".repeat(64) },
          request: {
            expectedRevision: current.application.revision,
            coverLetter: {
              disclosure: {
                noticeVersion: "openai-cover-letter.v1" as const,
                acknowledged: true as const,
              },
            },
          },
        };
        const losingCommand =
          kind === "changed"
            ? {
                ...command,
                request: {
                  ...command.request,
                  expectedRevision: command.request.expectedRevision + 1,
                },
              }
            : command;
        let arrived: () => void = () => {};
        let release: () => void = () => {};
        const reached = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        const resume = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held = false;
        let winnerCommitted = false;
        let unlockedChecks = 0;
        barrier = async (kms) => {
          const matches =
            phase === "queue-data-key"
              ? kms instanceof GenerateDataKeyCommand && kms.input.KeyId === heldEncryption
              : kms instanceof GenerateMacCommand && kms.input.KeyId === heldMac;
          if (!held && matches) {
            held = true;
            arrived();
            await resume;
          }
          if (
            winnerCommitted &&
            kms instanceof GenerateMacCommand &&
            kms.input.KeyId === winnerMac
          ) {
            await sql.begin(async (tx) => {
              await tx`SELECT id FROM applications.applications WHERE id=${command.applicationId} FOR UPDATE NOWAIT`;
            });
            unlockedChecks++;
          }
        };
        const losingWork = async () => {
          if (phase !== "replay-mac") return loserStore.queuePreparation(losingCommand);
          const preparation = await loserStore.replayPreparation(losingCommand);
          if (!preparation) throw Error("MissingSyntheticRacingPreparation");
          return { replayed: true, preparation };
        };
        const pending = losingWork().then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        try {
          await reached;
          const winner = await winnerStore.queuePreparation(command);
          winnerCommitted = true;
          expect(winner.replayed).toBe(false);
          const before =
            await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${command.ownerUserId} AND idempotency_key=${command.idempotencyKey}`;
          const resumedAt = commands.length;
          release();
          const loser = await pending;
          if (kind === "equivalent") {
            if ("error" in loser) throw loser.error;
            expect(loser.value.replayed).toBe(true);
            expect(loser.value.preparation).toEqual(winner.preparation);
          } else {
            expect("error" in loser).toBe(true);
            if (!("error" in loser)) throw Error("MissingSyntheticPreparationRaceFailure");
            expect(loser.error.name).toBe(
              kind === "changed"
                ? "ApplicationIdempotencyConflictError"
                : "RestrictedPacketStoreUnavailableError",
            );
          }
          expect(unlockedChecks).toBe(kind === "unknown" ? 0 : 1);
          const resumed = commands.slice(resumedAt);
          expect(
            resumed
              .filter((kms) => kms instanceof GenerateMacCommand)
              .map((kms) => (kms as GenerateMacCommand).input.KeyId),
          ).toEqual(kind === "unknown" ? [] : [winnerMac]);
          expect(resumed.some((kms) => kms instanceof GenerateDataKeyCommand)).toBe(false);
          expect(
            await sql`SELECT * FROM applications.command_receipts WHERE owner_user_id=${command.ownerUserId} AND idempotency_key=${command.idempotencyKey}`,
          ).toEqual(before);
          const [counts] =
            await sql`SELECT (SELECT count(*)::int FROM applications.packet_preparations WHERE application_id=${command.applicationId}) AS preparations, (SELECT count(*)::int FROM applications.preparation_outbox WHERE preparation_id=${winner.preparation.id}) AS events, (SELECT count(*)::int FROM applications_restricted.packet_values WHERE application_id=${command.applicationId}) AS values`;
          expect(counts).toEqual({ preparations: 1, events: 1, values: 3 });
        } finally {
          release();
          barrier = undefined;
          await pending;
        }
      },
    );
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
