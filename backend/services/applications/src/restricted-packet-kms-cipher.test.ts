import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { afterEach, expect, it, vi } from "vitest";
import { createRestrictedPacketKmsCipher } from "./restricted-packet-kms-cipher.js";

const encryptionKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000001";
const fingerprintKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000002";
const scope = {
  ownerUserId: "019d04cf-1f80-7000-8000-000000000101",
  applicationId: "019d04cf-1f80-7000-8000-000000000102",
  protectionId: "019d04cf-1f80-7000-8000-000000000103",
  metadataSha256: "a".repeat(64),
};
const original = Buffer.from('{"authorization.us_authorized":true}', "utf8");
const unavailable = "RestrictedPacketProtectionUnavailable";
type Client = NonNullable<Parameters<typeof createRestrictedPacketKmsCipher>[0]["testClient"]>;
const request = {
  ownerUserId: scope.ownerUserId,
  applicationId: scope.applicationId,
  operation: "create_packet" as const,
  requestSha256: "b".repeat(64),
};
function setup(extra: Partial<Parameters<typeof createRestrictedPacketKmsCipher>[0]> = {}) {
  const keys: Uint8Array[] = [];
  const send = vi.fn<Client["send"]>(async (command) => {
    if (command instanceof GenerateMacCommand)
      return {
        KeyId: fingerprintKeyArn,
        MacAlgorithm: "HMAC_SHA_256",
        Mac: createHmac("sha256", Buffer.alloc(32, 42))
          .update(command.input.Message as Uint8Array)
          .digest(),
      };
    const key = Uint8Array.from(Buffer.alloc(32, 7));
    keys.push(key);
    if (command instanceof GenerateDataKeyCommand)
      return {
        KeyId: encryptionKeyArn,
        Plaintext: key,
        CiphertextBlob: Uint8Array.from([1, 2, 3]),
      };
    if (command instanceof DecryptCommand)
      return { KeyId: encryptionKeyArn, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", Plaintext: key };
    throw Error("UnexpectedSyntheticCommand");
  });
  return {
    send,
    keys,
    cipher: createRestrictedPacketKmsCipher({
      encryptionKeyArn,
      fingerprintKeyArn,
      enabled: () => true,
      testClient: { send },
      ...extra,
    }),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("refuses default-off encryption, decryption and fingerprinting before effects", async () => {
  const { cipher: enabled } = setup();
  const envelope = await enabled.encrypt(scope, original);
  const { send } = setup();
  const cipher = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    testClient: { send },
  });
  await expect(cipher.encrypt(scope, original)).rejects.toThrow(unavailable);
  await expect(cipher.decrypt(scope, envelope)).rejects.toThrow(unavailable);
  await expect(cipher.fingerprint(request)).rejects.toThrow(unavailable);
  expect(send).not.toHaveBeenCalled();
});

it.each(["same", "alias", "foreign_account", "foreign_region", "endpoint"] as const)(
  "refuses %s key configuration",
  (fault) => {
    let key = fingerprintKeyArn;
    if (fault === "same") key = encryptionKeyArn;
    if (fault === "alias") key = key.replace("key/", "alias/");
    if (fault === "foreign_account") key = key.replace("123456789012", "999900001111");
    if (fault === "foreign_region") key = key.replace("us-east-2", "us-east-1");
    if (fault === "endpoint") key = "https://example.invalid/key";
    expect(() => setup({ fingerprintKeyArn: key })).toThrow(unavailable);
  },
);

it("round-trips exact candidate bytes, randomizes envelopes and clears returned plaintext data keys", async () => {
  const { cipher, send, keys } = setup();
  const first = await cipher.encrypt(scope, original);
  const second = await cipher.encrypt(scope, original);
  expect(first.ciphertext).not.toEqual(second.ciphertext);
  expect(first.iv).not.toEqual(second.iv);
  const plaintext = await cipher.decrypt(scope, first);
  expect(Buffer.from(plaintext)).toEqual(original);
  plaintext.fill(0);
  expect(keys).toHaveLength(3);
  expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
  expect(original.toString("utf8")).toContain("true");
  const command = send.mock.calls[0]?.[0] as GenerateDataKeyCommand;
  expect(command.input).toEqual({
    KeyId: encryptionKeyArn,
    KeySpec: "AES_256",
    EncryptionContext: {
      purpose: "restricted-application-packet.v1",
      owner_user_id: scope.ownerUserId,
      application_id: scope.applicationId,
      protection_id: scope.protectionId,
      metadata_sha256: scope.metadataSha256,
    },
  });
  expect(JSON.stringify(command.input)).not.toContain("authorization.us_authorized");
});

it.each(["ownerUserId", "applicationId", "protectionId", "metadataSha256"] as const)(
  "refuses moved ciphertext with changed %s through authenticated local context",
  async (field) => {
    const { cipher } = setup();
    const envelope = await cipher.encrypt(scope, original);
    const changed = {
      ...scope,
      [field]: field === "metadataSha256" ? "c".repeat(64) : "019d04cf-1f80-7000-8000-000000000104",
    };
    await expect(cipher.decrypt(changed, envelope)).rejects.toThrow(unavailable);
  },
);

it.each(["iv", "ciphertext", "authenticationTag"] as const)(
  "refuses tampered %s without releasing partial plaintext",
  async (field) => {
    const { cipher, keys } = setup();
    const envelope = structuredClone(await cipher.encrypt(scope, original));
    envelope[field][0] = (envelope[field][0] ?? 0) ^ 1;
    await expect(cipher.decrypt(scope, envelope)).rejects.toThrow(unavailable);
    expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
  },
);

it.each(["empty", "oversize", "getter", "hidden", "symbol"] as const)(
  "refuses %s input before KMS access",
  async (fault) => {
    const { cipher, send } = setup();
    const value = { ...scope };
    const getter = vi.fn(() => scope.ownerUserId);
    if (fault === "getter")
      Object.defineProperty(value, "ownerUserId", { enumerable: true, get: getter });
    if (fault === "hidden") Object.defineProperty(value, "candidateBody", { value: "synthetic" });
    if (fault === "symbol")
      Object.defineProperty(value, Symbol("candidateBody"), { value: "synthetic" });
    const body =
      fault === "empty" ? Buffer.alloc(0) : fault === "oversize" ? Buffer.alloc(800_001) : original;
    await expect(cipher.encrypt(value, body)).rejects.toThrow(unavailable);
    expect(send).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  },
);

it.each(["wrong_key", "short_key", "missing_blob", "provider_error"] as const)(
  "refuses %s key response with a value-free error and clears any returned key",
  async (fault) => {
    const { cipher, send } = setup();
    const key = new Uint8Array(fault === "short_key" ? 31 : 32).fill(9);
    send.mockImplementationOnce(async () => {
      if (fault === "provider_error") throw Error("SYNTHETIC_PRIVATE_PROVIDER_BODY");
      return {
        KeyId: fault === "wrong_key" ? fingerprintKeyArn : encryptionKeyArn,
        Plaintext: key,
        ...(fault === "missing_blob" ? {} : { CiphertextBlob: Uint8Array.from([1]) }),
      };
    });
    await expect(cipher.encrypt(scope, original)).rejects.toThrow(
      /^RestrictedPacketProtectionUnavailable$/u,
    );
    if (fault !== "provider_error") expect(key.every((byte) => byte === 0)).toBe(true);
  },
);

it("produces deterministic keyed fingerprints and binds owner, application, operation and exact request", async () => {
  const { cipher, send } = setup();
  const first = await cipher.fingerprint(request);
  expect(first).toMatch(/^[a-f0-9]{64}$/u);
  expect(first).not.toBe(request.requestSha256);
  expect(await cipher.fingerprint(request)).toBe(first);
  for (const change of [
    { ownerUserId: scope.protectionId },
    { applicationId: scope.protectionId },
    { operation: "queue_preparation" as const },
    { requestSha256: "c".repeat(64) },
  ])
    expect(await cipher.fingerprint({ ...request, ...change })).not.toBe(first);
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(GenerateMacCommand);
  expect((command as GenerateMacCommand).input.MacAlgorithm).toBe("HMAC_SHA_256");
});

it("retains admission through an actual pending SDK call after timeout and discards its late key", async () => {
  vi.useFakeTimers();
  const { cipher, send } = setup();
  let finish!: (result: unknown) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const originalCall = cipher.encrypt(scope, original);
  const rejected = expect(originalCall).rejects.toThrow(unavailable);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
  await expect(cipher.fingerprint(request)).rejects.toThrow(unavailable);
  expect(send).toHaveBeenCalledOnce();
  const key = new Uint8Array(32).fill(7);
  finish({ KeyId: encryptionKeyArn, Plaintext: key, CiphertextBlob: Uint8Array.from([1]) });
  await rejected;
  expect(key.every((byte) => byte === 0)).toBe(true);
  expect(await cipher.fingerprint(request)).toMatch(/^[a-f0-9]{64}$/u);
});

it("withholds plaintext when the enable switch changes during decryption", async () => {
  let enabled = true;
  const { cipher, send } = setup({ enabled: () => enabled });
  const envelope = await cipher.encrypt(scope, original);
  send.mockImplementationOnce(async () => {
    enabled = false;
    return {
      KeyId: encryptionKeyArn,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      Plaintext: new Uint8Array(32).fill(7),
    };
  });
  await expect(cipher.decrypt(scope, envelope)).rejects.toThrow(unavailable);
});

it("rejects test transport construction and use outside the test environment", async () => {
  const { cipher, send } = setup();
  vi.stubEnv("NODE_ENV", "production");
  expect(() => setup()).toThrow(unavailable);
  await expect(cipher.fingerprint(request)).rejects.toThrow(unavailable);
  expect(send).not.toHaveBeenCalled();
});

it("exercises actual installed signed KMS SDK serialization offline without retries", async () => {
  const captured: Array<{ target: string; body: string; signed: boolean }> = [];
  const sdk = new KMSClient({
    region: "us-east-2",
    maxAttempts: 1,
    credentials: { accessKeyId: "SYNTHETIC", secretAccessKey: "SYNTHETIC" },
    requestHandler: {
      async handle(request: { headers: Record<string, string>; body?: unknown }) {
        const target = request.headers["x-amz-target"] ?? "";
        captured.push({
          target,
          body: String(request.body),
          signed: /AWS4-HMAC-SHA256/u.test(request.headers.authorization ?? ""),
        });
        const reply = target.endsWith("GenerateDataKey")
          ? {
              KeyId: encryptionKeyArn,
              Plaintext: Buffer.alloc(32, 7).toString("base64"),
              CiphertextBlob: Buffer.from([1, 2, 3]).toString("base64"),
            }
          : target.endsWith("Decrypt")
            ? {
                KeyId: encryptionKeyArn,
                EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
                Plaintext: Buffer.alloc(32, 7).toString("base64"),
              }
            : {
                KeyId: fingerprintKeyArn,
                MacAlgorithm: "HMAC_SHA_256",
                Mac: Buffer.alloc(32, 42).toString("base64"),
              };
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/x-amz-json-1.1" },
            body: Readable.from([JSON.stringify(reply)]),
          },
        };
      },
    },
  });
  const cipher = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    enabled: () => true,
    testClient: {
      send: (command, options) => sdk.send(command as GenerateDataKeyCommand, options),
    },
  });
  const envelope = await cipher.encrypt(scope, original);
  const plaintext = await cipher.decrypt(scope, envelope);
  expect(Buffer.from(plaintext)).toEqual(original);
  plaintext.fill(0);
  expect(await cipher.fingerprint(request)).toBe("2a".repeat(32));
  expect(captured).toHaveLength(3);
  expect(captured.every((call) => call.signed)).toBe(true);
  expect(captured.map((call) => call.target)).toEqual([
    "TrentService.GenerateDataKey",
    "TrentService.Decrypt",
    "TrentService.GenerateMac",
  ]);
  expect(captured.every((call) => !call.body.includes("authorization.us_authorized"))).toBe(true);
  sdk.destroy();
});

