import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { afterEach, expect, it, vi } from "vitest";
import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";
import { legacyReceiptMetadataHash } from "./legacy-receipt-replay.js";
import { verifyLegacyReceiptRestore } from "./legacy-receipt-restore-verifier.js";

const key = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const refused = /^LegacyReceiptRestoreVerificationUnavailable$/;
type Row = Record<string, unknown>;
afterEach(() => vi.restoreAllMocks());

function present<T>(value: T | undefined): T {
  if (value === undefined) throw Error("MissingSyntheticFixture");
  return value;
}
async function fixture(distinctOwners = false) {
  let transactions = 0,
    enabled = true;
  const buffers: Uint8Array[] = [];
  const send = vi.fn(async (command: unknown) => {
    expect(transactions).toBe(0);
    if (!(command instanceof EncryptCommand) && !(command instanceof DecryptCommand))
      throw Error("UnexpectedCommand");
    const aad = Buffer.from(JSON.stringify([command.input.KeyId, command.input.EncryptionContext]));
    if (command instanceof EncryptCommand) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 8), iv);
      cipher.setAAD(aad);
      const body = Buffer.concat([
        cipher.update(command.input.Plaintext as Uint8Array),
        cipher.final(),
      ]);
      return {
        KeyId: key,
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), body]),
      };
    }
    const bytes = Buffer.from(command.input.CiphertextBlob as Uint8Array);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 8), bytes.subarray(0, 12));
    decipher.setAAD(aad);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    buffers.push(plaintext);
    return { KeyId: key, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", Plaintext: plaintext };
  });
  const writer = createLegacyReceiptKmsCipher({
    encryptionKeyArn: key,
    enabled: () => true,
    testClient: { send },
  });
  const original = Array.from({ length: 7 }, (_, i) => ({
    owner_user_id: uuid(distinctOwners ? i + 1 : 1),
    idempotency_key: `synthetic-receipt-${i}`,
    application_id: uuid(2),
    original_operation: i % 2 ? ("queue_preparation" as const) : ("create_packet" as const),
    response_revision: "9007199254740993",
    outcome_code: null,
    subject_id: uuid(i + 10),
    created_at_exact: "2026-01-01T00:00:00.123456Z",
    request_hash: createHash("sha256").update(`synthetic-${i}`).digest("hex"),
  }));
  const restored: Row[] = [];
  for (const row of original) {
    const protectionId = uuid(restored.length + 30),
      metadata = legacyReceiptMetadataHash(row);
    const envelope = await writer.encrypt(
      {
        ownerUserId: row.owner_user_id,
        applicationId: row.application_id,
        protectionId,
        operation: row.original_operation,
        metadataSha256: metadata,
      },
      row.request_hash,
    );
    restored.push({
      ...row,
      protection_id: protectionId,
      metadata_sha256: metadata,
      encryption_key_arn: key,
      ciphertext: envelope.ciphertext,
      request_hash: createHash("sha256").update(envelope.ciphertext).digest("hex"),
      marker_valid: true,
    });
  }
  send.mockClear();
  const queries: string[] = [];
  const makeClient = (archived: boolean) => ({
    async begin<T>(
      _options: string,
      work: (tx: { unsafe<U extends Row>(query: string): Promise<U[]> }) => Promise<T>,
    ): Promise<T> {
      transactions++;
      try {
        return await work({
          unsafe: async <U extends Row>(query: string) => {
            queries.push(query);
            if (query.includes("count(*)::text"))
              return [{ count: archived ? "15" : "3" }] as unknown as U[];
            if (query.startsWith("SET") || query.includes("synthetic_active_owners")) return [];
            const rows = structuredClone(archived ? restored : original);
            for (const row of rows)
              if ("ciphertext" in row && row.ciphertext instanceof Uint8Array)
                buffers.push(row.ciphertext);
            return rows as unknown as U[];
          },
        });
      } finally {
        transactions--;
      }
    },
  });
  const oldClient = makeClient(false),
    newClient = makeClient(true);
  const cipher = createLegacyReceiptKmsCipher({
    encryptionKeyArn: key,
    enabled: () => enabled,
    readOnly: true,
    testClient: { send },
  });
  const matches = vi.fn(cipher.matches);
  const run = () =>
    verifyLegacyReceiptRestore(oldClient, newClient, {
      encryptionKeyArn: key,
      enabled: () => enabled,
      cipher: { matches },
      verifyActiveOwners: async (tx, owners) => {
        expect(owners.length).toBeLessThanOrEqual(7);
        await tx.unsafe("SELECT synthetic_active_owners");
      },
    });
  return {
    original,
    restored,
    queries,
    buffers,
    matches,
    send,
    run,
    revoke: () => {
      enabled = false;
    },
  };
}

