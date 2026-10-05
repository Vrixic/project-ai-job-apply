import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "./canonical.js";
import type { RestrictedPacketCipher } from "./restricted-packet-cipher.js";
import {
  ApplicationRevisionConflictError,
  PostgresApplicationStore,
  RestrictedPacketStoreUnavailableError,
} from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const disposable =
  databaseUrl &&
  (() => {
    const url = new URL(databaseUrl);
    return (
      url.hostname === "127.0.0.1" && /^\/restricted_packet_[a-z0-9_]{1,40}$/u.test(url.pathname)
    );
  })();
const suite = disposable ? describe : describe.skip;
const run = promisify(execFile);
const encryptionKeyArn =
  "arn:aws:kms:us-east-1:111111111111:key/11111111-1111-4111-8111-111111111111";
const fingerprintKeyArn =
  "arn:aws:kms:us-east-1:111111111111:key/22222222-2222-4222-8222-222222222222";
const packet = {
  jobRevision: HASH_A,
  form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
  artifactHashes: { resume: HASH_C },
  fields: [
    proposal(),
    proposal({
      fieldKey: "authorization.us_authorized",
      value: true,
      origin: "user_entered",
      sourceFactIds: [],
    }),
  ],
};
const idempotencyKey = () => `restricted-${uuidv7()}`;