it("pins the default production client endpoint and one-attempt policy despite environment overrides", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AWS_ENDPOINT_URL", "https://synthetic.invalid");
  vi.stubEnv("AWS_ENDPOINT_URL_KMS", "https://synthetic-kms.invalid");
  const observed: Array<{
    hostname: string | undefined;
    region: string;
    attempts: number;
    ignoreOverrides: boolean;
  }> = [];
  const send = vi.spyOn(KMSClient.prototype, "send").mockImplementation(async function (
    this: KMSClient,
  ) {
    const endpoint = await this.config.endpoint?.();
    const configured = this.config.ignoreConfiguredEndpointUrls;
    observed.push({
      hostname: endpoint?.hostname,
      region: await this.config.region(),
      attempts: await this.config.maxAttempts(),
      ignoreOverrides: configured === true,
    });
    return {
      KeyId: fingerprintKeyArn,
      MacAlgorithm: "HMAC_SHA_256" as const,
      Mac: Buffer.alloc(32, 42),
      $metadata: {},
    };
  });
  const cipher = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    enabled: () => true,
  });
  expect(await cipher.fingerprint(request)).toBe("2a".repeat(32));
  expect(send).toHaveBeenCalledOnce();
  expect(observed).toEqual([
    {
      hostname: "kms.us-east-2.amazonaws.com",
      region: "us-east-2",
      attempts: 1,
      ignoreOverrides: true,
    },
  ]);
});

