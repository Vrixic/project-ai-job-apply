import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PacketInvariantError } from "./packet.js";
import {
  createFixtureApplication,
  createIntegrationApplicationStore,
} from "./restricted-packet-integration-support.js";
import { definitions, FACT_A, HASH_A, HASH_B, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const execute = promisify(execFile);
(databaseUrl ? describe : describe.skip)("document material persistence boundary", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 3,
    onnotice: () => undefined,
  });
  const store = createIntegrationApplicationStore(client, undefined, { definitions });
  beforeAll(async () => {
    for (const owner of ["profile", "applications"])
      await execute(
        process.execPath,
        [fileURLToPath(new URL(`../../${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: { ...process.env, DATABASE_URL: databaseUrl } },
      );
  });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });
  async function fixture() {
    const ownerUserId = uuidv7();
    const created = await createFixtureApplication(store, client, {
      ownerUserId,
      canonicalJobId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    return { ownerUserId, app: created.view.application };
  }
  it("rolls back rejected material without packet, receipt, history or outbox effects", async () => {
    const f = await fixture();
    const key = uuidv7();
    await expect(
      store.createPacket({
        ownerUserId: f.ownerUserId,
        applicationId: f.app.id,
        expectedRevision: f.app.revision,
        idempotencyKey: key,
        packet: {
          jobRevision: HASH_A,
          form: null,
          artifactHashes: { coverLetter: HASH_A },
          fields: [
            proposal({
              fieldKey: "documents.cover_letter",
              origin: "generated",
              value: "Synthetic forbidden material",
            }),
          ],
        },
      }),
    ).rejects.toBeInstanceOf(PacketInvariantError);
    expect((await store.getApplication(f.ownerUserId, f.app.id)).application).toMatchObject({
      revision: f.app.revision,
      currentPacketId: null,
    });
    const [counts] = await client<
      Array<{ packets: number; history: number; events: number; rejectedReceipts: number }>
    >`SELECT
      (SELECT count(*)::int FROM applications.packets WHERE application_id = ${f.app.id}) AS packets,
      (SELECT count(*)::int FROM applications.history WHERE application_id = ${f.app.id}) AS history,
      (SELECT count(*)::int FROM applications.outbox WHERE application_id = ${f.app.id}) AS events,
      (SELECT count(*)::int FROM applications.command_receipts WHERE application_id = ${f.app.id} AND idempotency_key = ${key}) AS "rejectedReceipts"`;
    expect(counts).toEqual({ packets: 0, history: 1, events: 1, rejectedReceipts: 0 });
  });
  it.each(["documents.cover_letter", "documents.resume"])(
    "SQL rejects material and mismatched bindings for %s",
    async (fieldKey) => {
      const f = await fixture();
      for (const value of ["Synthetic forbidden material", HASH_B, [HASH_A], true]) {
        const field = {
          fieldKey,
          value,
          origin: "generated",
          sourceFactIds: [FACT_A],
          confidence: 1,
          disposition: "review",
          reasons: ["generated_content"],
          requiresReview: true,
        };
        await expect(client`INSERT INTO applications.packets (id, application_id, owner_user_id, version, packet_hash, job_revision, resume_hash, cover_letter_hash, fields, created_at)
        VALUES (${uuidv7()}, ${f.app.id}, ${f.ownerUserId}, 1, ${HASH_A}, ${HASH_A}, ${HASH_A}, ${HASH_A}, ${client.json([field])}, now())`).rejects.toMatchObject(
          { code: "23514", constraint_name: "packets_document_field_hashes_ck" },
        );
      }
      const [row] = await client<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM applications.packets WHERE application_id = ${f.app.id}`;
      expect(row?.count).toBe(0);
    },
  );
  it("validating the forward migration refuses legacy material without rewriting it", async () => {
    const f = await fixture();
    const id = uuidv7();
    const fields = [{ fieldKey: "documents.cover_letter", value: "Synthetic legacy material" }];
    const migration = await readFile(
      new URL("../migrations/0007_document_field_hashes.sql", import.meta.url),
      "utf8",
    );
    await expect(
      client.begin(async (transaction) => {
        // Restore the pre-0007 boundary only inside this rolled-back synthetic transaction.
        await transaction`ALTER TABLE applications.packets DROP CONSTRAINT packets_document_field_hashes_ck`;
        await transaction`ALTER TABLE applications.packets DROP CONSTRAINT packets_restricted_fields_ck`;
        await transaction`INSERT INTO applications.packets (id, application_id, owner_user_id, version, packet_hash, job_revision, cover_letter_hash, fields, created_at)
        VALUES (${id}, ${f.app.id}, ${f.ownerUserId}, 1, ${HASH_A}, ${HASH_A}, ${HASH_A}, ${transaction.json(fields)}, now())`;
        await expect(
          transaction.savepoint(async (savepoint) => {
            await savepoint.unsafe(migration);
          }),
        ).rejects.toMatchObject({
          code: "23514",
          constraint_name: "packets_document_field_hashes_ck",
        });
        const [unchanged] =
          await transaction`SELECT fields FROM applications.packets WHERE id = ${id}`;
        expect(unchanged?.fields).toEqual(fields);
        throw Error("SyntheticLegacyFixtureRollback");
      }),
    ).rejects.toThrow("SyntheticLegacyFixtureRollback");
    const [guard] =
      await client`SELECT convalidated FROM pg_constraint WHERE conrelid = 'applications.packets'::regclass AND conname = 'packets_document_field_hashes_ck'`;
    expect(guard?.convalidated).toBe(true);
    const [restrictedGuard] =
      await client`SELECT convalidated FROM pg_constraint WHERE conrelid = 'applications.packets'::regclass AND conname = 'packets_restricted_fields_ck'`;
    expect(restrictedGuard?.convalidated).toBe(true);
  });
  it("SQL accepts exact bound hash metadata and unresolved nulls; migration replays", async () => {
    const f = await fixture();
    const fields = [
      {
        fieldKey: "documents.cover_letter",
        value: HASH_A,
        origin: "generated",
        sourceFactIds: [FACT_A],
        confidence: 1,
        disposition: "review",
        reasons: ["generated_content"],
        requiresReview: true,
      },
      {
        fieldKey: "documents.resume",
        value: null,
        origin: "user_entered",
        sourceFactIds: [],
        confidence: 1,
        disposition: "user_action",
        reasons: ["unsupported_value"],
        requiresReview: true,
      },
    ];
    await client`INSERT INTO applications.packets (id, application_id, owner_user_id, version, packet_hash, job_revision, cover_letter_hash, fields, created_at)
      VALUES (${uuidv7()}, ${f.app.id}, ${f.ownerUserId}, 1, ${HASH_A}, ${HASH_A}, ${HASH_A}, ${client.json(fields)}, now())`;
    const replay = await execute(
      process.execPath,
      [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    expect(replay.stdout).toContain("through 0010_native_resume_requests applied and verified");
  });
});
