import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import {
  candidateRightsOwnerInventoryWithApplications,
  createBuildingCandidateExportAuthorizer,
  PostgresRestrictedAnswerVaultStore,
  type RestrictedAnswerCipher,
} from "@ai-job-apply/profile-service";
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
  const vaultValues = new Map<
    string,
    { userId: string; fieldKey: string; context: string; value: string }
  >();
  const vaultCipher: RestrictedAnswerCipher = {
    encrypt: vi.fn(async (input) => {
      const handle = uuidv7();
      vaultValues.set(handle, { ...input, value: input.plaintext });
      return {
        ciphertext: Buffer.from(handle),
        kmsKeyId: "synthetic-vault-key",
        encryptionAlgorithm: "SYMMETRIC_DEFAULT" as const,
      };
    }),
    decrypt: vi.fn(async (input) => {
      const value = vaultValues.get(Buffer.from(input.ciphertext.ciphertext).toString("utf8"));
      if (
        !value ||
        value.userId !== input.userId ||
        value.fieldKey !== input.fieldKey ||
        value.context !== input.context
      )
        throw Error("SyntheticVaultScopeMismatch");
      return value.value;
    }),
  };
  const vault = new PostgresRestrictedAnswerVaultStore(sql, vaultCipher);
  const vaultStore = new PostgresApplicationStore(sql, undefined, {
    definitions: ownedDefinitions,
    restrictedPackets: { cipher, fingerprintKeyArn, enabled: () => true },
    lockVaultReferences: vault.lockCurrentReferences.bind(vault),
  });
  ownedDefinitions.set("documents.cover_letter", {
    key: "documents.cover_letter",
    label: "Synthetic document",
    valueType: "file",
    sensitivity: "standard",
    answerPolicy: "explicit_each_time",
  });
  const authorizeRestrictedPacketExport = createBuildingCandidateExportAuthorizer({
    enabled: () => true,
    policy: {
      version: "synthetic-restricted-export-v1",
      accountablePolicySha256: "a".repeat(64),
      exportArtifactLifetimeSeconds: 3600,
      downloadGrantLifetimeSeconds: 300,
      backupRetentionDays: 35,
      recentAuthenticationMaxAgeSeconds: 300,
      ownerInventory: candidateRightsOwnerInventoryWithApplications,
      subprocessorInventory: [],
    },
  });
  const exportStore = new PostgresApplicationStore(sql, undefined, {
    definitions: ownedDefinitions,
    restrictedPackets: { cipher, fingerprintKeyArn, enabled: () => true },
    authorizeRestrictedPacketExport,
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
        "Applications migrations through 0011_native_resume_execution_receipts applied and verified.",
      );
    }
  });
  afterAll(async () => {
    aesKey.fill(0);
    macKey.fill(0);
    vaultValues.clear();
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
  async function exportRequest(ownerUserId: string) {
    const exportId = uuidv7();
    const operationId = uuidv7();
    const policyVersion = "synthetic-restricted-export-v1";
    await sql`INSERT INTO platform.operations (id, user_id, kind, state) VALUES (${operationId}, ${ownerUserId}, 'candidate_data_export', 'running')`;
    await sql`INSERT INTO profile.candidate_data_exports (id, user_id, operation_id, format, policy_version, state)
      VALUES (${exportId}, ${ownerUserId}, ${operationId}, 'candidate-data-export-v1', ${policyVersion}, 'building')`;
    return { ownerUserId, exportId, operationId, policyVersion };
  }
  async function selectedPacket(expiry?: Date) {
    const command = await application();
    const save = {
      userId: command.ownerUserId,
      fieldKey: "authorization.us_authorized",
      context: "us",
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "true",
      sensitivity: "restricted" as const,
      confirmedAt: new Date(),
      sourceReference: "synthetic.restricted-packet",
      idempotencyKey: idempotencyKey(),
      traceId: "synthetic.restricted-packet",
      ...(expiry ? { expiresAt: expiry } : {}),
    };
    const saved = await vault.save(save);
    const result = await vaultStore.createPacket({
      ...command,
      packet: {
        ...packet,
        fields: [
          proposal(),
          proposal({
            fieldKey: save.fieldKey,
            value: true,
            origin: "answer_vault",
            sourceFactIds: [saved.id],
            vaultReference: {
              ...saved,
              context: save.context,
              questionHash: HASH_A,
              meaningConfirmed: true,
              validUntilEpochMs: expiry?.getTime() ?? null,
            },
          }),
        ],
      },
    });
    const current = result.view.currentPacket;
    if (!current) throw Error("Missing selected synthetic packet");
    return {
      save,
      saved,
      target: {
        ownerUserId: command.ownerUserId,
        applicationId: command.applicationId,
        expectedRevision: result.view.application.revision,
        packetId: current.id,
        packetHash: current.packetHash,
      },
    };
  }
  async function futureDeadline() {
    const [row] = await sql<
      Array<{ deadline: Date }>
    >`SELECT clock_timestamp() + interval '3 seconds' AS deadline`;
    if (!row) throw Error("Missing synthetic deadline");
    return row.deadline;
  }
  async function waitUntil(deadline: Date) {
    await sql`SELECT pg_sleep(greatest(0, extract(epoch FROM ${deadline}::timestamptz - clock_timestamp())) + 0.05)`;
  }
  it("reads the exact selected packet value with Profile metadata admission and no vault decryption", async () => {
    const f = await selectedPacket();
    const count = vi.mocked(vaultCipher.decrypt).mock.calls.length;
    const result = await vaultStore.readCurrentPacketValues(f.target);
    expect(result.values.get(f.save.fieldKey)).toBe(true);
    expect(vi.mocked(vaultCipher.decrypt).mock.calls.length).toBe(count);
    const current = await vaultStore.getApplication(f.target.ownerUserId, f.target.applicationId);
    expect(
      current.currentPacket?.fields.find((field) => field.fieldKey === f.save.fieldKey),
    ).toMatchObject({ value: null, protectedValue: true, requiresReview: true });
    if (result.values instanceof Map) result.values.clear();
  });
  it.each(["corrected", "deleted"] as const)(
    "withholds selected packet values %s during decrypt without retaining Profile locks",
    async (outcome) => {
      const f = await selectedPacket();
      onDecrypt = async () => {
        await sql.begin(async (tx) => {
          const [lock] = await tx<
            Array<{ available: boolean }>
          >`SELECT pg_try_advisory_xact_lock(hashtext(${`restricted-answer:${f.save.userId}:${f.save.fieldKey}:${f.save.context}`})) AS available`;
          expect(lock?.available).toBe(true);
          await tx`SELECT id FROM profile.restricted_answers WHERE id = ${f.saved.id} FOR UPDATE NOWAIT`;
        });
        if (outcome === "corrected")
          await vault.save({
            ...f.save,
            expectedVersion: f.saved.version,
            value: "true",
            idempotencyKey: idempotencyKey(),
          });
        else
          await vault.remove({
            userId: f.save.userId,
            id: f.saved.id,
            expectedVersion: f.saved.version,
            traceId: "synthetic.delete",
          });
      };
      try {
        await expect(vaultStore.readCurrentPacketValues(f.target)).rejects.toThrow(
          RestrictedPacketStoreUnavailableError,
        );
      } finally {
        onDecrypt = undefined;
      }
      const stages = await sql<
        Array<{ stage: string }>
      >`SELECT stage FROM applications_restricted.packet_read_audit WHERE packet_id = ${f.target.packetId}`;
      expect(stages).toEqual([{ stage: "admitted" }]);
    },
  );
  it("refuses an expired selected packet before decryption", async () => {
    const deadline = await futureDeadline();
    const f = await selectedPacket(deadline);
    await waitUntil(deadline);
    const count = vi.mocked(cipher.decrypt).mock.calls.length;
    await expect(vaultStore.readCurrentPacketValues(f.target)).rejects.toThrow(
      RestrictedPacketStoreUnavailableError,
    );
    expect(vi.mocked(cipher.decrypt).mock.calls.length).toBe(count);
  });
  it("withholds a selected packet whose original deadline expires during decryption", async () => {
    const deadline = await futureDeadline();
    const f = await selectedPacket(deadline);
    onDecrypt = () => waitUntil(deadline);
    try {
      await expect(vaultStore.readCurrentPacketValues(f.target)).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
    } finally {
      onDecrypt = undefined;
    }
    const stages = await sql<
      Array<{ stage: string }>
    >`SELECT stage FROM applications_restricted.packet_read_audit WHERE packet_id = ${f.target.packetId}`;
    expect(stages).toEqual([{ stage: "admitted" }]);
  });
  it.each(["corrected", "deleted", "expired"] as const)(
    "exports the original selected value after its saved source is %s",
    async (outcome) => {
      const deadline = outcome === "expired" ? await futureDeadline() : undefined;
      const f = await selectedPacket(deadline);
      if (outcome === "corrected")
        await vault.save({
          ...f.save,
          expectedVersion: f.saved.version,
          value: "false",
          idempotencyKey: idempotencyKey(),
        });
      else if (outcome === "deleted")
        await vault.remove({
          userId: f.save.userId,
          id: f.saved.id,
          expectedVersion: f.saved.version,
          traceId: "synthetic.delete",
        });
      else if (deadline) await waitUntil(deadline);
      const scope = await exportRequest(f.target.ownerUserId);
      const result = await exportStore.readExportPacketValues({
        ...scope,
        applicationId: f.target.applicationId,
        packetId: f.target.packetId,
        packetHash: f.target.packetHash,
      });
      expect(result.values.get(f.save.fieldKey)).toBe(true);
      if (result.values instanceof Map) result.values.clear();
      await expect(vaultStore.readCurrentPacketValues(f.target)).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
    },
  );
  it("exports original chosen values independently from two historical packet versions", async () => {
    const command = await application();
    const first = await store.createPacket({ ...command, packet });
    await store.createPacket({
      ...command,
      expectedRevision: first.view.application.revision,
      idempotencyKey: idempotencyKey(),
      packet: {
        ...packet,
        fields: [
          proposal(),
          proposal({
            fieldKey: "authorization.us_authorized",
            value: false,
            origin: "user_entered",
            sourceFactIds: [],
          }),
        ],
      },
    });
    const scope = await exportRequest(command.ownerUserId);
    const [fragment] = await sql<
      Array<{
        data: {
          applications: {
            packets: Array<{
              id: string;
              applicationId: string;
              packetHash: string;
              fields: Array<{ fieldKey: string; value: unknown }>;
            }>;
          };
          restrictedPacketReferences: {
            schemaVersion: number;
            packets: Array<{
              applicationId: string;
              packetId: string;
              packetHash: string;
              fieldKeys: string[];
            }>;
          };
        };
      }>
    >`
      SELECT applications.export_candidate_data(${command.ownerUserId}::uuid) AS data`;
    if (!fragment) throw Error("Missing synthetic export fragment");
    expect(fragment.data.restrictedPacketReferences.schemaVersion).toBe(1);
    expect(fragment.data.restrictedPacketReferences.packets).toHaveLength(2);
    expect(JSON.stringify(fragment.data.applications)).not.toContain("protectedValue");
    expect(JSON.stringify(fragment.data.applications)).not.toContain("restrictedValues");
    const values = [];
    for (const reference of fragment.data.restrictedPacketReferences.packets) {
      const result = await exportStore.readExportPacketValues({
        ...scope,
        applicationId: reference.applicationId,
        packetId: reference.packetId,
        packetHash: reference.packetHash,
      });
      values.push(result.values.get("authorization.us_authorized"));
    }
    expect(values).toEqual([true, false]);
    const firstPacket = first.view.currentPacket;
    if (!firstPacket) throw Error("Missing synthetic original packet");
    await expect(
      store.readCurrentPacketValues({
        ...command,
        packetId: firstPacket.id,
        packetHash: firstPacket.packetHash,
        expectedRevision: first.view.application.revision,
      }),
    ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
  });
  it("refuses an absent or foreign rights request before historical decryption", async () => {
    const target = await review();
    const scope = await exportRequest(target.ownerUserId);
    const calls = vi.mocked(cipher.decrypt).mock.calls.length;
    await expect(
      exportStore.readExportPacketValues({
        ...scope,
        applicationId: target.applicationId,
        packetId: target.packetId,
        packetHash: target.packetHash,
        exportId: uuidv7(),
      }),
    ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
    const foreign = await application();
    const foreignScope = await exportRequest(foreign.ownerUserId);
    await expect(
      exportStore.readExportPacketValues({
        ...scope,
        applicationId: target.applicationId,
        packetId: target.packetId,
        packetHash: target.packetHash,
        exportId: foreignScope.exportId,
      }),
    ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
    expect(vi.mocked(cipher.decrypt).mock.calls.length).toBe(calls);
  });
  it("holds no rights request/operation locks during decrypt and withholds a request that fails meanwhile", async () => {
    const target = await review();
    const scope = await exportRequest(target.ownerUserId);
    onDecrypt = async () => {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM profile.candidate_data_exports WHERE id = ${scope.exportId} FOR UPDATE NOWAIT`;
        await tx`SELECT id FROM platform.operations WHERE id = ${scope.operationId} FOR UPDATE NOWAIT`;
        await tx`UPDATE profile.candidate_data_exports SET state = 'failed', failure_code = 'owner_unavailable' WHERE id = ${scope.exportId}`;
      });
    };
    try {
      await expect(
        exportStore.readExportPacketValues({
          ...scope,
          applicationId: target.applicationId,
          packetId: target.packetId,
          packetHash: target.packetHash,
        }),
      ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
    } finally {
      onDecrypt = undefined;
    }
  });
  it("rejects direct ciphertext/audit deletion without privacy authority", async () => {
    const target = await review();
    await store.readCurrentPacketValues(target);
    await expect(
      sql`DELETE FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${target.ownerUserId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM applications_restricted.packet_values WHERE owner_user_id = ${target.ownerUserId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`SELECT applications.delete_candidate_data(${target.ownerUserId}::uuid, ${uuidv7()}::uuid)`,
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("removes only the exact candidate ciphertext/audit after privacy-authorized packet deletion", async () => {
    const doomed = await review();
    const survivor = await review();
    await store.readCurrentPacketValues(doomed);
    await store.readCurrentPacketValues(survivor);
    const requestId = uuidv7();
    const operationId = uuidv7();
    const now = new Date();
    const expires = new Date(now.getTime() + 35 * 86400000);
    await sql`INSERT INTO platform.operations (id, user_id, kind, state) VALUES (${operationId}, ${doomed.ownerUserId}, 'account_deletion', 'queued')`;
    await sql`INSERT INTO profile.account_deletion_requests (id, user_id, operation_id, policy_version, state, version,
      requested_at, updated_at, confirmed_at, backup_expires_at) VALUES (${requestId}, ${doomed.ownerUserId}, ${operationId},
      'synthetic-restricted-delete-v1', 'quarantined', 2, ${now}, ${now}, ${now}, ${expires})`;
    await sql`INSERT INTO privacy.account_deletion_ledger (request_id, subject_digest, policy_version, policy_sha256, state,
      owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at) VALUES (${requestId}, ${"1".repeat(64)},
      'synthetic-restricted-delete-v1', ${"2".repeat(64)}, 'quarantined', ${sql.json({ applications: "pending" })}, ${sql.json({})}, ${now}, ${expires}, ${now})`;
    await expect(
      sql`SELECT applications.delete_candidate_data(${survivor.ownerUserId}::uuid, ${requestId}::uuid)`,
    ).rejects.toMatchObject({ code: "42501" });
    await sql`SELECT applications.delete_candidate_data(${doomed.ownerUserId}::uuid, ${requestId}::uuid)`;
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${doomed.ownerUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${doomed.ownerUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_values WHERE owner_user_id = ${survivor.ownerUserId}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT id FROM applications_restricted.packet_read_audit WHERE owner_user_id = ${survivor.ownerUserId}`,
    ).toHaveLength(2);
    await expect(store.readCurrentPacketValues(doomed)).rejects.toThrow(
      RestrictedPacketStoreUnavailableError,
    );
  });
});
