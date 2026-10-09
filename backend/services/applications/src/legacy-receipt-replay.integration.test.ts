import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalHash } from "./canonical.js";
import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";
import { createLegacyReceiptReplay, legacyReceiptMetadataHash } from "./legacy-receipt-replay.js";
import {
  createFixtureApplication,
  createIntegrationApplicationStore,
} from "./restricted-packet-integration-support.js";
import {
  ApplicationIdempotencyConflictError,
  RestrictedPacketStoreUnavailableError,
} from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const url = process.env.LEGACY_RECEIPT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/legacy_receipt_fixture" ||
    parsed.protocol !== "postgres:" ||
    parsed.search ||
    parsed.hash
  )
    throw Error("LegacyReceiptFixtureRequiresDisposableLoopbackDatabase");
}
const keyArn = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-08T12:00:00Z");
const execute = promisify(execFile);
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(?:path|systemroot|windir|temp|tmp|comspec|userprofile)$/iu.test(key),
  ),
);

describe.skipIf(!url)("protected legacy receipt archive and store replay", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 6, onnotice: () => undefined });
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
          const record = encrypted.get(
            Buffer.from(command.input.CiphertextBlob as Uint8Array).toString("hex"),
          );
          if (!record || record.context !== JSON.stringify(command.input.EncryptionContext))
            throw Error("SyntheticContextMismatch");
          return {
            KeyId: keyArn,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            Plaintext: Uint8Array.from(record.digest),
          };
        }
        throw Error("UnexpectedSyntheticCommand");
      },
    },
  });
  const store = createIntegrationApplicationStore(sql, () => now, {
    definitions,
    legacyReceipts: { enabled: () => true, cipher },
  });
  beforeAll(async () => {
    if ((await sql`SELECT to_regnamespace('applications') AS existing`)[0]?.existing !== null)
      throw Error("LegacyReceiptFixtureRequiresFreshDatabase");
    for (const target of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"])
      await execute(process.execPath, [fileURLToPath(new URL(target, import.meta.url))], {
        env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url },
      });
    const ddl = await readFile(
      new URL("../transitions/0001_legacy_receipt_archive.sql", import.meta.url),
      "utf8",
    );
    await sql.begin((tx) => tx.unsafe(ddl));
  }, 60_000);
  afterAll(async () => {
    for (const record of encrypted.values()) record.digest.fill(0);
    encrypted.clear();
    await sql.end();
  });

  async function seed(
    install = true,
    originalOperation: "create_packet" | "queue_preparation" = "create_packet",
  ) {
    const owner = uuidv7();
    const app = await createFixtureApplication(store, sql, {
      ownerUserId: owner,
      canonicalJobId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    const command = {
      ownerUserId: owner,
      applicationId: app.view.application.id,
      expectedRevision: app.view.application.revision,
      idempotencyKey: uuidv7(),
      packet: {
        jobRevision: HASH_A,
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
        fields: [proposal()],
        artifactHashes: { resume: HASH_C },
      },
    };
    const packeted = await store.createPacket({ ...command, idempotencyKey: uuidv7() });
    const packet = packeted.view.currentPacket;
    if (!packet) throw Error("MissingSyntheticPacket");
    await store.approve({
      ownerUserId: owner,
      applicationId: command.applicationId,
      expectedRevision: packeted.view.application.revision,
      idempotencyKey: uuidv7(),
      request: { packetHash: packet.packetHash, consentId: uuidv7(), acknowledgedFieldKeys: [] },
      current: { jobRevision: HASH_A, formHash: HASH_B, resumeHash: HASH_C },
    });
    const metadata = {
      owner_user_id: owner,
      application_id: command.applicationId,
      idempotency_key: command.idempotencyKey,
      response_revision: String(packeted.view.application.revision),
      outcome_code: null,
      subject_id: null,
      created_at_exact: "2026-10-08T12:00:00.123456Z",
      original_operation: originalOperation,
    };
    const scope = {
      ownerUserId: owner,
      applicationId: command.applicationId,
      protectionId: uuidv7(),
      operation: originalOperation,
      metadataSha256: legacyReceiptMetadataHash(metadata),
    };
    const originalDigest = canonicalHash({
      operation: "create_packet",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
      ...command.packet,
    });
    const envelope = await cipher.encrypt(scope, originalDigest);
    const ciphertextHash = createHash("sha256").update(envelope.ciphertext).digest("hex");
    async function marker(tx: postgres.TransactionSql, hash = ciphertextHash) {
      await tx`INSERT INTO applications.command_receipts
        (owner_user_id,idempotency_key,application_id,operation,request_hash,request_hash_scheme,response_revision,created_at)
        VALUES (${owner},${command.idempotencyKey},${command.applicationId},'archived_legacy',${hash},
          'legacy-ciphertext-sha256.v1',${metadata.response_revision},${metadata.created_at_exact}::text::timestamptz)`;
    }
    async function archive(tx: postgres.TransactionSql, application = command.applicationId) {
      await tx`INSERT INTO applications_restricted.legacy_receipts
        (owner_user_id,idempotency_key,application_id,protection_id,original_operation,metadata_sha256,encryption_key_arn,ciphertext)
        VALUES (${owner},${command.idempotencyKey},${application},${scope.protectionId},${originalOperation},
          ${scope.metadataSha256},${keyArn},${Buffer.from(envelope.ciphertext)})`;
    }
    if (install)
      await sql.begin(async (tx) => {
        await marker(tx);
        await archive(tx);
      });
    return { owner, command, marker, archive, originalDigest };
  }
  async function snapshot(owner: string) {
    const result: Record<string, unknown> = {};
    for (const table of [
      "applications.applications",
      "applications.packets",
      "applications.approvals",
      "applications.attempts",
      "applications.command_receipts",
      "applications.history",
      "applications.outbox",
      "applications_restricted.legacy_receipts",
    ]) {
      const [row] = await sql.unsafe(
        `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${table} r WHERE owner_user_id=$1`,
        [owner],
      );
      result[table] = row?.rows;
    }
    return result;
  }

  it("replays the original request without changing packet, approval, revision, receipt or outbox", async () => {
    const { owner, command } = await seed();
    const before = await snapshot(owner);
    const replay = await store.createPacket(command);
    expect(replay.replayed).toBe(true);
    expect(replay.view.approval).not.toBeNull();
    expect(await snapshot(owner)).toEqual(before);
    await expect(
      store.createPacket({ ...command, expectedRevision: command.expectedRevision + 1 }),
    ).rejects.toBeInstanceOf(ApplicationIdempotencyConflictError);
    await expect(
      store.cancel({
        ownerUserId: owner,
        applicationId: command.applicationId,
        expectedRevision: replay.view.application.revision,
        idempotencyKey: command.idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ApplicationIdempotencyConflictError);
    expect(await snapshot(owner)).toEqual(before);
  });
  it.each(["missing-archive", "missing-marker", "wrong-hash"])(
    "rolls back %s atomically",
    async (fault) => {
      const fixture = await seed(false);
      const before = await snapshot(fixture.owner);
      await expect(
        sql.begin(async (tx) => {
          if (fault !== "missing-marker")
            await fixture.marker(tx, fault === "wrong-hash" ? HASH_A : undefined);
          if (fault !== "missing-archive") await fixture.archive(tx);
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^235(?:03|14)$/u) });
      expect(await snapshot(fixture.owner)).toEqual(before);
    },
  );
  it("reserves archived keys against concurrent different-application commands", async () => {
    const fixture = await seed();
    const before = await snapshot(fixture.owner);
    const commands = Array.from({ length: 2 }, () =>
      store.createApplication({
        ownerUserId: fixture.owner,
        canonicalJobId: uuidv7(),
        idempotencyKey: fixture.command.idempotencyKey,
      }),
    );
    const results = await Promise.allSettled(commands);
    expect(
      results.every(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof ApplicationIdempotencyConflictError,
      ),
    ).toBe(true);
    expect(await snapshot(fixture.owner)).toEqual(before);
  });
  it("refuses absent capability and original-operation mismatch without new effects", async () => {
    const first = await seed();
    const disabled = createIntegrationApplicationStore(sql, () => now, { definitions });
    await expect(disabled.createPacket(first.command)).rejects.toBeInstanceOf(
      RestrictedPacketStoreUnavailableError,
    );
    const second = await seed(true, "queue_preparation");
    await expect(store.createPacket(second.command)).rejects.toBeInstanceOf(
      ApplicationIdempotencyConflictError,
    );
  });
  it("holds no SQL locks across crypto and rechecks authority after the await", async () => {
    const fixture = await seed();
    let enabled = true;
    const reader = createLegacyReceiptReplay(sql, {
      enabled: () => enabled,
      cipher: {
        matches: async (...args) => {
          await sql.begin(async (tx) => {
            await tx`SELECT id FROM applications.applications WHERE id=${fixture.command.applicationId} FOR UPDATE NOWAIT`;
            await tx`SELECT id FROM identity.users WHERE id=${fixture.owner} FOR UPDATE NOWAIT`;
          });
          const matched = await cipher.matches(...args);
          enabled = false;
          return matched;
        },
      },
    });
    await expect(
      reader.prepare(
        fixture.owner,
        fixture.command.applicationId,
        fixture.command.idempotencyKey,
        "create_packet",
        fixture.originalDigest,
      ),
    ).rejects.toThrow("LegacyReceiptReplayUnavailable");
  });
  it("rejects candidate quarantine during decryption without replay effects", async () => {
    const fixture = await seed();
    const before = await snapshot(fixture.owner);
    const reader = createLegacyReceiptReplay(sql, {
      enabled: () => true,
      cipher: {
        matches: async (...args) => {
          const matched = await cipher.matches(...args);
          await sql`UPDATE identity.users SET account_state='quarantined' WHERE id=${fixture.owner}`;
          return matched;
        },
      },
    });
    await expect(
      reader.prepare(
        fixture.owner,
        fixture.command.applicationId,
        fixture.command.idempotencyKey,
        "create_packet",
        fixture.originalDigest,
      ),
    ).rejects.toThrow("LegacyReceiptReplayUnavailable");
    expect(await snapshot(fixture.owner)).toEqual(before);
  });
  it("rejects an archive bound to another application atomically", async () => {
    const fixture = await seed(false);
    const other = await store.createApplication({
      ownerUserId: fixture.owner,
      canonicalJobId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    const before = await snapshot(fixture.owner);
    await expect(
      sql.begin(async (tx) => {
        await fixture.marker(tx);
        await fixture.archive(tx, other.view.application.id);
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(fixture.owner)).toEqual(before);
  });
  it("deletes only the authorized owner's archive and invalidates its prepared proof", async () => {
    const doomed = await seed();
    const survivor = await seed();
    const survivorBefore = await snapshot(survivor.owner);
    const reader = createLegacyReceiptReplay(sql, { enabled: () => true, cipher });
    const proof = await reader.prepare(
      doomed.owner,
      doomed.command.applicationId,
      doomed.command.idempotencyKey,
      "create_packet",
      doomed.originalDigest,
    );
    await expect(
      reader.assert(sql, proof, survivor.owner, doomed.command.idempotencyKey, "create_packet"),
    ).rejects.toThrow("LegacyReceiptReplayUnavailable");
    const requestId = uuidv7();
    const operationId = uuidv7();
    const expires = new Date(now.getTime() + 35 * 86400000);
    await sql`INSERT INTO platform.operations (id,user_id,kind,state)
      VALUES (${operationId},${doomed.owner},'account_deletion','queued')`;
    await sql`INSERT INTO profile.account_deletion_requests
      (id,user_id,operation_id,policy_version,state,version,requested_at,updated_at,confirmed_at,backup_expires_at)
      VALUES (${requestId},${doomed.owner},${operationId},'synthetic-legacy-delete-v1','quarantined',2,
      ${now},${now},${now},${expires})`;
    await sql`INSERT INTO privacy.account_deletion_ledger
      (request_id,subject_digest,policy_version,policy_sha256,state,owner_inventory,subprocessor_inventory,
      confirmed_at,backup_expires_at,updated_at)
      VALUES (${requestId},${"1".repeat(64)},'synthetic-legacy-delete-v1',${"2".repeat(64)},'quarantined',
      ${sql.json({ applications: "pending" })},${sql.json({})},${now},${expires},${now})`;
    await expect(
      sql`SELECT applications.delete_candidate_data(${survivor.owner}::uuid,${requestId}::uuid)`,
    ).rejects.toMatchObject({ code: "42501" });
    await sql`SELECT applications.delete_candidate_data(${doomed.owner}::uuid,${requestId}::uuid)`;
    expect(
      Object.values(await snapshot(doomed.owner)).every(
        (rows) => Array.isArray(rows) && rows.length === 0,
      ),
    ).toBe(true);
    expect(await snapshot(survivor.owner)).toEqual(survivorBefore);
    await expect(
      reader.assert(sql, proof, doomed.owner, doomed.command.idempotencyKey, "create_packet"),
    ).rejects.toThrow("LegacyReceiptReplayUnavailable");
  });
  it("refuses forged proofs and immutable/archive deletion outside privacy authority", async () => {
    const fixture = await seed();
    const reader = createLegacyReceiptReplay(sql, { enabled: () => true, cipher });
    await expect(
      reader.assert(sql, {}, fixture.owner, fixture.command.idempotencyKey, "create_packet"),
    ).rejects.toThrow("LegacyReceiptReplayUnavailable");
    await expect(
      sql`UPDATE applications_restricted.legacy_receipts SET ciphertext=ciphertext WHERE owner_user_id=${fixture.owner}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM applications_restricted.legacy_receipts WHERE owner_user_id=${fixture.owner}`,
    ).rejects.toMatchObject({ code: "55000" });
  });
});
