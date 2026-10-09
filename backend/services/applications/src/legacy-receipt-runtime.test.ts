import { DecryptCommand } from "@aws-sdk/client-kms";
import { expect, it, vi } from "vitest";
import { legacyReceiptReplayFromEnvironment } from "./legacy-receipt-runtime.js";

const key = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
const environment = (): Record<string, string | undefined> => ({
  LEGACY_RECEIPT_REPLAY_ENABLED: "true",
  LEGACY_RECEIPT_ENCRYPTION_KEY_ARN: key,
});
const scope = {
  ownerUserId: "019d04cf-1f80-7000-8000-000000000101",
  applicationId: "019d04cf-1f80-7000-8000-000000000102",
  protectionId: "019d04cf-1f80-7000-8000-000000000103",
  operation: "create_packet" as const,
  metadataSha256: "a".repeat(64),
};
it("defaults off and does not compose transition/encryption authority", async () => {
  const send = vi.fn(async (command) => {
    expect(command).toBeInstanceOf(DecryptCommand);
    return {
      KeyId: key,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      Plaintext: Buffer.from("a".repeat(64)),
    };
  });
  expect(legacyReceiptReplayFromEnvironment({}, () => false, { send })).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
  const runtime = legacyReceiptReplayFromEnvironment(environment(), () => true, { send });
  expect(Object.keys(runtime?.cipher ?? {})).toEqual(["matches"]);
  await expect(
    runtime?.cipher.matches(
      scope,
      { schemaVersion: 1, encryptionKeyArn: key, ciphertext: new Uint8Array([1]) },
      "a".repeat(64),
    ),
  ).resolves.toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
it.each(["", "TRUE", "1", "enabled"])("refuses ambiguous flag %s", (flag) => {
  expect(() =>
    legacyReceiptReplayFromEnvironment(
      { ...environment(), LEGACY_RECEIPT_REPLAY_ENABLED: flag },
      () => true,
    ),
  ).toThrow("LegacyReceiptRuntimeConfigurationRejected");
});
it.each([
  "",
  "{}",
  "[ ]",
  JSON.stringify([key]),
  JSON.stringify([key, key]),
  JSON.stringify([key.replace("us-east-2", "us-west-2")]),
])("refuses invalid or duplicate historical key configuration %s", (history) => {
  expect(() =>
    legacyReceiptReplayFromEnvironment(
      { ...environment(), LEGACY_RECEIPT_HISTORICAL_KEYS_JSON: history },
      () => true,
    ),
  ).toThrow("LegacyReceiptRuntimeConfigurationRejected");
});
it("requires current packet protection and refuses key/configuration mutation", () => {
  expect(() => legacyReceiptReplayFromEnvironment(environment(), () => false)).toThrow(
    "LegacyReceiptRuntimeConfigurationRejected",
  );
  for (const field of [
    "LEGACY_RECEIPT_REPLAY_ENABLED",
    "LEGACY_RECEIPT_ENCRYPTION_KEY_ARN",
    "LEGACY_RECEIPT_HISTORICAL_KEYS_JSON",
  ]) {
    const env = environment();
    const runtime = legacyReceiptReplayFromEnvironment(env, () => true);
    expect(runtime?.enabled()).toBe(true);
    env[field] = "changed";
    expect(runtime?.enabled()).toBe(false);
  }
});
it("withholds a decrypted match if packet authority is withdrawn during KMS", async () => {
  let packetEnabled = true;
  const runtime = legacyReceiptReplayFromEnvironment(environment(), () => packetEnabled, {
    send: async () => {
      packetEnabled = false;
      return {
        KeyId: key,
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        Plaintext: Buffer.from("a".repeat(64)),
      };
    },
  });
  await expect(
    runtime?.cipher.matches(
      scope,
      { schemaVersion: 1, encryptionKeyArn: key, ciphertext: new Uint8Array([1]) },
      "a".repeat(64),
    ),
  ).rejects.toThrow("LegacyReceiptProtectionUnavailable");
});
