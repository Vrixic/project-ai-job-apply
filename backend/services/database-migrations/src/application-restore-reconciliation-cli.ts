import { existsSync } from "node:fs";
import { reconcileApplicationRestore } from "./application-restore-reconciliation.js";
import { resolveRestoreDataManifest } from "./restore-data-inventory-manifest.js";
import type { RestoreSqlClient, RestoreSqlExecutor } from "./restore-verifier.js";
import { createRestoreClient, resolveRestoreDatabaseUrl } from "./restore-verifier-runtime.js";

type Factory = (options: {
  encryptionKeyArn: string;
  enabled(): boolean;
  verifyActiveOwners(transaction: RestoreSqlExecutor, owners: readonly string[]): Promise<void>;
}) => {
  verify(
    original: RestoreSqlClient,
    restored: RestoreSqlClient,
    admission: () => void,
  ): Promise<{ readonly matchedReceipts: 7 }>;
};
async function main() {
  const enabled = () => process.env.RESTORE_APPLICATIONS_RECONCILIATION_ENABLED === "true";
  if (
    !enabled() ||
    !process.env.RESTORE_DATA_MANIFEST_GZIP_BASE64 ||
    !process.env.RESTORE_DATA_MANIFEST_SHA256
  )
    throw Error("DiagnosticAdmissionRequired");
  const compressedManifest = process.env.RESTORE_DATA_MANIFEST_GZIP_BASE64;
  const manifestSha = process.env.RESTORE_DATA_MANIFEST_SHA256;
  const key = process.env.RESTORE_LEGACY_RECEIPT_KEY_ARN;
  const startedAt = process.env.RESTORE_TRANSITION_STARTED_AT;
  const endedAt = process.env.RESTORE_TRANSITION_ENDED_AT;
  const originalHost = process.env.RESTORE_ORIGINAL_HOST;
  const restoredHost = process.env.RESTORE_HOST;
  // Hostnames are an additional primary-database refusal, not authenticated snapshot lineage.
  const host =
    /^ai-job-apply-development-restorecheck(?:-historical|-latest)?\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/;
  if (
    !key ||
    !startedAt ||
    !endedAt ||
    !originalHost ||
    !restoredHost ||
    originalHost === restoredHost ||
    !host.test(originalHost) ||
    !host.test(restoredHost)
  )
    throw Error("DiagnosticBindingsRequired");
  const originalUrl = resolveRestoreDatabaseUrl({ ...process.env, RESTORE_HOST: originalHost });
  const restoredUrl = resolveRestoreDatabaseUrl(process.env);
  const source = resolveRestoreDataManifest(process.env);
  const packageUrl = [
    new URL("../../applications/package.json", import.meta.url),
    new URL("../../../applications/package.json", import.meta.url),
  ].find((url) => existsSync(url));
  if (!packageUrl) throw Error("OwningVerifierUnavailable");
  const module = (await import(
    new URL("./dist/src/legacy-receipt-restore-verifier.js", packageUrl).href
  )) as { createLegacyReceiptRestoreVerifier: Factory };
  if (typeof module.createLegacyReceiptRestoreVerifier !== "function")
    throw Error("OwningVerifierUnavailable");
  const identityPackage = [
    new URL("../../profile/package.json", import.meta.url),
    new URL("../../../profile/package.json", import.meta.url),
  ].find((url) => existsSync(url));
  if (!identityPackage) throw Error("OwningIdentityVerifierUnavailable");
  const identity = (await import(
    new URL("./dist/src/restore-candidate-admission.js", identityPackage).href
  )) as {
    verifyRestoreCandidateOwners(
      transaction: RestoreSqlExecutor,
      owners: readonly string[],
    ): Promise<void>;
  };
  if (typeof identity.verifyRestoreCandidateOwners !== "function")
    throw Error("OwningIdentityVerifierUnavailable");
  const admitted = () =>
    enabled() &&
    process.env.RESTORE_DATA_MANIFEST_GZIP_BASE64 === compressedManifest &&
    process.env.RESTORE_DATA_MANIFEST_SHA256 === manifestSha &&
    process.env.RESTORE_LEGACY_RECEIPT_KEY_ARN === key &&
    process.env.RESTORE_ORIGINAL_HOST === originalHost &&
    process.env.RESTORE_HOST === restoredHost &&
    process.env.RESTORE_TRANSITION_STARTED_AT === startedAt &&
    process.env.RESTORE_TRANSITION_ENDED_AT === endedAt;
  const receipts = module.createLegacyReceiptRestoreVerifier({
    encryptionKeyArn: key,
    enabled: admitted,
    verifyActiveOwners: identity.verifyRestoreCandidateOwners,
  });
  const original = createRestoreClient(originalUrl);
  let restored: ReturnType<typeof createRestoreClient> | undefined;
  let result: Awaited<ReturnType<typeof reconcileApplicationRestore>> | undefined;
  let failed = false,
    closeFailed = false;
  try {
    restored = createRestoreClient(restoredUrl);
    result = await reconcileApplicationRestore(original, restored, {
      originalSource: source,
      transitionStartedAt: startedAt,
      transitionEndedAt: endedAt,
      enabled: admitted,
      verifyReceipts: receipts.verify,
    });
  } catch {
    failed = true;
  } finally {
    const restoredClient = restored;
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => original.end()),
      ...(restoredClient ? [Promise.resolve().then(() => restoredClient.end())] : []),
    ]);
    closeFailed = closed.some((item) => item.status === "rejected");
  }
  if (failed || closeFailed || !result) throw Error("DiagnosticFailed");
  console.log(JSON.stringify({ event: "application_restore_reconciliation", result }));
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "application_restore_reconciliation_failed",
      error_code: "verification_failed",
    }),
  );
  process.exitCode = 1;
});
