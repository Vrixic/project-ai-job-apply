import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";
import { PostgresRestrictedAnswerExportReader } from "./restricted-answer-export.js";
import {
  PostgresRestrictedAnswerVaultStore,
  RestrictedAnswerVaultConflictError,
  RestrictedAnswerVaultIdempotencyConflictError,
  RestrictedAnswerVaultNotFoundError,
} from "./restricted-answer-vault.js";
import { FakeRestrictedAnswerCipher } from "./restricted-answer-vault-test-cipher.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

async function createUser(client: ReturnType<typeof createDatabase>["client"]): Promise<string> {
  const id = uuidv7();
  await client`INSERT INTO identity.users (id) VALUES (${id}::uuid)`;
  return id;
}

describeWithDatabase("PostgresRestrictedAnswerVaultStore", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const cipher = new FakeRestrictedAnswerCipher();
  const store = new PostgresRestrictedAnswerVaultStore(database.client, cipher);

  it.each(["unchanged", "corrected", "deleted"] as const)(
    "export keeps the original %s answer binding when a caller retargets during decryption",
    async (outcome) => {
      const userId = await createUser(database.client);
      const command = {
        userId,
        fieldKey: "authorization.us_authorized",
        context: "us",
        expectedVersion: 0,
        valueType: "boolean" as const,
        value: "false",
        sensitivity: "restricted" as const,
        sourceReference: "synthetic.export-reference",
        confirmedAt: new Date("2020-01-01T00:00:00Z"),
        expiresAt: new Date("2020-01-02T00:00:00Z"),
        idempotencyKey: `export-reference-${userId}`,
        traceId: "synthetic.export-reference",
      };
      const original = await store.save(command);
      const neighbourCommand = {
        ...command,
        fieldKey: "authorization.sponsorship_required",
        context: "us",
        value: "true",
        idempotencyKey: `export-neighbour-${userId}`,
      };
      const neighbour = await store.save(neighbourCommand);
      const neighbourCurrent = await store.save({
        ...neighbourCommand,
        expectedVersion: 1,
        idempotencyKey: `export-neighbour-corrected-${userId}`,
      });
      const reference = { ...original, fieldKey: command.fieldKey, context: command.context };
      let decryptCalls = 0;
      const reader = new PostgresRestrictedAnswerExportReader(database.client, {
        decrypt: async (input) => {
          decryptCalls++;
          expect(input).toMatchObject({
            userId,
            fieldKey: command.fieldKey,
            context: command.context,
          });
          const value = await cipher.decrypt(input);
          if (outcome === "corrected") {
            await store.save({
              ...command,
              expectedVersion: 1,
              value: "true",
              idempotencyKey: `export-original-corrected-${userId}`,
            });
          } else if (outcome === "deleted") {
            await store.remove({
              userId,
              id: original.id,
              expectedVersion: 1,
              traceId: command.traceId,
            });
          }
          // The neighbouring entry is live and has a different ID, version and field.
          // The old implementation could validate it while returning original plaintext.
          Object.assign(reference, {
            ...neighbourCurrent,
            fieldKey: neighbourCommand.fieldKey,
            context: "ca",
          });
          return value;
        },
      });
      const result = reader.readValue(userId, reference);
      if (outcome === "unchanged") await expect(result).resolves.toBe("false");
      else await expect(result).rejects.toThrow("RestrictedAnswerExportSnapshotChanged");
      expect(decryptCalls).toBe(1);
      expect(neighbourCurrent).toEqual({ id: neighbour.id, version: 2 });
      expect(
        await new PostgresRestrictedAnswerExportReader(database.client, cipher).readValue(userId, {
          ...neighbourCurrent,
          fieldKey: neighbourCommand.fieldKey,
          context: neighbourCommand.context,
        }),
      ).toBe("true");
    },
  );

  it.each(["before", "during"] as const)(
    "withholds reuse when the owner is quarantined %s decryption",
    async (timing) => {
      const userId = await createUser(database.client);
      const command = {
        userId,
        fieldKey: "authorization.us_authorized",
        expectedVersion: 0,
        valueType: "boolean" as const,
        value: "true",
        sensitivity: "restricted" as const,
        sourceReference: "synthetic.quarantine-reuse",
        confirmedAt: new Date("2020-01-01T00:00:00Z"),
        idempotencyKey: `quarantine-reuse-${userId}`,
        traceId: "synthetic.quarantine-reuse",
      };
      const saved = await store.save(command);
      const quarantine = async () => {
        await database.client`
          UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp()
          WHERE id = ${userId}::uuid
        `;
      };
      if (timing === "before") await quarantine();
      let decryptCalls = 0;
      const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
        encrypt: cipher.encrypt.bind(cipher),
        decrypt: async (input) => {
          decryptCalls++;
          const value = await cipher.decrypt(input);
          // This update must commit without waiting for a lock held across KMS.
          await quarantine();
          return value;
        },
      });
      expect(
        await reader.readActiveValue({ userId, fieldKey: "authorization.us_authorized" }),
      ).toBeUndefined();
      expect(decryptCalls).toBe(timing === "before" ? 0 : 1);
      const [retained] = await database.client<Array<{ version: number; state: string }>>`
        SELECT version, state FROM profile.restricted_answer_versions
        WHERE answer_id = ${saved.id}::uuid ORDER BY version DESC LIMIT 1
      `;
      expect(retained).toEqual({ version: 1, state: "active" });
      const unaffectedOwner = await createUser(database.client);
      const otherSaved = await store.save({ ...command, userId: unaffectedOwner });
      expect(
        await store.readActiveValue({
          userId: unaffectedOwner,
          fieldKey: "authorization.us_authorized",
        }),
      ).toEqual({ ...otherSaved, valueType: "boolean", value: "true" });
    },
  );

  it("withholds expired reuse values without decrypting, but preserves export portability", async () => {
    const userId = await createUser(database.client);
    const saved = await store.save({
      userId,
      fieldKey: "authorization.us_authorized",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "synthetic.reuse",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-01-02T00:00:00Z"),
      idempotencyKey: `reuse-expired-${userId}`,
      traceId: "synthetic.reuse",
    });
    let decryptCalls = 0;
    const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
      encrypt: cipher.encrypt.bind(cipher),
      decrypt: async (input) => {
        decryptCalls++;
        return cipher.decrypt(input);
      },
    });
    expect(
      await reader.readActiveValue({ userId, fieldKey: "authorization.us_authorized" }),
    ).toBeUndefined();
    expect(decryptCalls).toBe(0);
    expect((await reader.list(userId))[0]).toMatchObject({ id: saved.id, state: "active" });
    const exporter = new PostgresRestrictedAnswerExportReader(database.client, cipher);
    expect(
      await exporter.readValue(userId, { ...saved, fieldKey: "authorization.us_authorized" }),
    ).toBe("true");
  });

  it.each(["correction", "deletion"] as const)(
    "withholds reuse after concurrent %s during decryption without holding a SQL lock",
    async (change) => {
      const userId = await createUser(database.client);
      const command = {
        userId,
        fieldKey: "authorization.us_authorized",
        expectedVersion: 0,
        valueType: "boolean" as const,
        value: "true",
        sensitivity: "restricted" as const,
        sourceReference: "synthetic.reuse",
        confirmedAt: new Date("2020-01-01T00:00:00Z"),
        idempotencyKey: `reuse-race-${userId}`,
        traceId: "synthetic.reuse",
      };
      const saved = await store.save(command);
      const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
        encrypt: cipher.encrypt.bind(cipher),
        decrypt: async (input) => {
          const value = await cipher.decrypt(input);
          if (change === "correction") {
            await store.save({
              ...command,
              expectedVersion: 1,
              value: "false",
              idempotencyKey: `reuse-correct-${userId}`,
            });
          } else {
            await store.remove({
              userId,
              id: saved.id,
              expectedVersion: 1,
              traceId: command.traceId,
            });
          }
          return value;
        },
      });
      expect(await reader.readActiveValue({ userId, fieldKey: command.fieldKey })).toBeUndefined();
      expect(await store.readActiveValue({ userId, fieldKey: command.fieldKey })).toEqual(
        change === "correction"
          ? { id: saved.id, version: 2, valueType: "boolean", value: "false" }
          : undefined,
      );
    },
  );

  it("withholds reuse when database expiry passes during decryption", async () => {
    const userId = await createUser(database.client);
    const [time] = await database.client<
      Array<{ expires: string }>
    >`SELECT (clock_timestamp() + interval '3 seconds')::text AS expires`;
    if (!time) throw new Error("Synthetic database clock unavailable");
    const expiresAt = new Date(time.expires);
    await store.save({
      userId,
      fieldKey: "authorization.us_authorized",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "synthetic.reuse",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt,
      idempotencyKey: `reuse-expiry-race-${userId}`,
      traceId: "synthetic.reuse",
    });
    let decryptCalls = 0;
    const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
      encrypt: cipher.encrypt.bind(cipher),
      decrypt: async (input) => {
        decryptCalls++;
        const value = await cipher.decrypt(input);
        await database.client`SELECT pg_sleep(GREATEST(0, extract(epoch from (${expiresAt.toISOString()}::timestamptz - clock_timestamp())))::double precision + 0.01)`;
        return value;
      },
    });
    expect(
      await reader.readActiveValue({ userId, fieldKey: "authorization.us_authorized" }),
    ).toBeUndefined();
    expect(decryptCalls).toBe(1);
  });

  it("exports only the exact latest owner value, including expired answers, and refuses tombstones", async () => {
    const userId = await createUser(database.client);
    const otherUserId = await createUser(database.client);
    const command = {
      userId,
      fieldKey: "authorization.us_authorized",
      context: "us",
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "false",
      sensitivity: "restricted" as const,
      sourceReference: "candidate.settings",
      confirmedAt: new Date("2026-01-01T12:00:00.000Z"),
      expiresAt: new Date("2026-01-02T12:00:00.000Z"),
      idempotencyKey: `synthetic-export-${userId}`,
      traceId: "synthetic-export",
    };
    const created = await store.save(command);
    const reader = new PostgresRestrictedAnswerExportReader(database.client, cipher);
    const reference = { ...created, fieldKey: command.fieldKey, context: command.context };
    await expect(reader.readValue(userId, reference)).resolves.toBe("false");
    await expect(reader.readValue(otherUserId, reference)).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    await expect(reader.readValue(userId, { ...reference, context: "eu" })).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    const corrected = await store.save({
      ...command,
      expectedVersion: 1,
      value: "true",
      idempotencyKey: `synthetic-correct-${userId}`,
    });
    await expect(reader.readValue(userId, reference)).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    await expect(
      reader.readValue(userId, { ...reference, version: corrected.version }),
    ).resolves.toBe("true");
    await store.remove({
      userId,
      id: created.id,
      expectedVersion: corrected.version,
      traceId: "synthetic-delete",
    });
    await expect(reader.readValue(userId, { ...reference, version: 3 })).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    await expect(reader.readValue(userId, { ...reference, version: 2 })).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
  });

  it("refuses an answer deleted while KMS decryption was pending", async () => {
    const userId = await createUser(database.client);
    const created = await store.save({
      userId,
      fieldKey: "demographic.veteran",
      expectedVersion: 0,
      valueType: "enum",
      value: "synthetic-decline",
      sensitivity: "restricted",
      sourceReference: "candidate.settings",
      confirmedAt: new Date(),
      idempotencyKey: `synthetic-race-${userId}`,
      traceId: "synthetic-race",
    });
    const reader = new PostgresRestrictedAnswerExportReader(database.client, {
      decrypt: async (input) => {
        const value = await cipher.decrypt(input);
        await store.remove({
          userId,
          id: created.id,
          expectedVersion: 1,
          traceId: "synthetic-race-delete",
        });
        return value;
      },
    });
    await expect(
      reader.readValue(userId, { ...created, fieldKey: "demographic.veteran" }),
    ).rejects.toThrow("RestrictedAnswerExportSnapshotChanged");
  });

  async function authorizeCandidateDeletion(userId: string): Promise<string> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    await database.client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}::uuid, ${userId}::uuid, 'account_deletion', 'queued')
    `;
    await database.client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${userId}::uuid, ${operationId}::uuid,
        'restricted-answer-vault-test.v1', 'quarantined', 1,
        '2026-09-01T15:00:00.000Z'::timestamptz,
        '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    await database.client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${"1".repeat(64)}, 'restricted-answer-vault-test.v1',
        ${"2".repeat(64)}, 'quarantined', ${JSON.stringify({ profile: "pending" })}::jsonb,
        ${JSON.stringify({})}::jsonb, '2026-09-01T15:00:00.000Z'::timestamptz,
        '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    return requestId;
  }

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const migrationEnvironment = { ...process.env, DATABASE_URL: databaseUrl };
    await execFileAsync(process.execPath, [migrationExecutable], { env: migrationEnvironment });
  });

  afterAll(async () => {
    await database.client.end();
  });

  it("verifies a real SQL export against independent list metadata and synthetic saved values", async () => {
    const userId = await createUser(database.client);
    const valueByField = new Map([
      ["authorization.us_authorized", "false"],
      ["authorization.sponsorship_required", "false"],
    ]);
    const base = {
      userId,
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "true",
      sensitivity: "restricted" as const,
      sourceReference: "synthetic.timestamp-acceptance",
      confirmedAt: new Date("2026-01-01T12:00:00.000Z"),
      traceId: "synthetic.timestamp-acceptance",
    };
    const active = await store.save({
      ...base,
      fieldKey: "authorization.us_authorized",
      idempotencyKey: `active-${userId}`,
    });
    await store.save({
      ...base,
      fieldKey: "authorization.us_authorized",
      expectedVersion: active.version,
      value: "false",
      idempotencyKey: `revised-${userId}`,
    });
    await store.save({
      ...base,
      fieldKey: "authorization.sponsorship_required",
      value: "false",
      expiresAt: new Date("2026-01-02T12:00:00.000Z"),
      idempotencyKey: `expired-${userId}`,
    });
    const deleted = await store.save({
      ...base,
      fieldKey: "disclosure.non_compete",
      idempotencyKey: `deleted-${userId}`,
    });
    await store.remove({
      userId,
      id: deleted.id,
      expectedVersion: deleted.version,
      traceId: base.traceId,
    });
    // Prepare expectations from owner-list metadata and the independently known write values,
    // before obtaining the SQL export. Never populate expectations from the artifact under test.
    const snapshot = (await store.list(userId)).map((entry) => ({
      ...entry,
      ...(entry.state === "active" ? { value: valueByField.get(entry.fieldKey) } : {}),
    }));
    const [exported] = await database.client<
      Array<{
        data: {
          profile: {
            restrictedAnswers: Array<{
              id: string;
              fieldKey: string;
              version: number;
              state: string;
              value?: string;
            }>;
          };
        };
      }>
    >`
      SELECT profile.export_candidate_data(${userId}::uuid) AS data
    `;
    if (!exported) throw new Error("SyntheticExportMissing");
    const reader = new PostgresRestrictedAnswerExportReader(database.client, cipher);
    for (const entry of exported.data.profile.restrictedAnswers) {
      if (entry.state === "active") entry.value = await reader.readValue(userId, entry);
    }
    const at = new Date().toISOString();
    const artifact = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: "019d04cf-1f80-7000-8000-000000000040",
      policyVersion: "d2-development-synthetic-v1",
      generatedAt: at,
      candidate: { email: "synthetic@example.test", createdAt: at, connectedAccounts: [] },
      profile: exported.data.profile,
      documents: { resumes: [] },
      jobs: { reports: [], contributions: [] },
      matching: { savedJobs: [], privateSavedPageCaptures: [] },
      billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
      trust: { schemaVersion: 1, cases: [], caseEvents: [], contributorReputationEvidence: [] },
      audit: { events: [] },
    };
    const checkerUrl = new URL(
      "../../../../scripts/lib/candidate-rights-export.mjs",
      import.meta.url,
    );
    const { validateRestrictedAnswerExport } = await import(checkerUrl.href);
    expect(
      validateRestrictedAnswerExport(Buffer.from(JSON.stringify(artifact)), {
        expectedExportId: artifact.exportId,
        expectedPolicyVersion: artifact.policyVersion,
        expectedRestrictedAnswers: snapshot,
      }),
    ).toEqual({
      valid: true,
      activeValueCount: 1,
      expiredValueCount: 1,
      deletedTombstoneCount: 1,
      revisedValueCount: 1,
    });
  });

  it("lists the export-exact creation timestamp unchanged across correction and deletion", async () => {
    const userId = await createUser(database.client);
    const otherUserId = await createUser(database.client);
    const command = {
      userId,
      fieldKey: "authorization.us_authorized",
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "true",
      sensitivity: "restricted" as const,
      sourceReference: "synthetic.created-at",
      confirmedAt: new Date("2026-01-01T12:00:00.000Z"),
      idempotencyKey: `created-at-${userId}`,
      traceId: "synthetic.created-at",
    };
    const created = await store.save(command);
    // Metadata reads must work without any KMS cipher or decryption.
    const metadataStore = new PostgresRestrictedAnswerVaultStore(database.client, undefined);
    const [initial] = await metadataStore.list(userId);
    expect(initial?.createdAt).toBeDefined();
    const [exported] = await database.client<
      Array<{ data: { profile: { restrictedAnswers: Array<{ id: string; createdAt: string }> } } }>
    >`SELECT profile.export_candidate_data(${userId}::uuid) AS data`;
    expect(initial?.createdAt).toBe(exported?.data.profile.restrictedAnswers[0]?.createdAt);
    expect(await metadataStore.list(otherUserId)).toEqual([]);
    await store.save({
      ...command,
      expectedVersion: 1,
      value: "false",
      idempotencyKey: `correct-created-at-${userId}`,
    });
    const [corrected] = await metadataStore.list(userId);
    expect(corrected).toMatchObject({ version: 2, createdAt: initial?.createdAt });
    await store.remove({ userId, id: created.id, expectedVersion: 2, traceId: command.traceId });
    const [deleted] = await metadataStore.list(userId);
    expect(deleted).toMatchObject({ state: "deleted", version: 3, createdAt: initial?.createdAt });
    expect(JSON.stringify(deleted)).not.toMatch(/ciphertext|kmsKeyId|"value"/u);
  });

  it("creates an entry, lists it without the plaintext, and returns the plaintext only through readActiveValue", async () => {
    const userId = await createUser(database.client);
    const confirmedAt = new Date("2026-09-28T12:00:00.000Z");
    const created = await store.save({
      userId,
      fieldKey: "authorization.us_authorized",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt,
      idempotencyKey: "trace-create-idempotency-key",
      traceId: "trace-create",
    });
    expect(created.version).toBe(1);

    const summaries = await store.list(userId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: created.id,
      fieldKey: "authorization.us_authorized",
      valueType: "boolean",
      sensitivity: "restricted",
      state: "active",
      version: 1,
    });
    expect(JSON.stringify(summaries)).not.toContain("true");

    const value = await store.readActiveValue({ userId, fieldKey: "authorization.us_authorized" });
    expect(value).toEqual({ id: created.id, version: 1, valueType: "boolean", value: "true" });
  });

  it("corrects an existing entry in place under the caller's expected version, never creating a duplicate", async () => {
    const userId = await createUser(database.client);
    const created = await store.save({
      userId,
      fieldKey: "demographic.veteran",
      expectedVersion: 0,
      valueType: "enum",
      value: "not_disclosed",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-create-idempotency-key",
      traceId: "trace-create",
    });
    const corrected = await store.save({
      userId,
      fieldKey: "demographic.veteran",
      expectedVersion: created.version,
      valueType: "enum",
      value: "veteran",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T13:00:00.000Z"),
      idempotencyKey: "trace-correct-idempotency-key",
      traceId: "trace-correct",
    });
    expect(corrected).toEqual({ id: created.id, version: 2 });

    const summaries = await store.list(userId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.version).toBe(2);
    const value = await store.readActiveValue({ userId, fieldKey: "demographic.veteran" });
    expect(value?.value).toBe("veteran");
  });

  it("refuses a save at a stale expected version instead of silently overwriting", async () => {
    const userId = await createUser(database.client);
    const created = await store.save({
      userId,
      fieldKey: "authorization.export_control",
      expectedVersion: 0,
      valueType: "enum",
      value: "eligible",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-1-idempotency-key",
      traceId: "trace-1",
    });
    expect(created.version).toBe(1);
    await expect(
      store.save({
        userId,
        fieldKey: "authorization.export_control",
        expectedVersion: 0,
        valueType: "enum",
        value: "not_eligible",
        sensitivity: "restricted",
        sourceReference: "application-review-panel",
        confirmedAt: new Date("2026-09-28T13:00:00.000Z"),
        idempotencyKey: "trace-2-idempotency-key",
        traceId: "trace-2",
      }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultConflictError);
    const value = await store.readActiveValue({ userId, fieldKey: "authorization.export_control" });
    expect(value?.value).toBe("eligible");
  });

  it("keeps the same entry for two different contexts and two different owners separate", async () => {
    const userA = await createUser(database.client);
    const userB = await createUser(database.client);
    await store.save({
      userId: userA,
      fieldKey: "authorization.sponsorship_required",
      context: "us",
      expectedVersion: 0,
      valueType: "boolean",
      value: "false",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-us-idempotency-key",
      traceId: "trace-us",
    });
    await store.save({
      userId: userA,
      fieldKey: "authorization.sponsorship_required",
      context: "eu",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-eu-idempotency-key",
      traceId: "trace-eu",
    });
    await store.save({
      userId: userB,
      fieldKey: "authorization.sponsorship_required",
      context: "us",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-other-owner-idempotency-key",
      traceId: "trace-other-owner",
    });

    expect(await store.list(userA)).toHaveLength(2);
    expect(
      (
        await store.readActiveValue({
          userId: userA,
          fieldKey: "authorization.sponsorship_required",
          context: "us",
        })
      )?.value,
    ).toBe("false");
    expect(
      (
        await store.readActiveValue({
          userId: userA,
          fieldKey: "authorization.sponsorship_required",
          context: "eu",
        })
      )?.value,
    ).toBe("true");
    expect(
      (
        await store.readActiveValue({
          userId: userB,
          fieldKey: "authorization.sponsorship_required",
          context: "us",
        })
      )?.value,
    ).toBe("true");
    // A candidate with no saved value for a context sees nothing, never another owner's value.
    expect(
      await store.readActiveValue({
        userId: userB,
        fieldKey: "authorization.sponsorship_required",
        context: "eu",
      }),
    ).toBeUndefined();
  });

  it("deletes an entry by carrying its ciphertext forward under a new version, and it stops matching", async () => {
    const userId = await createUser(database.client);
    const created = await store.save({
      userId,
      fieldKey: "disclosure.non_compete",
      expectedVersion: 0,
      valueType: "boolean",
      value: "false",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-1-idempotency-key",
      traceId: "trace-1",
    });
    const removed = await store.remove({
      userId,
      id: created.id,
      expectedVersion: created.version,
      traceId: "trace-delete",
    });
    expect(removed.version).toBe(2);

    expect(
      await store.readActiveValue({ userId, fieldKey: "disclosure.non_compete" }),
    ).toBeUndefined();
    const summaries = await store.list(userId);
    expect(summaries[0]).toMatchObject({ state: "deleted", version: 2 });

    // Deleting is idempotent at the already-deleted version: it returns the same version, not a new one.
    const repeat = await store.remove({
      userId,
      id: created.id,
      expectedVersion: 2,
      traceId: "trace-delete-again",
    });
    expect(repeat.version).toBe(2);
  });

  it("refuses to delete another owner's entry, and refuses an unknown id, as not found", async () => {
    const owner = await createUser(database.client);
    const other = await createUser(database.client);
    const created = await store.save({
      userId: owner,
      fieldKey: "disclosure.conflict_of_interest",
      expectedVersion: 0,
      valueType: "boolean",
      value: "false",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-1-idempotency-key",
      traceId: "trace-1",
    });
    await expect(
      store.remove({
        userId: other,
        id: created.id,
        expectedVersion: 1,
        traceId: "trace-cross-owner",
      }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultNotFoundError);
    await expect(
      store.remove({ userId: owner, id: uuidv7(), expectedVersion: 1, traceId: "trace-unknown" }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultNotFoundError);
  });

  it("immutably rejects any direct update of a stored version", async () => {
    const userId = await createUser(database.client);
    const created = await store.save({
      userId,
      fieldKey: "demographic.disability",
      expectedVersion: 0,
      valueType: "enum",
      value: "not_disclosed",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-1-idempotency-key",
      traceId: "trace-1",
    });
    await expect(
      database.client`
        UPDATE profile.restricted_answer_versions SET state = 'deleted'
        WHERE answer_id = ${created.id}::uuid AND version = ${created.version}
      `,
    ).rejects.toThrow(/immutable/);
  });

  it("participates in candidate export (metadata only, never the ciphertext) and deletion", async () => {
    const userId = await createUser(database.client);
    await store.save({
      userId,
      fieldKey: "authorization.us_authorized",
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "trace-1-idempotency-key",
      traceId: "trace-1",
    });

    const [exported] = await database.client<
      Array<{ data: { profile?: { restrictedAnswers?: unknown[] } } }>
    >`
      SELECT profile.export_candidate_data(${userId}::uuid) AS data
    `;
    const restrictedAnswers = exported?.data.profile?.restrictedAnswers as
      | Array<Record<string, unknown>>
      | undefined;
    expect(restrictedAnswers).toHaveLength(1);
    expect(restrictedAnswers?.[0]).toMatchObject({
      fieldKey: "authorization.us_authorized",
      valueType: "boolean",
      sensitivity: "restricted",
      state: "active",
      version: 1,
    });
    expect(JSON.stringify(restrictedAnswers)).not.toMatch(/ciphertext|kmsKeyId/i);

    const requestId = await authorizeCandidateDeletion(userId);
    const [deleted] = await database.client<Array<{ data: { restrictedAnswersDeleted: number } }>>`
      SELECT profile.delete_candidate_data(${userId}::uuid, ${requestId}::uuid) AS data
    `;
    expect(deleted?.data.restrictedAnswersDeleted).toBe(1);
    expect(await store.list(userId)).toEqual([]);
  });

  it("returns the identical response, and calls the cipher only once, when the same idempotency key repeats the same save", async () => {
    const userId = await createUser(database.client);
    const calls: unknown[] = [];
    const countingCipher = {
      encrypt: async (input: Parameters<typeof cipher.encrypt>[0]) => {
        calls.push(input);
        return cipher.encrypt(input);
      },
      decrypt: cipher.decrypt.bind(cipher),
    };
    const countingStore = new PostgresRestrictedAnswerVaultStore(database.client, countingCipher);
    const command = {
      userId,
      fieldKey: "authorization.export_control",
      expectedVersion: 0,
      valueType: "enum" as const,
      value: "eligible",
      sensitivity: "restricted" as const,
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "repeat-save-key-0001",
      traceId: "trace-repeat",
    };
    const first = await countingStore.save(command);
    const second = await countingStore.save(command);
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(await countingStore.list(userId)).toHaveLength(1);
  });

  it("refuses to reuse an idempotency key when a non-value field differs", async () => {
    const userId = await createUser(database.client);
    const base = {
      userId,
      fieldKey: "authorization.export_control",
      expectedVersion: 0,
      valueType: "enum" as const,
      value: "eligible",
      sensitivity: "restricted" as const,
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "reused-key-for-different-request",
      traceId: "trace-a",
    };
    await store.save({ ...base, sourceReference: "application-review-panel" });
    await expect(
      store.save({ ...base, sourceReference: "a-different-source-entirely" }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultIdempotencyConflictError);
  });

  it("does not distinguish two different values under one reused idempotency key (by design: hashing the value would let a row reader brute-force it)", async () => {
    const userId = await createUser(database.client);
    const base = {
      userId,
      fieldKey: "authorization.export_control",
      expectedVersion: 0,
      valueType: "enum" as const,
      sensitivity: "restricted" as const,
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "same-key-different-value",
      traceId: "trace-a",
    };
    await store.save({ ...base, value: "eligible" });
    // Not a conflict: the second call is treated as a retry of the first, and the stored value is
    // unchanged. A client reusing one idempotency key for two different values is its own bug.
    await store.save({ ...base, value: "not_eligible" });
    expect(
      (await store.readActiveValue({ userId, fieldKey: "authorization.export_control" }))?.value,
    ).toBe("eligible");
  });

  it("deletes by field key without the caller ever tracking a version, and is a no-op when nothing is active", async () => {
    const userId = await createUser(database.client);
    expect(
      await store.removeByField({ userId, fieldKey: "demographic.disability", traceId: "trace-1" }),
    ).toEqual({ deleted: false });

    await store.save({
      userId,
      fieldKey: "demographic.disability",
      expectedVersion: 0,
      valueType: "enum",
      value: "not_disclosed",
      sensitivity: "restricted",
      sourceReference: "application-review-panel",
      confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
      idempotencyKey: "field-delete-key-0001",
      traceId: "trace-1",
    });
    expect(
      await store.removeByField({ userId, fieldKey: "demographic.disability", traceId: "trace-2" }),
    ).toEqual({ deleted: true });
    expect(
      await store.readActiveValue({ userId, fieldKey: "demographic.disability" }),
    ).toBeUndefined();
    expect(
      await store.removeByField({ userId, fieldKey: "demographic.disability", traceId: "trace-3" }),
    ).toEqual({ deleted: false });
  });

  it("deletes by field key and context independently, never touching another owner or context", async () => {
    const userA = await createUser(database.client);
    const userB = await createUser(database.client);
    for (const [userId, context] of [
      [userA, "us"],
      [userA, "eu"],
      [userB, "us"],
    ] as const) {
      await store.save({
        userId,
        fieldKey: "authorization.sponsorship_required",
        context,
        expectedVersion: 0,
        valueType: "boolean",
        value: "true",
        sensitivity: "restricted",
        sourceReference: "application-review-panel",
        confirmedAt: new Date("2026-09-28T12:00:00.000Z"),
        idempotencyKey: `field-delete-context-${userId}-${context}`,
        traceId: "trace-1",
      });
    }
    expect(
      await store.removeByField({
        userId: userA,
        fieldKey: "authorization.sponsorship_required",
        context: "us",
        traceId: "trace-delete-us",
      }),
    ).toEqual({ deleted: true });
    expect(
      await store.readActiveValue({
        userId: userA,
        fieldKey: "authorization.sponsorship_required",
        context: "us",
      }),
    ).toBeUndefined();
    expect(
      (
        await store.readActiveValue({
          userId: userA,
          fieldKey: "authorization.sponsorship_required",
          context: "eu",
        })
      )?.value,
    ).toBe("true");
    expect(
      (
        await store.readActiveValue({
          userId: userB,
          fieldKey: "authorization.sponsorship_required",
          context: "us",
        })
      )?.value,
    ).toBe("true");
  });
});
