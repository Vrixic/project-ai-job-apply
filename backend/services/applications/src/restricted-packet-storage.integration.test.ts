import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "./canonical.js";
import type { RestrictedPacketCipher } from "./restricted-packet-cipher.js";
import { ApplicationsService } from "./service.js";
import {
  ApplicationRevisionConflictError,
  PostgresApplicationStore,
  RestrictedPacketStoreUnavailableError,
} from "./store.js";
import { definitions, FACT_A, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

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
  let onDecrypt: (() => Promise<void>) | undefined;
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
      await onDecrypt?.();
      const aes = createDecipheriv("aes-256-gcm", aesKey, envelope.iv);
      aes.setAAD(Buffer.from(canonicalJson(scope)));
      aes.setAuthTag(Buffer.from(envelope.authenticationTag));
      return Buffer.concat([aes.update(envelope.ciphertext), aes.final()]);
    }),
    fingerprint: vi.fn(async (input) =>
      createHmac("sha256", macKey).update(canonicalJson(input)).digest("hex"),
    ),
  };
  const ownedDefinitions = new Map(definitions);
  ownedDefinitions.set("documents.cover_letter", {
    key: "documents.cover_letter",
    label: "Synthetic document",
    valueType: "file",
    sensitivity: "standard",
    answerPolicy: "explicit_each_time",
  });
  const store = new PostgresApplicationStore(sql, undefined, {
    definitions: ownedDefinitions,
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
      definitions: ownedDefinitions,
      restrictedPackets: { cipher, fingerprintKeyArn: encryptionKeyArn, enabled: () => true },
    });
    const calls = vi.mocked(cipher.fingerprint).mock.calls.length;
    await expect(rotated.createPacket({ ...command, packet })).rejects.toThrow(
      RestrictedPacketStoreUnavailableError,
    );
    expect(vi.mocked(cipher.fingerprint).mock.calls.length).toBe(calls);
  });
  async function review() {
    const command = await application();
    const result = await store.createPacket({ ...command, packet });
    const current = result.view.currentPacket;
    if (!current) throw Error("Missing synthetic packet");
    return {
      ...command,
      packetId: current.id,
      packetHash: current.packetHash,
      expectedRevision: result.view.application.revision,
    };
  }
  it("reads exact values separately, audits metadata only, and produces the existing strict owner API", async () => {
    const target = await review();
    const result = await store.readCurrentPacketValues(target);
    expect(result.values.get("authorization.us_authorized")).toBe(true);
    const audits = await sql`SELECT purpose, stage FROM applications_restricted.packet_read_audit
      WHERE owner_user_id = ${target.ownerUserId} ORDER BY created_at, stage`;
    expect(audits.map((row) => row.stage)).toEqual(["admitted", "validated"]);
    expect(audits.every((row) => row.purpose === "candidate_review")).toBe(true);
    const service = new ApplicationsService({
      store,
      restrictedPackets: store,
      packets: { prepare: async () => packet },
      bindings: {
        resolve: async () => ({ jobRevision: HASH_A, formHash: HASH_B, resumeHash: HASH_C }),
      },
      jobs: { isActive: async () => true },
    });
    const api = await service.get(target.ownerUserId, target.applicationId);
    const validate = compileComponentValidator("Application");
    expect(validate(api), JSON.stringify(validate.errors)).toBe(true);
    expect(
      api.currentPacket?.fields.find((field) => field.fieldKey === "authorization.us_authorized")
        ?.value,
    ).toBe(true);
    expect(JSON.stringify(api)).not.toContain("restrictedValues");
    expect(JSON.stringify(api)).not.toContain("protectedValue");
  });
  it("releases owner/application locks before decrypting", async () => {
    const target = await review();
    let observed = false;
    onDecrypt = async () => {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM identity.users WHERE id = ${target.ownerUserId} FOR UPDATE NOWAIT`;
        await tx`SELECT id FROM applications.applications WHERE id = ${target.applicationId} FOR UPDATE NOWAIT`;
        observed = true;
      });
    };
    try {
      await store.readCurrentPacketValues(target);
    } finally {
      onDecrypt = undefined;
    }
    expect(observed).toBe(true);
  });
  it("withholds values when an application changes during decrypt", async () => {
    const target = await review();
    onDecrypt = async () => {
      await store.cancel({ ...target, idempotencyKey: idempotencyKey() });
    };
    try {
      await expect(store.readCurrentPacketValues(target)).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
    } finally {
      onDecrypt = undefined;
    }
    const audits =
      await sql`SELECT stage FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${target.ownerUserId}`;
    expect(audits.map((row) => row.stage)).toEqual(["admitted"]);
  });
  it("withholds values when the candidate becomes quarantined during decrypt", async () => {
    const target = await review();
    onDecrypt = async () => {
      await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now()
      WHERE id = ${target.ownerUserId}`;
    };
    try {
      await expect(store.readCurrentPacketValues(target)).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
    } finally {
      onDecrypt = undefined;
    }
  });
  it("refuses a foreign owner before decrypting", async () => {
    const target = await review();
    const foreign = await application();
    const calls = vi.mocked(cipher.decrypt).mock.calls.length;
    await expect(
      store.readCurrentPacketValues({ ...target, ownerUserId: foreign.ownerUserId }),
    ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
    expect(vi.mocked(cipher.decrypt).mock.calls.length).toBe(calls);
  });
  it("retains exact protected identity and values through preparation completion without crypto under the write transaction", async () => {
    const command = await application();
    const context = { jobContextHash: HASH_A, confirmedFactsHash: HASH_B };
    const queued = await store.queuePreparation({
      ...command,
      packet,
      context,
      request: {
        expectedRevision: 1,
        coverLetter: {
          disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
        },
      },
    });
    const [event] = await sql<
      Array<{ id: string }>
    >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${queued.preparation.id}`;
    if (!event) throw Error("Missing synthetic event");
    await store.claimPreparationGeneration(event.id, queued.preparation.id, context);
    const before = {
      encrypt: vi.mocked(cipher.encrypt).mock.calls.length,
      decrypt: vi.mocked(cipher.decrypt).mock.calls.length,
    };
    const result = await store.completePreparation(event.id, queued.preparation.id, context, {
      contentSha256: "d".repeat(64),
      sourceFactIds: [FACT_A],
      confidence: 0.95,
    });
    expect(result.state).toBe("succeeded");
    expect(vi.mocked(cipher.encrypt).mock.calls.length).toBe(before.encrypt);
    expect(vi.mocked(cipher.decrypt).mock.calls.length).toBe(before.decrypt);
    const view = await store.getApplication(command.ownerUserId, command.applicationId);
    expect(view.currentPacket?.restrictedValues).toEqual(
      queued.view.currentPacket?.restrictedValues,
    );
    const current = view.currentPacket;
    if (!current) throw Error("Missing completed synthetic packet");
    const values = await store.readCurrentPacketValues({
      ...command,
      packetId: current.id,
      packetHash: current.packetHash,
      expectedRevision: view.application.revision,
    });
    expect(values.values.get("authorization.us_authorized")).toBe(true);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${command.ownerUserId}`,
    ).toHaveLength(1);
  });
});