it("proves all seven actual authenticated decrypts outside SQL and clears every transient buffer", async () => {
  const f = await fixture();
  expect(await f.run()).toEqual({ matchedReceipts: 7 });
  expect(f.send).toHaveBeenCalledTimes(7);
  expect(f.send.mock.calls.every(([command]) => command instanceof DecryptCommand)).toBe(true);
  expect(f.queries.filter((q) => q.includes("synthetic_active_owners"))).toHaveLength(4);
  expect(f.buffers.every((b) => b.every((v) => v === 0))).toBe(true);
});
it("authorizes at most the seven captured distinct owners in each read", async () => {
  const f = await fixture(true);
  expect(await f.run()).toEqual({ matchedReceipts: 7 });
  expect(f.queries.filter((q) => q.includes("synthetic_active_owners"))).toHaveLength(4);
});
it.each([
  "owner_user_id",
  "idempotency_key",
  "application_id",
  "original_operation",
  "response_revision",
  "outcome_code",
  "subject_id",
  "created_at_exact",
])("refuses changed original %s metadata", async (field) => {
  const f = await fixture();
  const row = f.original[0] as Row;
  row[field] = field.endsWith("id")
    ? uuid(99)
    : field === "original_operation"
      ? "queue_preparation"
      : field === "response_revision"
        ? "9007199254740994"
        : field === "created_at_exact"
          ? "2026-01-01T00:00:00.123457Z"
          : "synthetic-changed";
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.buffers.every((b) => b.every((v) => v === 0))).toBe(true);
});
it.each(["missing", "extra", "duplicate", "protection", "marker", "ciphertext", "key", "metadata"])(
  "refuses %s archive without decrypt and clears even malformed captured buffers",
  async (failure) => {
    const f = await fixture(),
      row = f.restored[0] as Row;
    if (failure === "missing") f.restored.pop();
    if (failure === "extra") f.restored.push(structuredClone(row));
    if (failure === "duplicate") f.restored[1] = structuredClone(row);
    if (failure === "protection") row.protection_id = f.restored[1]?.protection_id;
    if (failure === "marker") row.marker_valid = false;
    if (failure === "ciphertext")
      (row.ciphertext as Uint8Array)[0] = present((row.ciphertext as Uint8Array)[0]) ^ 1;
    if (failure === "key") row.encryption_key_arn = key.replace("111122223333", "444455556666");
    if (failure === "metadata") row.metadata_sha256 = "f".repeat(64);
    await expect(f.run()).rejects.toThrow(refused);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.buffers.every((b) => b.every((v) => v === 0))).toBe(true);
    if (["extra", "missing", "duplicate", "protection", "marker", "ciphertext"].includes(failure))
      expect(f.queries.filter((q) => q.includes("synthetic_active_owners"))).toHaveLength(1);
  },
);
it("detects the wrong original digest using actual decrypt", async () => {
  const f = await fixture();
  present(f.original[0]).request_hash = "e".repeat(64);
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.send).toHaveBeenCalledTimes(1);
});
it("detects a protection-context substitution even when all row checks pass", async () => {
  const f = await fixture();
  present(f.restored[0]).protection_id = uuid(99);
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.send).toHaveBeenCalledTimes(1);
});
it("rechecks SQL bindings after decrypt completion", async () => {
  const f = await fixture();
  const real = present(f.matches.getMockImplementation());
  f.matches.mockImplementation(async (...args) => {
    const result = await real(...args);
    present(f.original[0]).outcome_code = "changed" as never;
    return result;
  });
  await expect(f.run()).rejects.toThrow(refused);
});
it("awaits admitted crypto settlement then stops before the next call on withdrawal", async () => {
  const f = await fixture();
  let release!: () => void;
  f.matches.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return true;
  });
  let settled = false;
  const running = f.run().finally(() => {
    settled = true;
  });
  for (let i = 0; i < 30 && !release; i++) await Promise.resolve();
  f.revoke();
  expect(settled).toBe(false);
  release();
  await expect(running).rejects.toThrow(refused);
  expect(f.matches).toHaveBeenCalledTimes(1);
  expect(f.buffers.every((b) => b.every((v) => v === 0))).toBe(true);
});
it("stops before another SQL call when its deadline expires", async () => {
  const f = await fixture();
  let tick = 0;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => (++tick < 5 ? 0n : 60_000_000_000n));
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.queries).toHaveLength(2);
});
