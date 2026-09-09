import { createDatabase } from "@ai-job-apply/profile-service";
import {
  AwsReadOnlyCandidateDeletionRestoreLedger,
  AwsReadOnlyCandidateRestoreDocuments,
} from "./candidate-deletion-restore-aws.js";
import {
  type CandidateDeletionRestoreConfiguration,
  type CandidateDeletionRestoreInspection,
  type CandidateDeletionRestoreReplayResult,
  loadRestoreEnvironment,
  RESTORE_INVOCATION_BUDGET_MS,
  RESTORE_RESULT_RESERVE_MS,
  restoreDigest,
  restoreInspectionSha256,
  validateRestoreInspectionResult,
  validateRestoreReplayResult,
  validateRestoreRequest,
} from "./candidate-deletion-restore-contract.js";
import { resolveRestoredDatabaseUrl } from "./candidate-deletion-restore-database.js";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
  CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION,
  validateHistoricalRecoveryEntries,
} from "./candidate-deletion-restore-policy.js";
import { PostgresCandidateDeletionRestoreStore } from "./candidate-deletion-restore-store.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Ledger = Pick<
  AwsReadOnlyCandidateDeletionRestoreLedger,
  "inspectCompletedMarkers" | "assertUnchanged"
>;
type Documents = Pick<AwsReadOnlyCandidateRestoreDocuments, "inspectExpectedAbsentDocuments">;
type Store = Pick<PostgresCandidateDeletionRestoreStore, "preflight" | "reconcile">;

export interface CandidateDeletionRestoreContext {
  invokedFunctionArn: string;
  functionVersion: string;
  getRemainingTimeInMillis(): number;
}

export interface CandidateDeletionRestoreDependencies {
  environment(): Environment;
  now(): Date;
  ledger(configuration: CandidateDeletionRestoreConfiguration, environment: Environment): Ledger;
  documents(
    configuration: CandidateDeletionRestoreConfiguration,
    environment: Environment,
  ): Documents;
  openStore(
    configuration: CandidateDeletionRestoreConfiguration,
    environment: Environment,
    signal: AbortSignal,
  ): Promise<{
    store: Store;
    close(): Promise<void>;
  }>;
}

function rejected(): never {
  // No provider/SQL errors, decrypted locators, source bodies or credentials in logs.
  throw new Error("CandidateDeletionRestoreRejected");
}

const defaults: CandidateDeletionRestoreDependencies = {
  environment: () => process.env,
  now: () => new Date(),
  ledger: (config, environment) =>
    new AwsReadOnlyCandidateDeletionRestoreLedger({
      bucketName: environment.CANDIDATE_DELETION_RECOVERY_BUCKET ?? "",
      expectedBucketOwner: config.accountId,
      kmsKeyArn: environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN ?? "",
    }),
  documents: (config, environment) =>
    new AwsReadOnlyCandidateRestoreDocuments({
      bucketName: environment.CANDIDATE_DOCUMENT_BUCKET ?? "",
      expectedBucketOwner: config.accountId,
    }),
  openStore: async (config, environment, signal) => {
    const restoredUrl = await resolveRestoredDatabaseUrl(config, environment, signal);
    if (signal.aborted) rejected();
    // A new single-connection pool per invocation. Never use the live cached pool.
    const database = createDatabase(restoredUrl, { maxConnections: 1 });
    return {
      store: new PostgresCandidateDeletionRestoreStore(database),
      close: async () => {
        await database.client.end({ timeout: 5 });
      },
    };
  },
};

