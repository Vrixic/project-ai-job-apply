import {
  calculateReconciledCopyConfigurationSha256,
  type ReconciledCopyConfiguration,
  reconciledCopyReceiptSha256,
  serializeReconciledCopyConfiguration,
} from "./candidate-deletion-reconciled-copy-contract.js";
import { restoreInspectionSha256 } from "./candidate-deletion-restore-contract.js";

export function reconciledRuntimeFixture() {
  const originalReceipt = {
    schemaVersion: 1 as const,
    action: "replay" as const,
    outcome: "replayed" as const,
    runId: "a".repeat(32),
    sourceSha: "b".repeat(40),
    configurationSha256: "c".repeat(64),
    functionVersion: "3",
    expiresAt: "2026-09-01T00:30:00.000Z",
    markerSnapshotSha256: "d".repeat(64),
    restoredPreflightSha256: "e".repeat(64),
    inspectionSha256: restoreInspectionSha256("c".repeat(64), "d".repeat(64), "e".repeat(64)),
    markersValidated: 0,
    historicalPolicyMarkers: 0,
    currentPolicyMarkers: 0,
    restoredSubjectsPresent: 0,
    restoredSubjectsAbsent: 0,
    documentKeysChecked: 0,
    documentVersionsObserved: 0 as const,
    restoredUsersReconciled: 0,
    restoredUsersAlreadyReconciled: 0,
    restoredUsersAbsent: 0,
    s3Writes: 0 as const,
    recoveryLedgerWrites: 0 as const,
    identityProviderCalls: 0 as const,
    preservation: {
      schemaVersion: 1 as const,
      unchanged: { sha256: "f".repeat(64), relationCount: 100 as const, rowCount: 0, byteCount: 0 },
      reconciled: {
        sha256: "f".repeat(64),
        relationCount: 100 as const,
        rowCount: 0,
        byteCount: 0,
      },
    },
  };
  const configuration: ReconciledCopyConfiguration = {
    schemaVersion: 1,
    runId: "1".repeat(32),
    accountId: "111122223333",
    region: "us-east-2",
    sourceSha: "2".repeat(40),
    mode: "reconciled_isolated",
    targetIdentifier: "ai-job-apply-development-restore-20261011000000",
    targetDbiResourceId: "db-ABCDEFGHIJKLMNOPQRSTUVWX",
    targetHostname:
      "ai-job-apply-development-restore-20261011000000.example.us-east-2.rds.amazonaws.com",
    targetBoundarySha256: "3".repeat(64),
    operatorEvidenceSha256: "4".repeat(64),
    originalReceiptSha256: reconciledCopyReceiptSha256(originalReceipt),
    originalInvocationSha256: "5".repeat(64),
    originalConfigurationSha256: originalReceipt.configurationSha256,
    originalIssuedAt: "2026-09-01T00:00:00.000Z",
    issuedAt: "2026-10-11T00:00:00.000Z",
    expiresAt: "2026-10-11T00:30:00.000Z",
  };
  const environment: Record<string, string> = {
    NODE_ENV: "production",
    RELEASE_SHA: configuration.sourceSha,
    DATABASE_SECRET_ID:
      "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-AbCd12",
    CANDIDATE_DOCUMENT_BUCKET: "synthetic-candidate-documents",
    CANDIDATE_DELETION_RECOVERY_BUCKET: "synthetic-recovery-markers",
    CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN:
      "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111",
    RECONCILED_COPY_CONFIG_JSON: serializeReconciledCopyConfiguration(configuration),
    RECONCILED_COPY_CONFIG_SHA256: "",
  };
  const seal = () => {
    environment.RECONCILED_COPY_CONFIG_JSON = serializeReconciledCopyConfiguration(configuration);
    environment.RECONCILED_COPY_CONFIG_SHA256 =
      calculateReconciledCopyConfigurationSha256(environment);
  };
  seal();
  const request = {
    schemaVersion: 1,
    action: "verify",
    runId: configuration.runId,
    configurationSha256: environment.RECONCILED_COPY_CONFIG_SHA256,
    functionVersion: "7",
    originalReceipt,
  };
  const context = {
    invokedFunctionArn: `arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-verify-${configuration.runId}:7`,
    functionVersion: "7",
    getRemainingTimeInMillis: () => 180_000,
  };
  return {
    originalReceipt,
    configuration,
    environment,
    seal,
    request,
    context,
    now: new Date("2026-10-11T00:01:00.000Z"),
  };
}
