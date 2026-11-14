import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadApplicationMigrations } from "./application-migrations.js";
import { canonicalHash } from "./canonical.js";
import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";
import { createLegacyReceiptReplay } from "./legacy-receipt-replay.js";
import { transitionLegacyReceipts } from "./legacy-receipt-transition.js";
import { assemblePacket } from "./packet.js";
import type { PreparationRequest } from "./preparation.js";
import { createIntegrationApplicationStore } from "./restricted-packet-integration-support.js";
import { definitions, HASH_A, proposal } from "./test-support.js";

const url = process.env.LEGACY_TRANSITION_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    target.protocol !== "postgres:" ||
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/legacy_transition_fixture" ||
    target.search ||
    target.hash
  )
    throw Error("LegacyTransitionRequiresOwnedLoopbackFixture");
}
const execute = promisify(execFile);
const at = new Date("2026-10-08T12:00:00Z");
const keyArn = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
describe.skipIf(!url)("atomic historical receipt transition", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
  const encrypted = new Map<string, { digest: Uint8Array; context: string }>();
  const cipher = createLegacyReceiptKmsCipher({
    encryptionKeyArn: keyArn,
    enabled: () => true,
    testClient: {
      send: async (command) => {
        if (command instanceof EncryptCommand) {
          const ciphertext = randomBytes(80);
          encrypted.set(ciphertext.toString("hex"), {
            digest: Uint8Array.from(command.input.Plaintext as Uint8Array),
            context: JSON.stringify(command.input.EncryptionContext),
          });
          return {
            KeyId: keyArn,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            CiphertextBlob: ciphertext,
          };
        }
        if (command instanceof DecryptCommand) {
          const value = encrypted.get(
            Buffer.from(command.input.CiphertextBlob as Uint8Array).toString("hex"),
          );
          if (!value || value.context !== JSON.stringify(command.input.EncryptionContext))
            throw Error("SyntheticContextMismatch");
          return {
            KeyId: keyArn,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            Plaintext: Uint8Array.from(value.digest),
          };
        }
        throw Error("UnexpectedSyntheticCommand");
      },
    },
  });
  beforeAll(async () => {
    const [existing] = await sql`SELECT to_regnamespace('applications') AS existing`;
    if (existing?.existing !== null) throw Error("LegacyTransitionFixtureMustBeFresh");
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|comspec|userprofile)$/iu.test(key),
      ),
    );
    await execute(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url } },
    );
  }, 60_000);
  beforeEach(async () => {
    // This exact disposable database was checked empty above; no shared database is admitted.
    await sql.unsafe(`DROP SCHEMA IF EXISTS applications_restricted CASCADE;
      DROP SCHEMA IF EXISTS applications CASCADE;
      CREATE SCHEMA applications;
      CREATE TABLE applications.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now());`);
  });
  afterAll(async () => {
    for (const value of encrypted.values()) value.digest.fill(0);
    encrypted.clear();
    await sql.end();
  });
  async function historical(count = 3, restricted = false) {
    const migrations = await loadApplicationMigrations();
    await sql.begin(async (tx) => {
      for (const migration of migrations.slice(0, count)) {
        await tx.unsafe(migration.sql);
        await tx`INSERT INTO applications.schema_migrations(version,checksum) VALUES (${migration.version},${migration.checksum})`;
      }
    });
    return sql.begin(async (tx) => {
      const sql = tx;
      const owner = uuidv7();
      await sql`INSERT INTO identity.users(id) VALUES (${owner})`;
      const commands = [];
      for (let index = 0; index < 7; index++) {
        const applicationId = uuidv7();
        const packetId = uuidv7();
        const packetInput = {
          jobRevision: HASH_A,
          form: null,
          artifactHashes: {},
          fields: [
            proposal(
              restricted
                ? {
                    fieldKey: "authorization.us_authorized",
                    value: false,
                    origin: "user_entered",
                    sourceFactIds: [],
                  }
                : {},
            ),
          ],
        };
        const packet = assemblePacket(
          {
            ...packetInput,
            id: packetId,
            userId: owner,
            applicationId,
            canonicalJobId: uuidv7(),
            version: 1,
            createdAt: at,
          },
          definitions,
        );
        const command = {
          ownerUserId: owner,
          applicationId,
          expectedRevision: 1,
          idempotencyKey: uuidv7(),
          packet: packetInput,
        };
        await sql`INSERT INTO applications.applications
        (id,owner_user_id,canonical_job_id,status,revision,current_packet_id,created_at,updated_at)
        VALUES (${applicationId},${owner},${packet.canonicalJobId},${index === 0 ? "approved" : "review_required"},
          ${index === 0 ? 3 : 2},${packetId},${at},${at})`;
        await sql`INSERT INTO applications.packets
        (id,application_id,owner_user_id,version,packet_hash,job_revision,fields,created_at)
        VALUES (${packetId},${applicationId},${owner},1,${packet.packetHash},${HASH_A},${sql.json(packet.fields as unknown as postgres.JSONValue)},${at})`;
        if (index === 0)
          await sql`INSERT INTO applications.approvals
          (id,packet_id,application_id,owner_user_id,packet_hash,consent_id,acknowledged_field_keys,approved_at,expires_at)
          VALUES (${uuidv7()},${packetId},${applicationId},${owner},${packet.packetHash},${uuidv7()},
            ${sql.array([])},${at},'2026-10-09T12:00:00Z')`;
        const digest = canonicalHash({
          operation: "create_packet",
          applicationId,
          expectedRevision: 1,
          ...packetInput,
        });
        await sql`INSERT INTO applications.command_receipts
        (owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,created_at)
        VALUES (${owner},${command.idempotencyKey},'create_packet',${digest},${applicationId},2,
          '2026-10-08T12:00:00.123456Z')`;
        commands.push(command);
      }
      const first = commands[0];
      if (!first) throw Error("MissingSyntheticCommand");
      await sql`INSERT INTO applications.command_receipts
      (owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,created_at)
      VALUES (${owner},${uuidv7()},'approve',${HASH_A},${first.applicationId},3,${at})`;
      return { owner, commands, first };
    });
  }
  async function snapshot() {
    const [row] = await sql`SELECT jsonb_build_object(
      'rows',(SELECT jsonb_agg(to_jsonb(r) ORDER BY owner_user_id,idempotency_key) FROM applications.command_receipts r),
      'packets',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM applications.packets r),
      'approvals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM applications.approvals r),
      'ledger',(SELECT jsonb_agg(to_jsonb(r) ORDER BY version) FROM applications.schema_migrations r),
      'restricted',to_regnamespace('applications_restricted'),
      'staging',to_regnamespace('applications_receipt_transition'),
      'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='applications.command_receipts'::regclass),
      'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='applications.command_receipts'::regclass)
    ) AS value`;
    return row?.value;
  }
  it("transfers seven original receipts from the three-migration schema and preserves approved replay", async () => {
    const fixture = await historical();
    const before = await snapshot();
    expect(
      await transitionLegacyReceipts(sql, {
        enabled: () => true,
        cipher,
        expectedAppliedMigrations: 3,
        expectedLegacyReceipts: 7,
      }),
    ).toEqual({
      archivedReceipts: 7,
      appliedMigrations: 12,
    });
    const after = await snapshot();
    expect(after.staging).toBeNull();
    expect(after.approvals).toEqual(before.approvals);
    expect(
      after.packets.map(
        ({
          temporary_materials: _temporary,
          restricted_value_id: _id,
          restricted_metadata_sha256: _m,
          restricted_ciphertext_sha256: _c,
          ...row
        }: Record<string, unknown>) => row,
      ),
    ).toEqual(before.packets);
    expect(after.rows.filter((row: { operation: string }) => row.operation === "approve")).toEqual(
      before.rows
        .filter((row: { operation: string }) => row.operation === "approve")
        .map((row: object) => ({
          ...row,
          request_hash_scheme: "sha256.v1",
          request_key_arn: null,
        })),
    );
    const store = createIntegrationApplicationStore(sql, () => at, {
      definitions,
      legacyReceipts: { enabled: () => true, cipher },
    });
    const replay = await store.createPacket(fixture.first);
    expect(replay.replayed).toBe(true);
    expect(replay.view.approval).not.toBeNull();
    expect(await snapshot()).toEqual(after);
  });
  it.each([
    { expectedAppliedMigrations: 4, expectedLegacyReceipts: 7 },
    { expectedAppliedMigrations: 3, expectedLegacyReceipts: 8 },
    { expectedAppliedMigrations: 3, expectedLegacyReceipts: 0 },
    { expectedAppliedMigrations: Number.NaN, expectedLegacyReceipts: 7 },
  ])("refuses mismatched maintenance inventory before encryption: %j", async (expected) => {
    await historical();
    const before = await snapshot();
    let encryptCalls = 0;
    await expect(
      transitionLegacyReceipts(sql, {
        enabled: () => true,
        ...expected,
        cipher: {
          encrypt: async (...args) => {
            encryptCalls++;
            return cipher.encrypt(...args);
          },
          matches: cipher.matches,
        },
      }),
    ).rejects.toThrow("LegacyReceiptTransitionUnavailable");
    expect(encryptCalls).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back table replacement, all pending migrations and plaintext restrictions together", async () => {
    await historical(3, true);
    const before = await snapshot();
    await expect(transitionLegacyReceipts(sql, { enabled: () => true, cipher })).rejects.toThrow(
      "LegacyReceiptTransitionUnavailable",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("refuses failed encryption before any SQL changes", async () => {
    await historical();
    const before = await snapshot();
    await expect(
      transitionLegacyReceipts(sql, {
        enabled: () => true,
        cipher: {
          encrypt: async () => {
            throw Error("synthetic private failure");
          },
          matches: cipher.matches,
        },
      }),
    ).rejects.toThrow("LegacyReceiptTransitionUnavailable");
    expect(await snapshot()).toEqual(before);
  });
  it("holds no SQL locks during crypto and refuses a changed original inventory", async () => {
    const fixture = await historical();
    let changed = false;
    await expect(
      transitionLegacyReceipts(sql, {
        enabled: () => true,
        cipher: {
          encrypt: async (...args) => {
            if (!changed) {
              await sql.begin(async (tx) => {
                await tx`LOCK TABLE applications.command_receipts IN ACCESS EXCLUSIVE MODE NOWAIT`;
                await tx`INSERT INTO applications.command_receipts
              (owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,created_at)
              VALUES (${fixture.owner},${uuidv7()},'approve',${HASH_A},${fixture.first.applicationId},3,${at})`;
              });
              changed = true;
            }
            return cipher.encrypt(...args);
          },
          matches: cipher.matches,
        },
      }),
    ).rejects.toThrow("LegacyReceiptTransitionUnavailable");
    const after = await snapshot();
    expect(after.ledger).toHaveLength(3);
    expect(after.restricted).toBeNull();
    expect(after.rows).toHaveLength(9);
  });
  it("preserves a queue-preparation receipt from the eight-migration schema under its original context", async () => {
    const fixture = await historical(8);
    const key = uuidv7();
    await sql`INSERT INTO applications.command_receipts
      (owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,created_at)
      VALUES (${fixture.owner},${key},'queue_preparation',${HASH_A},${fixture.first.applicationId},3,${at})`;
    expect(await transitionLegacyReceipts(sql, { enabled: () => true, cipher })).toEqual({
      archivedReceipts: 8,
      appliedMigrations: 7,
    });
    const reader = createLegacyReceiptReplay(sql, { enabled: () => true, cipher });
    const proof = await reader.prepare(
      fixture.owner,
      fixture.first.applicationId,
      key,
      "queue_preparation",
      HASH_A,
    );
    await expect(
      reader.assert(sql, proof, fixture.owner, key, "queue_preparation"),
    ).resolves.toMatchObject({ applicationId: fixture.first.applicationId });
  });
  it("replays original queued preparation through the store without new packets or events", async () => {
    const fixture = await historical(8);
    const original = fixture.commands[1];
    if (!original) throw Error("MissingSyntheticCommand");
    const preparationId = uuidv7();
    const idempotencyKey = uuidv7();
    const request = {
      expectedRevision: 1,
      coverLetter: { disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true } },
    } satisfies PreparationRequest;
    const requestHash = canonicalHash({
      operation: "queue_preparation",
      applicationId: original.applicationId,
      request,
    });
    const [packet] =
      await sql`SELECT current_packet_id FROM applications.applications WHERE id=${original.applicationId}`;
    await sql`INSERT INTO applications.packet_preparations
      (id,application_id,owner_user_id,base_packet_id,expected_revision,job_context_hash,confirmed_facts_hash,
       notice_version,approved_at,expires_at,created_at,updated_at)
      VALUES (${preparationId},${original.applicationId},${fixture.owner},${packet?.current_packet_id},2,
        ${HASH_A},${HASH_A},'bedrock-cover-letter.v1',${at},${new Date(at.getTime() + 900000)},${at},${at})`;
    await sql`INSERT INTO applications.preparation_outbox(id,preparation_id,owner_user_id,payload,created_at)
      VALUES (${uuidv7()},${preparationId},${fixture.owner},${sql.json({ preparationId })},${at})`;
    await sql`INSERT INTO applications.preparation_audit(id,preparation_id,owner_user_id,action,occurred_at)
      VALUES (${uuidv7()},${preparationId},${fixture.owner},'queued',${at})`;
    await sql`INSERT INTO applications.command_receipts
      (owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at)
      VALUES (${fixture.owner},${idempotencyKey},'queue_preparation',${requestHash},${original.applicationId},2,
        'preparation_queued',${preparationId},${at})`;
    const preparationSnapshot = async () => {
      const [row] = await sql`SELECT jsonb_build_object(
        'preparations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM applications.packet_preparations r),
        'outbox',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM applications.preparation_outbox r),
        'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM applications.preparation_audit r)
      ) AS value`;
      return row?.value;
    };
    const before = await preparationSnapshot();
    await transitionLegacyReceipts(sql, {
      enabled: () => true,
      cipher,
      expectedAppliedMigrations: 8,
      expectedLegacyReceipts: 8,
    });
    expect(await preparationSnapshot()).toEqual(before);
    const after = await snapshot();
    const store = createIntegrationApplicationStore(sql, () => at, {
      definitions,
      legacyReceipts: { enabled: () => true, cipher },
    });
    const command = {
      ownerUserId: fixture.owner,
      applicationId: original.applicationId,
      idempotencyKey,
      request,
      context: { jobContextHash: HASH_A, confirmedFactsHash: HASH_A },
      packet: original.packet,
    };
    for (let retry = 0; retry < 2; retry++) {
      const replay = await store.queuePreparation(command);
      expect(replay.replayed).toBe(true);
      expect(replay.preparation.id).toBe(preparationId);
      expect(replay.preparation.state).toBe("queued");
    }
    await expect(
      store.queuePreparation({ ...command, request: { ...request, expectedRevision: 2 } }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(after);
    expect(await preparationSnapshot()).toEqual(before);
  });
  it("refuses withdrawn authority before replacing the original table", async () => {
    await historical();
    const before = await snapshot();
    let enabled = true;
    await expect(
      transitionLegacyReceipts(sql, {
        enabled: () => enabled,
        cipher: {
          encrypt: cipher.encrypt,
          matches: async (...args) => {
            const result = await cipher.matches(...args);
            enabled = false;
            return result;
          },
        },
      }),
    ).rejects.toThrow("LegacyReceiptTransitionUnavailable");
    expect(await snapshot()).toEqual(before);
  });
  it("refuses unknown receipt metadata instead of silently dropping it", async () => {
    await historical();
    await sql`ALTER TABLE applications.command_receipts ADD COLUMN synthetic_metadata text DEFAULT 'preserve me'`;
    const before = await snapshot();
    await expect(transitionLegacyReceipts(sql, { enabled: () => true, cipher })).rejects.toThrow(
      "LegacyReceiptTransitionUnavailable",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("rolls the complete transition back if an unexpected view depends on the old receipt table", async () => {
    await historical();
    await sql`CREATE VIEW public.synthetic_receipt_dependency AS SELECT idempotency_key FROM applications.command_receipts`;
    try {
      const before = await snapshot();
      await expect(transitionLegacyReceipts(sql, { enabled: () => true, cipher })).rejects.toThrow(
        "LegacyReceiptTransitionUnavailable",
      );
      expect(await snapshot()).toEqual(before);
      expect(await sql`SELECT * FROM public.synthetic_receipt_dependency`).toHaveLength(8);
    } finally {
      await sql`DROP VIEW public.synthetic_receipt_dependency`;
    }
  });
});
