import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { legacyReceiptMaintenanceFromEnvironment } from "./legacy-receipt-maintenance.js";

const instant = Date.parse("2026-10-09T04:30:00.000Z");
const configuration = () => ({
  schemaVersion: 1,
  runId: "a".repeat(32),
  sourceSha: "b".repeat(40),
  imageDigest: "c".repeat(64),
  accountId: "111122223333",
  region: "us-east-2",
  databaseIdentifier: "ai-job-apply-development",
  databaseResourceId: "db-SYNTHETIC00000001",
  databaseHostname: "ai-job-apply-development.abcdefghijkl.us-east-2.rds.amazonaws.com",
  databaseName: "ai_job_apply",
  databasePort: 5432,
  snapshotArn: "arn:aws:rds:us-east-2:111122223333:snapshot:ai-job-apply-development-synthetic",
  snapshotCreatedAt: "2026-10-09T04:15:00.000Z",
  encryptionKeyArn: "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111",
  expectedAppliedMigrations: 3,
  expectedLegacyReceipts: 7,
  issuedAt: "2026-10-09T04:25:00.000Z",
  expiresAt: "2026-10-09T04:55:00.000Z",
});
function environment(overrides: Record<string, unknown> = {}) {
  const config = { ...configuration(), ...overrides };
  const raw = JSON.stringify(config);
  return {
    NODE_ENV: "production",
    LEGACY_RECEIPT_TRANSITION_ENABLED: "true",
    LEGACY_RECEIPT_TRANSITION_CONFIG_JSON: raw,
    LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256: createHash("sha256").update(raw).digest("hex"),
    DATABASE_URL: `postgres://synthetic:local_only@${configuration().databaseHostname}:5432/ai_job_apply?sslmode=require`,
  };
}
it("admits only the exact database/configuration during the bounded lifetime", () => {
  const env = environment();
  let now = instant;
  const result = legacyReceiptMaintenanceFromEnvironment(env, () => now);
  expect(result.configuration.expectedLegacyReceipts).toBe(7);
  expect(Object.isFrozen(result.configuration)).toBe(true);
  expect(result.enabled()).toBe(true);
  now = Date.parse(configuration().expiresAt);
  expect(result.enabled()).toBe(false);
});
it.each([
  { schemaVersion: 2 },
  { runId: "bad" },
  { sourceSha: "latest" },
  { imageDigest: "latest" },
  { accountId: 111122223333 },
  { region: "us-west-2" },
  { databaseIdentifier: "other" },
  { databaseHostname: "localhost" },
  { databaseName: "other" },
  { databasePort: 5433 },
  { expectedAppliedMigrations: 9 },
  { expectedLegacyReceipts: 0 },
  { expectedLegacyReceipts: 1001 },
  { expectedLegacyReceipts: 1.5 },
  { snapshotCreatedAt: "2026-10-09T03:00:00.000Z" },
  { snapshotCreatedAt: "2026-10-09T04:26:00.000Z" },
  { expiresAt: "2026-10-09T05:00:00.000Z" },
  { expiresAt: "2026-10-09T04:25:00.000Z" },
  { issuedAt: "2026-10-09T04:25:00Z" },
  { snapshotArn: "arn:aws:rds:us-east-2:444455556666:snapshot:ai-job-apply-development-other" },
  { encryptionKeyArn: configuration().encryptionKeyArn.replace("111122223333", "444455556666") },
  { extra: "unknown" },
])("refuses an incompatible binding %j", (mutation) => {
  expect(() =>
    legacyReceiptMaintenanceFromEnvironment(environment(mutation), () => instant),
  ).toThrow("LegacyReceiptMaintenanceConfigurationRejected");
});
it.each([
  "NODE_ENV",
  "LEGACY_RECEIPT_TRANSITION_ENABLED",
  "LEGACY_RECEIPT_TRANSITION_CONFIG_JSON",
  "LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256",
  "DATABASE_URL",
])("withdraws authority after %s changes", (field) => {
  const env: Record<string, string> = environment();
  const admitted = legacyReceiptMaintenanceFromEnvironment(env, () => instant);
  env[field] = "changed";
  expect(admitted.enabled()).toBe(false);
  expect(() => legacyReceiptMaintenanceFromEnvironment(env, () => instant)).toThrow(
    "LegacyReceiptMaintenanceConfigurationRejected",
  );
});
it("does not evaluate environment getters and refuses a future invocation", () => {
  const getter = vi.fn(() => "true");
  const env = environment();
  Object.defineProperty(env, "LEGACY_RECEIPT_TRANSITION_ENABLED", {
    enumerable: true,
    get: getter,
  });
  expect(() => legacyReceiptMaintenanceFromEnvironment(env, () => instant)).toThrow(
    "LegacyReceiptMaintenanceConfigurationRejected",
  );
  expect(getter).not.toHaveBeenCalled();
  expect(() =>
    legacyReceiptMaintenanceFromEnvironment(environment(), () => instant - 10 * 60_000),
  ).toThrow("LegacyReceiptMaintenanceConfigurationRejected");
});

it.each([
  "",
  "?sslmode=disable",
  "?sslmode=require&sslmode=require",
  "?sslmode=require&application_name=other",
])("refuses database transport configuration %s", (suffix) => {
  const env = environment();
  env.DATABASE_URL = env.DATABASE_URL.replace("?sslmode=require", suffix);
  expect(() => legacyReceiptMaintenanceFromEnvironment(env, () => instant)).toThrow(
    "LegacyReceiptMaintenanceConfigurationRejected",
  );
});
