import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { afterEach, expect, it, vi } from "vitest";
import { createLegacyReceiptKmsCipher, type LegacyReceiptScope } from "./legacy-receipt-cipher.js";

const key = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
const nextKey = "arn:aws:kms:us-east-2:111122223333:key/22222222-2222-4222-8222-222222222222";
const scope: LegacyReceiptScope = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  applicationId: "22222222-2222-4222-8222-222222222222",
  protectionId: "33333333-3333-4333-8333-333333333333",
  operation: "create_packet",
  metadataSha256: "a".repeat(64),
};
const original = "b".repeat(64);
const unavailable = "LegacyReceiptProtectionUnavailable";

/** Simulated KMS transport with actual authenticated local encryption, not live AWS evidence. */
function transport() {
  const buffers: Uint8Array[] = [];
  const send = vi.fn(async (command: unknown, _options: { abortSignal: AbortSignal }) => {
    if (!(command instanceof EncryptCommand) && !(command instanceof DecryptCommand))
      throw Error("UnexpectedSyntheticCommand");
    const aad = Buffer.from(JSON.stringify([command.input.KeyId, command.input.EncryptionContext]));
    if (command instanceof EncryptCommand) {
      const input = command.input.Plaintext as Uint8Array;
      buffers.push(input);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 8), iv);
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(input), cipher.final()]);
      return {
        KeyId: command.input.KeyId,
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), body]),
      };
    }
    const input = Buffer.from(command.input.CiphertextBlob as Uint8Array);
    const cipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 8), input.subarray(0, 12));
    cipher.setAAD(aad);
    cipher.setAuthTag(input.subarray(12, 28));
    const plaintext = Buffer.concat([cipher.update(input.subarray(28)), cipher.final()]);
    buffers.push(plaintext);
    return {
      KeyId: command.input.KeyId,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      Plaintext: plaintext,
    };
  });
  return { send, buffers };
}
function setup(extra: Partial<Parameters<typeof createLegacyReceiptKmsCipher>[0]> = {}) {
  const client = transport();
  return {
    ...client,
    cipher: createLegacyReceiptKmsCipher({
      encryptionKeyArn: key,
      enabled: () => true,
      testClient: client,
      ...extra,
    }),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("preserves the original digest under randomized encryption and exposes only a match result", async () => {
  const { cipher, send, buffers } = setup();
  const first = await cipher.encrypt(scope, original);
  const second = await cipher.encrypt(scope, original);
  expect(first.ciphertext).not.toEqual(second.ciphertext);
  expect(Buffer.from(first.ciphertext).includes(Buffer.from(original))).toBe(false);
  expect(Object.keys(first).sort()).toEqual(["ciphertext", "encryptionKeyArn", "schemaVersion"]);
  expect(await cipher.matches(scope, first, original)).toBe(true);
  expect(await cipher.matches(scope, first, "c".repeat(64))).toBe(false);
  expect(Object.keys(cipher)).toEqual(["encrypt", "matches"]);
  for (const bytes of buffers) expect(bytes.every((value) => value === 0)).toBe(true);
  const command = send.mock.calls[0]?.[0] as EncryptCommand;
  expect(command.input.EncryptionContext).toEqual({
    purpose: "restricted-legacy-application-receipt.v1",
    owner_user_id: scope.ownerUserId,
    application_id: scope.applicationId,
    protection_id: scope.protectionId,
    operation: scope.operation,
    metadata_sha256: scope.metadataSha256,
  });
});

it.each(["ownerUserId", "applicationId", "protectionId", "operation", "metadataSha256"] as const)(
  "refuses a receipt moved to another %s binding",
  async (field) => {
    const { cipher } = setup();
    const envelope = await cipher.encrypt(scope, original);
    const changed = {
      ...scope,
      [field]:
        field === "operation"
          ? "queue_preparation"
          : field === "metadataSha256"
            ? "d".repeat(64)
            : "44444444-4444-4444-8444-444444444444",
    };
    await expect(cipher.matches(changed, envelope, original)).rejects.toThrow(unavailable);
  },
);

it("supports explicitly retained original keys without changing the original envelope", async () => {
  const { cipher, send } = setup();
  const envelope = await cipher.encrypt(scope, original);
  const before = structuredClone(envelope);
  const rotated = createLegacyReceiptKmsCipher({
    encryptionKeyArn: nextKey,
    historicalEncryptionKeyArns: [key],
    enabled: () => true,
    testClient: { send },
  });
  expect(await rotated.matches(scope, envelope, original)).toBe(true);
  expect((await rotated.encrypt(scope, original)).encryptionKeyArn).toBe(nextKey);
  expect(envelope).toEqual(before);
  const revoked = setup({ encryptionKeyArn: nextKey });
  await expect(revoked.cipher.matches(scope, envelope, original)).rejects.toThrow(unavailable);
  expect(revoked.send).not.toHaveBeenCalled();
});

it("refuses default-off and replay-only writes before effects", async () => {
  const offTransport = transport();
  const off = {
    ...offTransport,
    cipher: createLegacyReceiptKmsCipher({ encryptionKeyArn: key, testClient: offTransport }),
  };
  await expect(off.cipher.encrypt(scope, original)).rejects.toThrow(unavailable);
  const envelope = await setup().cipher.encrypt(scope, original);
  await expect(off.cipher.matches(scope, envelope, original)).rejects.toThrow(unavailable);
  expect(off.send).not.toHaveBeenCalled();
  const reader = setup({ readOnly: true });
  await expect(reader.cipher.encrypt(scope, original)).rejects.toThrow(unavailable);
  expect(reader.send).not.toHaveBeenCalled();
  expect(await reader.cipher.matches(scope, envelope, original)).toBe(true);
});

it("refuses malformed input without evaluating scope/envelope accessors", async () => {
  const { cipher, send } = setup();
  const getter = vi.fn(() => scope.ownerUserId);
  const malformed = { ...scope };
  Object.defineProperty(malformed, "ownerUserId", { enumerable: true, get: getter });
  await expect(cipher.encrypt(malformed, original)).rejects.toThrow(unavailable);
  await expect(
    cipher.encrypt({ ...scope, privateBody: "secret" } as LegacyReceiptScope, original),
  ).rejects.toThrow(unavailable);
  for (const value of ["", "F".repeat(64), "a".repeat(65)])
    await expect(cipher.encrypt(scope, value)).rejects.toThrow(unavailable);
  expect(getter).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("redacts transport errors and zeroes request bytes even on failure", async () => {
  let bytes: Uint8Array | undefined;
  const send = vi.fn(async (command: unknown) => {
    bytes = (command as EncryptCommand).input.Plaintext as Uint8Array;
    throw Error("private-original-receipt-details");
  });
  const { cipher } = setup({ testClient: { send } });
  await expect(cipher.encrypt(scope, original)).rejects.toThrow(
    /^LegacyReceiptProtectionUnavailable$/u,
  );
  expect(bytes?.every((value) => value === 0)).toBe(true);
});

it.each(["wrong-key", "wrong-algorithm", "invalid-digest"])(
  "refuses %s decrypt results and clears the returned plaintext",
  async (failure) => {
    const envelope = await setup().cipher.encrypt(scope, original);
    const bytes = Buffer.from(failure === "invalid-digest" ? "z".repeat(64) : original);
    const { cipher } = setup({
      testClient: {
        send: async () => ({
          KeyId: failure === "wrong-key" ? nextKey : key,
          EncryptionAlgorithm:
            failure === "wrong-algorithm" ? "RSAES_OAEP_SHA_256" : "SYMMETRIC_DEFAULT",
          Plaintext: bytes,
        }),
      },
    });
    await expect(cipher.matches(scope, envelope, original)).rejects.toThrow(unavailable);
    expect(bytes.every((value) => value === 0)).toBe(true);
  },
);

it("holds admission after abort until the SDK settles and rejects withdrawn authority", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  let enabled = true;
  const send = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { cipher } = setup({ enabled: () => enabled, testClient: { send } });
  const first = cipher.encrypt(scope, original);
  const assertion = expect(first).rejects.toThrow(unavailable);
  await vi.advanceTimersByTimeAsync(10_001);
  await expect(cipher.encrypt(scope, original)).rejects.toThrow(unavailable);
  expect(send).toHaveBeenCalledTimes(1);
  enabled = false;
  resolve({
    KeyId: key,
    EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    CiphertextBlob: Uint8Array.of(1),
  });
  await assertion;
  await expect(cipher.encrypt(scope, original)).rejects.toThrow(unavailable);
  expect(send).toHaveBeenCalledTimes(1);
});

it("refuses unadmitted key configurations and production test transports", () => {
  for (const history of [
    [key],
    [nextKey, nextKey],
    [nextKey.replace("111122223333", "444455556666")],
  ])
    expect(() => setup({ historicalEncryptionKeyArns: history })).toThrow(unavailable);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => setup()).toThrow(unavailable);
});

it("clears decrypted bytes and withholds a match when authority is withdrawn during KMS", async () => {
  let enabled = true;
  const envelope = await setup().cipher.encrypt(scope, original);
  const bytes = Buffer.from(original);
  const { cipher } = setup({
    enabled: () => enabled,
    testClient: {
      send: async () => {
        enabled = false;
        return { KeyId: key, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", Plaintext: bytes };
      },
    },
  });
  await expect(cipher.matches(scope, envelope, original)).rejects.toThrow(unavailable);
  expect(bytes.every((value) => value === 0)).toBe(true);
});

it("detaches the exact ciphertext and scope before an asynchronous read", async () => {
  const client = transport();
  const envelope = await setup().cipher.encrypt(scope, original);
  const mutableScope = { ...scope };
  const cipher = createLegacyReceiptKmsCipher({
    encryptionKeyArn: key,
    enabled: () => true,
    testClient: {
      send: async (command, options) => {
        await Promise.resolve();
        envelope.ciphertext.fill(0);
        mutableScope.metadataSha256 = "f".repeat(64);
        return client.send(command, options);
      },
    },
  });
  expect(await cipher.matches(mutableScope, envelope, original)).toBe(true);
});

it("rejects tampered ciphertext and refuses malformed envelopes before KMS", async () => {
  const { cipher, send } = setup();
  const envelope = await cipher.encrypt(scope, original);
  const corrupt = structuredClone(envelope);
  corrupt.ciphertext[0] = (corrupt.ciphertext[0] ?? 0) ^ 1;
  await expect(cipher.matches(scope, corrupt, original)).rejects.toThrow(unavailable);
  const calls = send.mock.calls.length;
  const getter = vi.fn(() => envelope.ciphertext);
  const accessor = { ...envelope };
  Object.defineProperty(accessor, "ciphertext", { enumerable: true, get: getter });
  for (const invalid of [accessor, { ...envelope, ciphertext: new Uint8Array(6145) }])
    await expect(cipher.matches(scope, invalid, original)).rejects.toThrow(unavailable);
  expect(getter).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(calls);
});
