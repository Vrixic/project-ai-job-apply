import { afterEach, expect, it, vi } from "vitest";
import {
  restrictedPacketExportFromEnvironment,
  restrictedPacketWriterFromEnvironment,
} from "./restricted-packet-runtime.js";

const encryptionKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000001";
const fingerprintKeyArn =
  "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000002";
const environment = () => ({
  RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
  RESTRICTED_PACKET_EXPORT_ENABLED: "true",
  RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: encryptionKeyArn,
  RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: fingerprintKeyArn,
});
const scope = {
  ownerUserId: "019d04cf-1f80-7000-8000-000000000101",
  applicationId: "019d04cf-1f80-7000-8000-000000000102",
  protectionId: "019d04cf-1f80-7000-8000-000000000103",
  metadataSha256: "a".repeat(64),
};
const configurationRejected = "RestrictedPacketRuntimeConfigurationRejected";
afterEach(() => vi.unstubAllEnvs());

it.each([restrictedPacketWriterFromEnvironment, restrictedPacketExportFromEnvironment])(
  "defaults off without composing a crypto client",
  (factory) => {
    const send = vi.fn();
    expect(factory({}, { send })).toBeUndefined();
    expect(
      factory(
        {
          RESTRICTED_PACKET_PROTECTION_ENABLED: "false",
          RESTRICTED_PACKET_EXPORT_ENABLED: "false",
          RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: "synthetic-invalid",
        },
        { send },
      ),
    ).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  },
);
it.each(["enabled", "TRUE", "", "1"])("refuses ambiguous writer opt-in %s", (flag) => {
  expect(() =>
    restrictedPacketWriterFromEnvironment({
      ...environment(),
      RESTRICTED_PACKET_PROTECTION_ENABLED: flag,
    }),
  ).toThrow(configurationRejected);
});
it.each(["RESTRICTED_PACKET_ENCRYPTION_KEY_ARN", "RESTRICTED_PACKET_FINGERPRINT_KEY_ARN"])(
  "requires the exact configured key %s",
  (key) => {
    const env: Record<string, string | undefined> = environment();
    delete env[key];
    expect(() => restrictedPacketWriterFromEnvironment(env)).toThrow(configurationRejected);
    env[key] = "arn:aws:kms:us-east-2:123456789012:alias/synthetic";
    expect(() => restrictedPacketExportFromEnvironment(env)).toThrow(configurationRejected);
  },
);
it("requires distinct keys in the same account and region", () => {
  expect(() =>
    restrictedPacketWriterFromEnvironment({
      ...environment(),
      RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: encryptionKeyArn,
    }),
  ).toThrow(configurationRejected);
  expect(() =>
    restrictedPacketWriterFromEnvironment({
      ...environment(),
      RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: fingerprintKeyArn.replace("us-east-2", "us-west-2"),
    }),
  ).toThrow(configurationRejected);
});
it("never evaluates configuration getters", () => {
  const env = environment();
  const getter = vi.fn(() => encryptionKeyArn);
  Object.defineProperty(env, "RESTRICTED_PACKET_ENCRYPTION_KEY_ARN", {
    enumerable: true,
    get: getter,
  });
  expect(() => restrictedPacketWriterFromEnvironment(env)).toThrow(configurationRejected);
  expect(getter).not.toHaveBeenCalled();
});
it.each([
  "RESTRICTED_PACKET_PROTECTION_ENABLED",
  "RESTRICTED_PACKET_ENCRYPTION_KEY_ARN",
  "RESTRICTED_PACKET_FINGERPRINT_KEY_ARN",
])("withholds captured writer authority after %s changes", async (key) => {
  const env: Record<string, string | undefined> = environment();
  const send = vi.fn();
  const protection = restrictedPacketWriterFromEnvironment(env, { send });
  if (!protection) throw Error("MissingSyntheticProtection");
  expect(protection.enabled()).toBe(true);
  env[key] = "synthetic-withdrawn";
  expect(protection.enabled()).toBe(false);
  await expect(
    protection.cipher.fingerprint({
      ownerUserId: scope.ownerUserId,
      applicationId: scope.applicationId,
      operation: "create_packet",
      requestSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("RestrictedPacketProtectionUnavailable");
  expect(send).not.toHaveBeenCalled();
});
it("export composition cannot encrypt or MAC even with the writer switch enabled", async () => {
  const send = vi.fn();
  const protection = restrictedPacketExportFromEnvironment(environment(), { send });
  if (!protection) throw Error("MissingSyntheticExportProtection");
  await expect(protection.cipher.encrypt(scope, Buffer.from("synthetic"))).rejects.toThrow(
    "RestrictedPacketProtectionUnavailable",
  );
  await expect(
    protection.cipher.fingerprint({
      ownerUserId: scope.ownerUserId,
      applicationId: scope.applicationId,
      operation: "queue_preparation",
      requestSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("RestrictedPacketProtectionUnavailable");
  expect(send).not.toHaveBeenCalled();
});
it("the independent export switch must opt in", () => {
  expect(
    restrictedPacketExportFromEnvironment({
      ...environment(),
      RESTRICTED_PACKET_EXPORT_ENABLED: "false",
    }),
  ).toBeUndefined();
});
it("production rejects injected transport", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => restrictedPacketWriterFromEnvironment(environment(), { send: vi.fn() })).toThrow(
    configurationRejected,
  );
});
it.each([
  "",
  "null",
  "{}",
  " [ ] ",
  '[{"encryptionKeyArn":"x","encryptionKeyArn":"y","fingerprintKeyArn":"z"}]',
  "x".repeat(4097),
])("refuses malformed or ambiguous history %s", (history) => {
  expect(() =>
    restrictedPacketWriterFromEnvironment({
      ...environment(),
      RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: history,
    }),
  ).toThrow(configurationRejected);
});
it("withholds historical authority when the captured history changes", async () => {
  const env = { ...environment(), RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: "[]" };
  const send = vi.fn();
  const protection = restrictedPacketWriterFromEnvironment(env, { send });
  if (!protection) throw Error("MissingSyntheticProtection");
  expect(Object.isFrozen(protection.historicalFingerprintKeyArns)).toBe(true);
  Reflect.deleteProperty(env, "RESTRICTED_PACKET_HISTORICAL_KEYS_JSON");
  expect(protection.enabled()).toBe(false);
  await expect(
    protection.cipher.fingerprint({
      ownerUserId: scope.ownerUserId,
      applicationId: scope.applicationId,
      operation: "create_packet",
      requestSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("RestrictedPacketProtectionUnavailable");
  expect(send).not.toHaveBeenCalled();
});