suite("restricted packet owned PostgreSQL boundary (offline cipher)", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 6, onnotice: () => undefined });
  const aesKey = randomBytes(32);
  const macKey = randomBytes(32);
  let onEncrypt: (() => Promise<void>) | undefined;
  const cipher: RestrictedPacketCipher = {
    encrypt: vi.fn(async (scope, bytes) => {
      await onEncrypt?.();
      const iv = randomBytes(12);
      const aes = createCipheriv("aes-256-gcm", aesKey, iv);
      aes.setAAD(Buffer.from(canonicalJson(scope)));
      return {
        schemaVersion: 1 as const,
        encryptionKeyArn,
        encryptedDataKey: randomBytes(40),
        iv,
        ciphertext: Buffer.concat([aes.update(bytes), aes.final()]),
        authenticationTag: aes.getAuthTag(),
      };
    }),
    decrypt: vi.fn(async (scope, envelope) => {
      const aes = createDecipheriv("aes-256-gcm", aesKey, envelope.iv);
      aes.setAAD(Buffer.from(canonicalJson(scope)));
      aes.setAuthTag(Buffer.from(envelope.authenticationTag));
      return Buffer.concat([aes.update(envelope.ciphertext), aes.final()]);
    }),
    fingerprint: vi.fn(async (input) =>
      createHmac("sha256", macKey).update(canonicalJson(input)).digest("hex"),
    ),
  };
  const store = new PostgresApplicationStore(sql, undefined, {
    definitions,
    restrictedPackets: { cipher, fingerprintKeyArn, enabled: () => true },
  });
  beforeAll(async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    await run(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env },
    );
    const executable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    for (let index = 0; index < 2; index++) {
      const result = await run(process.execPath, [executable], { env });
      expect(result.stdout.trim()).toBe(
        "Applications migrations through 0009_restricted_packet_values applied and verified.",
      );
    }
  });
  afterAll(async () => {
    aesKey.fill(0);
    macKey.fill(0);
    await sql.end({ timeout: 5 });
  });
  async function application() {
    const ownerUserId = uuidv7();
    await sql`INSERT INTO identity.users (id) VALUES (${ownerUserId})`;
    const created = await store.createApplication({
      ownerUserId,
      canonicalJobId: uuidv7(),
      idempotencyKey: idempotencyKey(),
    });
    return {
      ownerUserId,
      applicationId: created.view.application.id,
      expectedRevision: 1,
      idempotencyKey: idempotencyKey(),
    };
  }
  it("commits masked metadata, immutable ciphertext, keyed replay and identifier-only events together", async () => {
    const command = await application();
    const result = await store.createPacket({ ...command, packet });
    const current = result.view.currentPacket;
    expect(
      current?.fields.find((field) => field.fieldKey === "authorization.us_authorized"),
    ).toMatchObject({ value: null, protectedValue: true });
    expect(current?.restrictedValues).toBeDefined();
    const [record] =
      await sql`SELECT * FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`;
    expect(record?.ciphertext).toBeInstanceOf(Uint8Array);
    expect(record?.encryption_key_arn).toBe(encryptionKeyArn);
    const [receipt] =
      await sql`SELECT request_hash, request_hash_scheme, request_key_arn FROM applications.command_receipts
      WHERE owner_user_id = ${command.ownerUserId} AND operation = 'create_packet'`;
    expect(receipt?.request_hash_scheme).toBe("kms-hmac-sha256.v1");
    expect(receipt?.request_key_arn).toBe(fingerprintKeyArn);
    expect(receipt?.request_hash).toMatch(/^[a-f0-9]{64}$/u);
    const events =
      await sql`SELECT payload FROM applications.outbox WHERE owner_user_id = ${command.ownerUserId}`;
    expect(JSON.stringify(events)).not.toContain("authorization.us_authorized");
    expect(JSON.stringify(events)).not.toContain("protectedValue");
    const encryptCalls = vi.mocked(cipher.encrypt).mock.calls.length;
    const replay = await store.createPacket({ ...command, packet });
    expect(replay.replayed).toBe(true);
    expect(replay.view.currentPacket?.id).toBe(current?.id);
    expect(vi.mocked(cipher.encrypt).mock.calls.length).toBe(encryptCalls);
  });
  it("keeps ordinary fields and v1 hashing, while protecting every packet request receipt", async () => {
    const command = await application();
    const result = await store.createPacket({
      ...command,
      packet: { ...packet, fields: [proposal()] },
    });
    expect(result.view.currentPacket?.restrictedValues).toBeUndefined();
    expect(result.view.currentPacket?.fields[0]?.value).toBe("candidate@example.test");
    const rows =
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`;
    expect(rows).toHaveLength(0);
  });
  it("rejects a direct plaintext restricted packet even with otherwise valid owner/application fields", async () => {
    const command = await application();
    const fields = [
      {
        fieldKey: "authorization.us_authorized",
        value: true,
        origin: "user_entered",
        sourceFactIds: [],
        confidence: 1,
        disposition: "review",
        reasons: ["restricted_answer", "never_infer"],
        requiresReview: true,
      },
    ];
    await expect(sql`INSERT INTO applications.packets (id, application_id, owner_user_id, version, packet_hash,
      job_revision, fields, created_at) VALUES (${uuidv7()}, ${command.applicationId}, ${command.ownerUserId}, 1,
      ${HASH_A}, ${HASH_B}, ${sql.json(fields)}, now())`).rejects.toMatchObject({ code: "23514" });
  });
  it("does not retain an identity/application SQL lock while encryption is pending", async () => {
    const command = await application();
    let observed = false;
    onEncrypt = async () => {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM identity.users WHERE id = ${command.ownerUserId} FOR UPDATE NOWAIT`;
        await tx`SELECT id FROM applications.applications WHERE id = ${command.applicationId} FOR UPDATE NOWAIT`;
        observed = true;
      });
    };
    try {
      await store.createPacket({ ...command, packet });
    } finally {
      onEncrypt = undefined;
    }
    expect(observed).toBe(true);
  });
  it("retains no ciphertext or packet when metadata insertion aborts the transaction", async () => {
    const command = await application();
    await sql.unsafe(`CREATE FUNCTION applications.test_restricted_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.owner_user_id = '${command.ownerUserId}'::uuid THEN RAISE EXCEPTION 'synthetic packet failure'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER test_restricted_abort AFTER INSERT ON applications.packets
      FOR EACH ROW EXECUTE FUNCTION applications.test_restricted_abort();`);
    try {
      await expect(store.createPacket({ ...command, packet })).rejects.toThrow(
        "synthetic packet failure",
      );
    } finally {
      await sql.unsafe(
        "DROP TRIGGER test_restricted_abort ON applications.packets; DROP FUNCTION applications.test_restricted_abort();",
      );
    }
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM applications.packets WHERE owner_user_id = ${command.ownerUserId}`,
    ).toHaveLength(0);
    expect(
      (await store.getApplication(command.ownerUserId, command.applicationId)).application.revision,
    ).toBe(1);
  });
  it("concurrent duplicate requests retain one original packet and encrypted record", async () => {
    const command = await application();
    const results = await Promise.all([
      store.createPacket({ ...command, packet }),
      store.createPacket({ ...command, packet }),
    ]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results[0]?.view.currentPacket?.id).toBe(results[1]?.view.currentPacket?.id);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`,
    ).toHaveLength(1);
  });
  it("does not mutate a stale revision after pre-lock crypto finishes", async () => {
    const command = await application();
    await store.createPacket({ ...command, packet });
    await expect(
      store.createPacket({ ...command, idempotencyKey: idempotencyKey(), packet }),
    ).rejects.toThrow(ApplicationRevisionConflictError);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`,
    ).toHaveLength(1);
  });
  it("refuses unsupported historical MAC authority without replacing the receipt or issuing a MAC", async () => {
    const command = await application();
    await store.createPacket({ ...command, packet });
    const rotated = new PostgresApplicationStore(sql, undefined, {
      definitions,
      restrictedPackets: { cipher, fingerprintKeyArn: encryptionKeyArn, enabled: () => true },
    });
    const calls = vi.mocked(cipher.fingerprint).mock.calls.length;
    await expect(rotated.createPacket({ ...command, packet })).rejects.toThrow(
      RestrictedPacketStoreUnavailableError,
    );
    expect(vi.mocked(cipher.fingerprint).mock.calls.length).toBe(calls);
  });
});
