import { createRestrictedPacketKmsCipher } from "./restricted-packet-kms-cipher.js";
import type { ApplicationStoreOptions } from "./store.js";

export { createRestrictedPacketKmsCipher } from "./restricted-packet-kms-cipher.js";

type Environment = Record<string, string | undefined>;
type TestClient = Parameters<typeof createRestrictedPacketKmsCipher>[0]["testClient"];
const unavailable = () => Error("RestrictedPacketRuntimeConfigurationRejected");
function value(environment: Environment, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string")
    throw unavailable();
  return descriptor.value as string;
}
function configuration(
  environment: Environment,
  flag: string,
  readOnly: boolean,
  testClient?: TestClient,
) {
  try {
    const state = value(environment, flag);
    if (state !== undefined && state !== "false" && state !== "true") throw unavailable();
    if (state !== "true") return undefined;
    const encryptionKeyArn = value(environment, "RESTRICTED_PACKET_ENCRYPTION_KEY_ARN");
    const fingerprintKeyArn = value(environment, "RESTRICTED_PACKET_FINGERPRINT_KEY_ARN");
    if (!encryptionKeyArn || !fingerprintKeyArn) throw unavailable();
    const history = value(environment, "RESTRICTED_PACKET_HISTORICAL_KEYS_JSON");
    if (history !== undefined && (history.length > 4096 || history.length === 0))
      throw unavailable();
    const historicalKeys = history === undefined ? [] : JSON.parse(history);
    // Canonical JSON refuses duplicate keys and ambiguous configuration spellings.
    if (history !== undefined && JSON.stringify(historicalKeys) !== history) throw unavailable();
    const enabled = () =>
      value(environment, flag) === "true" &&
      value(environment, "RESTRICTED_PACKET_ENCRYPTION_KEY_ARN") === encryptionKeyArn &&
      value(environment, "RESTRICTED_PACKET_FINGERPRINT_KEY_ARN") === fingerprintKeyArn &&
      value(environment, "RESTRICTED_PACKET_HISTORICAL_KEYS_JSON") === history;
    const cipher = createRestrictedPacketKmsCipher({
      encryptionKeyArn,
      fingerprintKeyArn,
      historicalKeys,
      enabled,
      ...(readOnly ? { readOnly: true as const } : {}),
      ...(testClient ? { testClient } : {}),
    });
    return Object.freeze({
      cipher,
      fingerprintKeyArn,
      historicalFingerprintKeyArns: Object.freeze(
        historicalKeys.map((pair: { fingerprintKeyArn: string }) => pair.fingerprintKeyArn),
      ) as readonly string[],
      enabled,
    }) satisfies NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  } catch {
    throw unavailable();
  }
}

/** Private writer composition. Keys are exact; changing/withdrawing the captured authority refuses. */
export function restrictedPacketWriterFromEnvironment(
  environment: Environment,
  testClient?: TestClient,
) {
  return configuration(environment, "RESTRICTED_PACKET_PROTECTION_ENABLED", false, testClient);
}
/** Private export composition cannot generate data keys or MACs, even if the writer switch is on. */
export function restrictedPacketExportFromEnvironment(
  environment: Environment,
  testClient?: TestClient,
) {
  return configuration(environment, "RESTRICTED_PACKET_EXPORT_ENABLED", true, testClient);
}
