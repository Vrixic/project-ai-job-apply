import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";
import { PostgresRestrictedAnswerVaultStore } from "./restricted-answer-vault.js";
import { FakeRestrictedAnswerCipher } from "./restricted-answer-vault-test-cipher.js";

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite("exact restricted-answer selection PostgreSQL", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid", { maxConnections: 2 });
  const cipher = new FakeRestrictedAnswerCipher();
  const writer = new PostgresRestrictedAnswerVaultStore(database.client, cipher);
  afterAll(async () => {
    await database.client.end();
  });

  async function fixture() {
    const userId = uuidv7();
    await database.client`INSERT INTO identity.users (id) VALUES (${userId}::uuid)`;
    const command = {
      userId,
      fieldKey: "authorization.us_authorized",
      context: "us",
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "false",
      sensitivity: "restricted" as const,
      sourceReference: "synthetic.selection",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      idempotencyKey: `selection-${uuidv7()}`,
      traceId: "synthetic.selection",
    };
    const saved = await writer.save(command);
    const reference = { ...saved, fieldKey: command.fieldKey, context: command.context };
    return { userId, command, reference };
  }

  it("reads exact current metadata without KMS and the selected value with KMS", async () => {
    const { userId, reference } = await fixture();
    const metadata = new PostgresRestrictedAnswerVaultStore(database.client, undefined);
    await expect(metadata.readCurrentReference(userId, reference)).resolves.toEqual({
      ...reference,
      validUntilEpochMs: null,
    });
    await expect(writer.readSelectedValue(userId, reference)).resolves.toEqual({
      ...reference,
      validUntilEpochMs: null,
      valueType: "boolean",
      value: "false",
    });
  });

  it("never substitutes a neighbour, context, owner or newer version and does not decrypt failures", async () => {
    const { userId, command, reference } = await fixture();
    const other = await fixture();
    const neighbour = await writer.save({
      ...command,
      context: "eu",
      idempotencyKey: `neighbour-${uuidv7()}`,
    });
    let calls = 0;
    const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
      encrypt: cipher.encrypt.bind(cipher),
      decrypt: async (input) => {
        calls++;
        return cipher.decrypt(input);
      },
    });
    for (const [owner, selection] of [
      [other.userId, reference],
      [userId, { ...reference, fieldKey: "demographic.veteran" }],
      [userId, { ...reference, context: "eu" }],
      [userId, { ...reference, id: neighbour.id }],
      [userId, { ...reference, version: reference.version + 1 }],
    ] as const) {
      await expect(reader.readSelectedValue(owner, selection)).resolves.toBeUndefined();
      await expect(reader.readCurrentReference(owner, selection)).resolves.toBeUndefined();
    }
    await writer.save({
      ...command,
      expectedVersion: reference.version,
      value: "true",
      idempotencyKey: `correction-${uuidv7()}`,
    });
    await expect(reader.readSelectedValue(userId, reference)).resolves.toBeUndefined();
    await expect(reader.readCurrentReference(userId, reference)).resolves.toBeUndefined();
    expect(calls).toBe(0);
    await expect(writer.readSelectedValue(other.userId, other.reference)).resolves.toMatchObject({
      value: "false",
    });
  });

  it.each(["corrected", "deleted", "quarantined"] as const)(
    "withholds the selected value %s during decryption without a SQL lock",
    async (outcome) => {
      const { userId, command, reference } = await fixture();
      const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
        encrypt: cipher.encrypt.bind(cipher),
        decrypt: async (input) => {
          const value = await cipher.decrypt(input);
          if (outcome === "corrected")
            await writer.save({
              ...command,
              expectedVersion: reference.version,
              value: "true",
              idempotencyKey: `correction-${uuidv7()}`,
            });
          if (outcome === "deleted")
            await writer.remove({
              userId,
              id: reference.id,
              expectedVersion: reference.version,
              traceId: "synthetic.delete",
            });
          if (outcome === "quarantined")
            await database.client`UPDATE identity.users SET account_state = 'quarantined',
          quarantined_at = clock_timestamp() WHERE id = ${userId}::uuid`;
          return value;
        },
      });
      await expect(reader.readSelectedValue(userId, reference)).resolves.toBeUndefined();
      await expect(reader.readCurrentReference(userId, reference)).resolves.toBeUndefined();
    },
  );

  it("withholds an already expired selection before KMS", async () => {
    const { userId, command, reference } = await fixture();
    const saved = await writer.save({
      ...command,
      expectedVersion: reference.version,
      expiresAt: new Date("2020-01-02T00:00:00Z"),
      idempotencyKey: `expired-${uuidv7()}`,
    });
    const expired = { ...reference, version: saved.version };
    await expect(
      new PostgresRestrictedAnswerVaultStore(database.client, undefined).readSelectedValue(
        userId,
        expired,
      ),
    ).resolves.toBeUndefined();
    await expect(writer.readCurrentReference(userId, expired)).resolves.toBeUndefined();
  });

  it("carries the immutable expiry deadline and withholds a selection expiring during KMS", async () => {
    const { userId, command, reference } = await fixture();
    const [time] = await database.client<
      Array<{ deadline: string }>
    >`SELECT (clock_timestamp() + interval '3 seconds')::text AS deadline`;
    if (!time) throw new Error("SyntheticDeadlineMissing");
    const expiresAt = new Date(time.deadline);
    const saved = await writer.save({
      ...command,
      expectedVersion: reference.version,
      expiresAt,
      idempotencyKey: `future-${uuidv7()}`,
    });
    const selected = { ...reference, version: saved.version };
    const receipt = await writer.readCurrentReference(userId, selected);
    expect(receipt?.validUntilEpochMs).toBe(expiresAt.getTime());
    const reader = new PostgresRestrictedAnswerVaultStore(database.client, {
      encrypt: cipher.encrypt.bind(cipher),
      decrypt: async (input) => {
        const value = await cipher.decrypt(input);
        await database.client`SELECT pg_sleep(greatest(0, extract(epoch FROM ${expiresAt.toISOString()}::timestamptz - clock_timestamp())) + 0.05)`;
        return value;
      },
    });
    await expect(reader.readSelectedValue(userId, selected)).resolves.toBeUndefined();
    await expect(reader.readCurrentReference(userId, selected)).resolves.toBeUndefined();
  });

  it("invalidates a selected revision even when a correction keeps the same value", async () => {
    const { userId, command, reference } = await fixture();
    const next = await writer.save({
      ...command,
      expectedVersion: reference.version,
      idempotencyKey: `same-value-${uuidv7()}`,
    });
    await expect(writer.readSelectedValue(userId, reference)).resolves.toBeUndefined();
    await expect(writer.readCurrentReference(userId, reference)).resolves.toBeUndefined();
    await expect(
      writer.readSelectedValue(userId, { ...reference, version: next.version }),
    ).resolves.toMatchObject({ value: "false", version: next.version });
  });
});