/** Direct, version-qualified IAM invocation only; this is not an API/queue handler. */
export function createCandidateDeletionRestoreHandler(
  dependencies: CandidateDeletionRestoreDependencies = defaults,
) {
  return async function run(
    event: unknown,
    context: CandidateDeletionRestoreContext,
  ): Promise<CandidateDeletionRestoreInspection | CandidateDeletionRestoreReplayResult> {
    let opened: Awaited<ReturnType<CandidateDeletionRestoreDependencies["openStore"]>> | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const environment = Object.freeze({ ...dependencies.environment() });
      const { configuration, configurationSha256 } = loadRestoreEnvironment(
        environment,
        ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
        dependencies.now(),
      );
      const request = validateRestoreRequest(
        event,
        configuration,
        configurationSha256,
        context.invokedFunctionArn,
      );
      if (
        context.functionVersion !== request.functionVersion ||
        (environment.AWS_LAMBDA_FUNCTION_VERSION !== undefined &&
          environment.AWS_LAMBDA_FUNCTION_VERSION !== request.functionVersion)
      )
        rejected();
      const remainingMs = context.getRemainingTimeInMillis();
      if (
        !Number.isFinite(remainingMs) ||
        remainingMs <= RESTORE_RESULT_RESERVE_MS ||
        remainingMs > RESTORE_INVOCATION_BUDGET_MS
      )
        rejected();
      timer = setTimeout(() => controller.abort(), remainingMs - RESTORE_RESULT_RESERVE_MS);
      const active = () => {
        const now = dependencies.now();
        if (
          controller.signal.aborted ||
          !Number.isFinite(now.getTime()) ||
          now.getTime() >= Date.parse(configuration.expiresAt) ||
          context.getRemainingTimeInMillis() <= RESTORE_RESULT_RESERVE_MS
        )
          rejected();
        return now;
      };
      const ledger = dependencies.ledger(configuration, environment);
      const documents = dependencies.documents(configuration, environment);
      const snapshot = await ledger.inspectCompletedMarkers(active(), controller.signal);
      // Whole-set validation precedes even opening the restored database connection.
      const entries = validateHistoricalRecoveryEntries(snapshot.entries, active());
      const currentPolicyMarkers = entries.filter(
        (entry) => entry.policyVersion === CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION,
      ).length;
      if (
        snapshot.currentPolicyMarkers !== currentPolicyMarkers ||
        snapshot.historicalPolicyMarkers !== entries.length - currentPolicyMarkers
      )
        rejected();
      opened = await dependencies.openStore(configuration, environment, controller.signal);
      active();
      const preflight = await opened.store.preflight(entries, controller.signal);
      active();
      const absent = await documents.inspectExpectedAbsentDocuments(
        preflight.documentObjects,
        controller.signal,
      );
      active();
      if (
        ![preflight.sha256, absent.sha256].every(
          (sha) => /^[a-f0-9]{64}$/u.test(sha) && sha.length === 64,
        )
      )
        rejected();
      const restoredPreflightSha256 = restoreDigest("candidate-deletion-restore-preflight-v1", [
        preflight.sha256,
        absent.sha256,
      ]);
      const inspection: CandidateDeletionRestoreInspection = {
        schemaVersion: 1,
        action: "inspect",
        outcome: "inspected",
        runId: configuration.runId,
        sourceSha: configuration.sourceSha,
        configurationSha256,
        functionVersion: request.functionVersion,
        expiresAt: configuration.expiresAt,
        markerSnapshotSha256: snapshot.sha256,
        restoredPreflightSha256,
        inspectionSha256: restoreInspectionSha256(
          configurationSha256,
          snapshot.sha256,
          restoredPreflightSha256,
        ),
        markersValidated: entries.length,
        historicalPolicyMarkers: snapshot.historicalPolicyMarkers,
        currentPolicyMarkers,
        restoredSubjectsPresent: preflight.restoredSubjectsPresent,
        restoredSubjectsAbsent: preflight.restoredSubjectsAbsent,
        documentKeysChecked: absent.documentKeysChecked,
        documentVersionsObserved: absent.documentVersionsObserved,
      };
      if (
        !validateRestoreInspectionResult(inspection) ||
        inspection.restoredSubjectsPresent + inspection.restoredSubjectsAbsent !== entries.length
      )
        rejected();
      if (
        request.action === "replay" &&
        request.reviewedInspectionSha256 !== inspection.inspectionSha256
      )
        rejected();
      // Re-read immutable cloud authority immediately before any restored SQL writes.
      await ledger.assertUnchanged(snapshot, active(), controller.signal);
      const rechecked = await documents.inspectExpectedAbsentDocuments(
        preflight.documentObjects,
        controller.signal,
      );
      if (
        rechecked.sha256 !== absent.sha256 ||
        rechecked.documentVersionsObserved !== 0 ||
        rechecked.documentKeysChecked !== absent.documentKeysChecked
      )
        rejected();
      active();
      if (request.action === "inspect") return inspection;
      // Store revalidates the entire preflight under one serializable transaction
      // before invoking any of the seven authoritative owner deletion boundaries.
      const reconciliation = await opened.store.reconcile(entries, preflight, controller.signal);
      active();
      await ledger.assertUnchanged(snapshot, active(), controller.signal);
      const after = await documents.inspectExpectedAbsentDocuments(
        preflight.documentObjects,
        controller.signal,
      );
      if (
        after.sha256 !== absent.sha256 ||
        after.documentVersionsObserved !== 0 ||
        after.documentKeysChecked !== absent.documentKeysChecked
      )
        rejected();
      const result: CandidateDeletionRestoreReplayResult = {
        ...inspection,
        action: "replay",
        outcome: "replayed",
        ...reconciliation,
        s3Writes: 0,
        recoveryLedgerWrites: 0,
        identityProviderCalls: 0,
      };
      if (
        !validateRestoreReplayResult(result) ||
        result.restoredUsersAbsent !== inspection.restoredSubjectsAbsent ||
        result.restoredUsersReconciled + result.restoredUsersAlreadyReconciled !==
          inspection.restoredSubjectsPresent
      )
        rejected();
      active();
      return result;
    } catch {
      return rejected();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      try {
        await opened?.close();
      } catch {
        rejected();
      }
    }
  };
}

export const handler = createCandidateDeletionRestoreHandler();
