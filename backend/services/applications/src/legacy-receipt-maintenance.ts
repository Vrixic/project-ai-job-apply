import { createHash } from "node:crypto";
import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";

export interface LegacyReceiptMaintenanceConfiguration {
  schemaVersion: 1;
  runId: string;
  sourceSha: string;
  imageDigest: string;
  accountId: string;
  region: "us-east-2";
  databaseIdentifier: "ai-job-apply-development";
  databaseResourceId: string;
  databaseHostname: string;
  databaseName: "ai_job_apply";
  databasePort: 5432;
  snapshotArn: string;
  snapshotCreatedAt: string;
  encryptionKeyArn: string;
  expectedAppliedMigrations: number;
  expectedLegacyReceipts: number;
  issuedAt: string;
  expiresAt: string;
}
const keys = [
  "schemaVersion",
  "runId",
  "sourceSha",
  "imageDigest",
  "accountId",
  "region",
  "databaseIdentifier",
  "databaseResourceId",
  "databaseHostname",
  "databaseName",
  "databasePort",
  "snapshotArn",
  "snapshotCreatedAt",
  "encryptionKeyArn",
  "expectedAppliedMigrations",
  "expectedLegacyReceipts",
  "issuedAt",
  "expiresAt",
].sort();
const unavailable = () => Error("LegacyReceiptMaintenanceConfigurationRejected");
const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");
type Environment = Record<string, string | undefined>;
function value(environment: Environment, name: string) {
  const property = Object.getOwnPropertyDescriptor(environment, name);
  if (!property?.enumerable || !("value" in property) || typeof property.value !== "string")
    throw unavailable();
  return property.value as string;
}
function timestamp(input: unknown) {
  if (typeof input !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(input))
    throw unavailable();
  const ms = Date.parse(input);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== input) throw unavailable();
  return ms;
}

/** Task-definition configuration is admitted only after the managed operator verifies the exact
 * image, runtime drain and recovery snapshot. This parser does not attest external AWS state. */
export function legacyReceiptMaintenanceFromEnvironment(
  environment: Environment,
  now = () => Date.now(),
) {
  try {
    if (
      value(environment, "NODE_ENV") !== "production" ||
      value(environment, "LEGACY_RECEIPT_TRANSITION_ENABLED") !== "true"
    )
      throw unavailable();
    const raw = value(environment, "LEGACY_RECEIPT_TRANSITION_CONFIG_JSON");
    const configurationSha256 = value(environment, "LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256");
    if (
      raw.length > 4096 ||
      !/^[a-f0-9]{64}$/u.test(configurationSha256) ||
      sha256(raw) !== configurationSha256
    )
      throw unavailable();
    const config = JSON.parse(raw) as LegacyReceiptMaintenanceConfiguration;
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      JSON.stringify(config) !== raw ||
      JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(keys)
    )
      throw unavailable();
    const numeric = new Set([
      "schemaVersion",
      "databasePort",
      "expectedAppliedMigrations",
      "expectedLegacyReceipts",
    ]);
    if (
      Object.entries(config).some(([key, entry]) => !numeric.has(key) && typeof entry !== "string")
    )
      throw unavailable();
    if (
      config.schemaVersion !== 1 ||
      !/^[a-f0-9]{32}$/u.test(config.runId) ||
      !/^[a-f0-9]{40}$/u.test(config.sourceSha) ||
      !/^[a-f0-9]{64}$/u.test(config.imageDigest) ||
      !/^[0-9]{12}$/u.test(config.accountId) ||
      config.region !== "us-east-2" ||
      config.databaseIdentifier !== "ai-job-apply-development" ||
      !/^db-[A-Z0-9]{8,63}$/u.test(config.databaseResourceId) ||
      !/^ai-job-apply-development\.[a-z0-9]{6,63}\.us-east-2\.rds\.amazonaws\.com$/u.test(
        config.databaseHostname,
      ) ||
      config.databaseName !== "ai_job_apply" ||
      config.databasePort !== 5432 ||
      !Number.isInteger(config.expectedAppliedMigrations) ||
      config.expectedAppliedMigrations < 3 ||
      config.expectedAppliedMigrations > 8 ||
      !Number.isInteger(config.expectedLegacyReceipts) ||
      config.expectedLegacyReceipts < 1 ||
      config.expectedLegacyReceipts > 1000 ||
      !new RegExp(
        `^arn:aws:rds:us-east-2:${config.accountId}:snapshot:ai-job-apply-development-[a-z0-9-]{1,180}$`,
        "u",
      ).test(config.snapshotArn) ||
      !new RegExp(
        `^arn:aws:kms:us-east-2:${config.accountId}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`,
        "u",
      ).test(config.encryptionKeyArn)
    )
      throw unavailable();
    const issued = timestamp(config.issuedAt),
      expires = timestamp(config.expiresAt),
      snapshot = timestamp(config.snapshotCreatedAt);
    if (
      expires <= issued ||
      expires - issued > 30 * 60_000 ||
      snapshot > issued ||
      issued - snapshot > 60 * 60_000
    )
      throw unavailable();
    const databaseUrl = value(environment, "DATABASE_URL");
    const database = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      database.hostname !== config.databaseHostname ||
      database.port !== "5432" ||
      database.pathname !== `/${config.databaseName}` ||
      database.hash ||
      !database.username ||
      !database.password ||
      database.search !== "?sslmode=require"
    )
      throw unavailable();
    const enabled = () => {
      try {
        const instant = now();
        return (
          Number.isFinite(instant) &&
          instant >= issued &&
          instant < expires &&
          value(environment, "NODE_ENV") === "production" &&
          value(environment, "LEGACY_RECEIPT_TRANSITION_ENABLED") === "true" &&
          value(environment, "LEGACY_RECEIPT_TRANSITION_CONFIG_JSON") === raw &&
          value(environment, "LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256") === configurationSha256 &&
          value(environment, "DATABASE_URL") === databaseUrl
        );
      } catch {
        return false;
      }
    };
    if (!enabled()) throw unavailable();
    return Object.freeze({
      configuration: Object.freeze(config),
      configurationSha256,
      databaseUrl,
      enabled,
    });
  } catch {
    throw unavailable();
  }
}

export function legacyReceiptMaintenanceCipher(
  admitted: ReturnType<typeof legacyReceiptMaintenanceFromEnvironment>,
) {
  if (!admitted.enabled()) throw unavailable();
  return createLegacyReceiptKmsCipher({
    encryptionKeyArn: admitted.configuration.encryptionKeyArn,
    enabled: admitted.enabled,
  });
}
