import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";
import type { ApplicationStoreOptions } from "./store.js";

type Environment = Record<string, string | undefined>;
type TestClient = Parameters<typeof createLegacyReceiptKmsCipher>[0]["testClient"];
const rejected = () => Error("LegacyReceiptRuntimeConfigurationRejected");
function value(environment: Environment, name: string) {
  const property = Object.getOwnPropertyDescriptor(environment, name);
  if (!property) return undefined;
  if (!property.enumerable || !("value" in property) || typeof property.value !== "string")
    throw rejected();
  return property.value as string;
}

/** Replay-only: this composition never grants encryption or transition authority. */
export function legacyReceiptReplayFromEnvironment(
  environment: Environment,
  packetProtectionEnabled: () => boolean,
  testClient?: TestClient,
): ApplicationStoreOptions["legacyReceipts"] {
  try {
    const state = value(environment, "LEGACY_RECEIPT_REPLAY_ENABLED");
    if (state !== undefined && state !== "false" && state !== "true") throw rejected();
    if (state !== "true") return undefined;
    if (!packetProtectionEnabled()) throw rejected();
    const encryptionKeyArn = value(environment, "LEGACY_RECEIPT_ENCRYPTION_KEY_ARN");
    if (!encryptionKeyArn) throw rejected();
    const history = value(environment, "LEGACY_RECEIPT_HISTORICAL_KEYS_JSON");
    if (history !== undefined && (history.length === 0 || history.length > 4096)) throw rejected();
    const historicalEncryptionKeyArns = history === undefined ? [] : JSON.parse(history);
    if (history !== undefined && JSON.stringify(historicalEncryptionKeyArns) !== history)
      throw rejected();
    const enabled = () =>
      packetProtectionEnabled() &&
      value(environment, "LEGACY_RECEIPT_REPLAY_ENABLED") === "true" &&
      value(environment, "LEGACY_RECEIPT_ENCRYPTION_KEY_ARN") === encryptionKeyArn &&
      value(environment, "LEGACY_RECEIPT_HISTORICAL_KEYS_JSON") === history;
    const cipher = createLegacyReceiptKmsCipher({
      encryptionKeyArn,
      historicalEncryptionKeyArns,
      enabled,
      readOnly: true,
      ...(testClient ? { testClient } : {}),
    });
    return Object.freeze({ enabled, cipher: Object.freeze({ matches: cipher.matches }) });
  } catch {
    throw rejected();
  }
}