it("does not retry an actual signed KMS SDK failure or expose its body", async () => {
  let calls = 0;
  const sdk = new KMSClient({
    region: "us-east-2",
    maxAttempts: 1,
    credentials: { accessKeyId: "SYNTHETIC", secretAccessKey: "SYNTHETIC" },
    requestHandler: {
      async handle() {
        calls++;
        return {
          response: {
            statusCode: 500,
            headers: { "content-type": "application/x-amz-json-1.1" },
            body: Readable.from([
              JSON.stringify({
                __type: "KMSInternalException",
                message: "SYNTHETIC_PRIVATE_PROVIDER_BODY",
              }),
            ]),
          },
        };
      },
    },
  });
  const cipher = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    enabled: () => true,
    testClient: { send: (command, options) => sdk.send(command as GenerateMacCommand, options) },
  });
  try {
    await expect(cipher.fingerprint(request)).rejects.toThrow(
      /^RestrictedPacketProtectionUnavailable$/u,
    );
    expect(calls).toBe(1);
  } finally {
    sdk.destroy();
  }
});
const oldEncryptionKeyArn = encryptionKeyArn.replace(/1$/u, "3");
const oldFingerprintKeyArn = fingerprintKeyArn.replace(/2$/u, "4");
const history = [
  { encryptionKeyArn: oldEncryptionKeyArn, fingerprintKeyArn: oldFingerprintKeyArn },
];
it("retains original decrypt/MAC authority while new writes use only active keys", async () => {
  const send = vi.fn<Client["send"]>(async (command) => {
    if (command instanceof GenerateDataKeyCommand)
      return {
        KeyId: command.input.KeyId,
        Plaintext: Buffer.alloc(32, 7),
        CiphertextBlob: Buffer.from([1, 2, 3]),
      };
    if (command instanceof DecryptCommand)
      return {
        KeyId: command.input.KeyId,
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        Plaintext: Buffer.alloc(32, 7),
      };
    if (command instanceof GenerateMacCommand)
      return {
        KeyId: command.input.KeyId,
        MacAlgorithm: "HMAC_SHA_256",
        Mac: createHmac("sha256", command.input.KeyId as string)
          .update(command.input.Message as Uint8Array)
          .digest(),
      };
    throw Error("UnexpectedSyntheticCommand");
  });
  const old = createRestrictedPacketKmsCipher({
    encryptionKeyArn: oldEncryptionKeyArn,
    fingerprintKeyArn: oldFingerprintKeyArn,
    enabled: () => true,
    testClient: { send },
  });
  const envelope = await old.encrypt(scope, original);
  const mac = await old.fingerprint(request);
  const rotated = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    historicalKeys: history,
    enabled: () => true,
    testClient: { send },
  });
  const chosen = await rotated.decrypt(scope, envelope);
  expect(Buffer.from(chosen)).toEqual(original);
  chosen.fill(0);
  expect(await rotated.fingerprint(request, oldFingerprintKeyArn)).toBe(mac);
  expect(await rotated.fingerprint(request)).not.toBe(mac);
  expect((await rotated.encrypt(scope, original)).encryptionKeyArn).toBe(encryptionKeyArn);
  const before = send.mock.calls.length;
  await expect(
    rotated.decrypt(scope, {
      ...envelope,
      encryptionKeyArn: oldEncryptionKeyArn.replace(/3$/u, "5"),
    }),
  ).rejects.toThrow(unavailable);
  await expect(
    rotated.fingerprint(request, oldFingerprintKeyArn.replace(/4$/u, "6")),
  ).rejects.toThrow(unavailable);
  expect(send.mock.calls.length).toBe(before);
  const removed = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    enabled: () => true,
    testClient: { send },
  });
  await expect(removed.decrypt(scope, envelope)).rejects.toThrow(unavailable);
  await expect(removed.fingerprint(request, oldFingerprintKeyArn)).rejects.toThrow(unavailable);
  expect(send.mock.calls.length).toBe(before);
});
it.each([
  [...history, ...history],
  [{ encryptionKeyArn, fingerprintKeyArn: oldFingerprintKeyArn }],
  [{ encryptionKeyArn: oldEncryptionKeyArn, fingerprintKeyArn: oldEncryptionKeyArn }],
  [
    {
      encryptionKeyArn: oldEncryptionKeyArn.replace("us-east-2", "us-west-2"),
      fingerprintKeyArn: oldFingerprintKeyArn,
    },
  ],
  [
    {
      encryptionKeyArn: oldEncryptionKeyArn,
      fingerprintKeyArn: oldFingerprintKeyArn.replace("123456789012", "123456789013"),
    },
  ],
  [
    {
      encryptionKeyArn: "arn:aws:kms:us-east-2:123456789012:alias/old",
      fingerprintKeyArn: oldFingerprintKeyArn,
    },
  ],
  Array(9).fill(history[0]),
  [{ ...history[0], extra: true }],
])("refuses invalid historical authority %j", (historicalKeys) => {
  expect(() => setup({ historicalKeys })).toThrow(unavailable);
});
it("snapshots trusted history without invoking getters or accepting sparse lists", async () => {
  const getter = vi.fn(() => oldEncryptionKeyArn);
  const pair = { encryptionKeyArn: oldEncryptionKeyArn, fingerprintKeyArn: oldFingerprintKeyArn };
  Object.defineProperty(pair, "encryptionKeyArn", { enumerable: true, get: getter });
  expect(() => setup({ historicalKeys: [pair] })).toThrow(unavailable);
  expect(getter).not.toHaveBeenCalled();
  expect(() => setup({ historicalKeys: Array(1) })).toThrow(unavailable);
  const mutable = structuredClone(history);
  const { cipher } = setup({ historicalKeys: mutable });
  const first = mutable[0];
  if (!first) throw Error("MissingSyntheticHistory");
  first.fingerprintKeyArn = oldFingerprintKeyArn.replace(/4$/u, "6");
  // Original selected authority remains pinned; the controlled reply deliberately uses the active key.
  await expect(cipher.fingerprint(request, oldFingerprintKeyArn)).rejects.toThrow(unavailable);
});
