import { verifyDeletionRecoverySchema } from "./candidate-deletion-restore-schema.js";
import { createDatabase } from "@ai-job-apply/profile-service";
import {
  diagnoseHistoricalCompletion,
  type HistoricalCompletionEvidence,
  historicalCompletionEvidenceSha256,
  historicalCompletionRepairCandidateSha256,
  readHistoricalCompletionRepairCandidate,
} from "./candidate-deletion-completion-diagnosis.js";
import {
  collectHistoricalCompletionEvidence,
  type HistoricalCompletionEvidenceTarget,
} from "./candidate-deletion-completion-evidence.js";
import {
  AwsReadOnlyCandidateDeletionRestoreLedger,
  AwsReadOnlyCandidateRestoreDocuments,
} from "./candidate-deletion-restore-aws.js";
import {
  type CandidateDeletionRestoreCompletionDiagnosis,
  type CandidateDeletionRestoreConfiguration,
  type CandidateDeletionRestoreInspection,
  type CandidateDeletionRestoreReplayResult,
  loadRestoreEnvironment,
  RESTORE_INVOCATION_BUDGET_MS,
  RESTORE_RESULT_RESERVE_MS,
  restoreDigest,
  restoreInspectionSha256,
  validateRestoreCompletionDiagnosisResult,
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
import {
  type CandidateDeletionRestoreStoreFailure,
  PostgresCandidateDeletionRestoreStore,
  readCandidateDeletionRestoreStoreFailure,
} from "./candidate-deletion-restore-store.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Ledger = Pick<
  AwsReadOnlyCandidateDeletionRestoreLedger,
  "inspectCompletedMarkers" | "assertUnchanged" | "inspectCompletionEvidence"
>;
type Documents = Pick<AwsReadOnlyCandidateRestoreDocuments, "inspectExpectedAbsentDocuments">;
type Store = Pick<PostgresCandidateDeletionRestoreStore, "preflight" | "reconcile">;

type RestoreFailureStage =
  | "environment"
  | "request"
  | "version"
  | "budget"
  | "ledger_client"
  | "documents_client"
  | "marker_snapshot"
  | "marker_policy"
  | "store_open"
  | "store_preflight"
  | "completion_marker"
  | "completion_evidence"
  | "completion_diagnosis"
  | "completion_result"
  | "document_preflight"
  | "inspection_result"
  | "inspection_binding"
  | "ledger_recheck"
  | "document_recheck"
  | "reconcile"
  | "post_reconcile_ledger"
  | "post_reconcile_documents"
  | "replay_result"
  | "store_close";

export interface CandidateDeletionRestoreFailureDiagnostic {
  readonly event: "candidate_deletion_restore_rejected";
  readonly action: "unvalidated" | "inspect" | "replay" | "diagnose_completion";
  readonly stage: RestoreFailureStage;
  readonly storeFailure?: CandidateDeletionRestoreStoreFailure;
}

interface RestoreFailureLogger {
  error(diagnostic: CandidateDeletionRestoreFailureDiagnostic): void | Promise<void>;
}

const defaultFailureLogger: RestoreFailureLogger = {
  error: (diagnostic) => console.error(JSON.stringify(diagnostic)),
};

export interface CandidateDeletionRestoreContext {
  invokedFunctionArn: string;
  functionVersion: string;
  getRemainingTimeInMillis(): number;
}

export interface CandidateDeletionRestoreDependencies {
  logger?: RestoreFailureLogger;
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
    collectCompletionEvidence(
      target: HistoricalCompletionEvidenceTarget,
      signal: AbortSignal,
    ): Promise<HistoricalCompletionEvidence>;
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
    try {
      if (config.recoveryMode === "primary_recovery") {
        await verifyDeletionRecoverySchema(database, signal);
        if (signal.aborted) rejected();
      }
    } catch {
      await database.client.end({ timeout: 5 });
      rejected();
    }
    return {
      store: new PostgresCandidateDeletionRestoreStore(database),
      collectCompletionEvidence: (target, signal) =>
        collectHistoricalCompletionEvidence(database, target, signal),
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
  ): Promise<
    | CandidateDeletionRestoreInspection
    | CandidateDeletionRestoreReplayResult
    | CandidateDeletionRestoreCompletionDiagnosis
  > {
    let opened: Awaited<ReturnType<CandidateDeletionRestoreDependencies["openStore"]>> | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stage: RestoreFailureStage = "environment";
    let action: CandidateDeletionRestoreFailureDiagnostic["action"] = "unvalidated";
    // Classify the attempted boundary; only a module-owned store error adds its fixed reason.
    const logFailure = (failedStage: RestoreFailureStage, failure?: unknown) => {
      try {
        const storeFailure = readCandidateDeletionRestoreStoreFailure(failure);
        void Promise.resolve(
          (dependencies.logger ?? defaultFailureLogger).error({
            event: "candidate_deletion_restore_rejected",
            action,
            stage: failedStage,
            ...(storeFailure === undefined ? {} : { storeFailure }),
          }),
        ).catch(() => undefined);
      } catch {
        // Diagnostics must not replace the original generic refusal or prevent cleanup.
      }
    };
    try {
      const environment = Object.freeze({ ...dependencies.environment() });
      const { configuration, configurationSha256 } = loadRestoreEnvironment(
        environment,
        ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
        dependencies.now(),
      );
      stage = "request";
      const request = validateRestoreRequest(
        event,
        configuration,
        configurationSha256,
        context.invokedFunctionArn,
      );
      action = request.action;
      stage = "version";
      if (
        context.functionVersion !== request.functionVersion ||
        (environment.AWS_LAMBDA_FUNCTION_VERSION !== undefined &&
          environment.AWS_LAMBDA_FUNCTION_VERSION !== request.functionVersion)
      )
        rejected();
      stage = "budget";
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
      stage = "ledger_client";
      const ledger = dependencies.ledger(configuration, environment);
      stage = "documents_client";
      const documents =
        request.action === "diagnose_completion"
          ? undefined
          : dependencies.documents(configuration, environment);
      stage = "marker_snapshot";
      const snapshot = await ledger.inspectCompletedMarkers(active(), controller.signal);
      // Whole-set validation precedes even opening the restored database connection.
      stage = "marker_policy";
      const entries = validateHistoricalRecoveryEntries(snapshot.entries, active());
      const currentPolicyMarkers = entries.filter(
        (entry) => entry.policyVersion === CURRENT_CANDIDATE_DELETION_RESTORE_POLICY_VERSION,
      ).length;
      if (
        snapshot.currentPolicyMarkers !== currentPolicyMarkers ||
        snapshot.historicalPolicyMarkers !== entries.length - currentPolicyMarkers
      )
        rejected();
      if (request.action === "diagnose_completion") {
        if (entries.length !== 1) rejected();
        stage = "completion_marker";
        const marker = await ledger.inspectCompletionEvidence(
          snapshot,
          active(),
          controller.signal,
        );
        const target: HistoricalCompletionEvidenceTarget = {
          sourceSha: configuration.sourceSha,
          restoreContextSha256: configuration.restoreContextSha256,
          configurationSha256,
          markerSnapshotSha256: snapshot.sha256,
          marker,
        };
        stage = "store_open";
        opened = await dependencies.openStore(configuration, environment, controller.signal);
        active();
        stage = "completion_evidence";
        const evidence = await opened.collectCompletionEvidence(target, controller.signal);
        const evidenceSha256 = historicalCompletionEvidenceSha256(evidence);
        if (
          !evidenceSha256 ||
          evidence.sourceSha !== target.sourceSha ||
          evidence.restoreContextSha256 !== target.restoreContextSha256 ||
          evidence.configurationSha256 !== target.configurationSha256 ||
          evidence.markerSnapshotSha256 !== target.markerSnapshotSha256 ||
          historicalCompletionEvidenceSha256(evidence.marker) !==
            historicalCompletionEvidenceSha256(marker) ||
          evidence.durable !== null
        )
          rejected();
        stage = "completion_diagnosis";
        const diagnosis = diagnoseHistoricalCompletion(evidence, evidenceSha256, active());
        const candidate = readHistoricalCompletionRepairCandidate(diagnosis);
        const candidateSha256 = candidate
          ? historicalCompletionRepairCandidateSha256(candidate)
          : undefined;
        if (diagnosis.outcome === "persisted_candidate" && (!candidate || !candidateSha256))
          rejected();
        stage = "ledger_recheck";
        await ledger.assertUnchanged(snapshot, active(), controller.signal);
        const result: CandidateDeletionRestoreCompletionDiagnosis = {
          schemaVersion: 1,
          action: "diagnose_completion",
          outcome: diagnosis.outcome,
          runId: configuration.runId,
          sourceSha: configuration.sourceSha,
          configurationSha256,
          functionVersion: request.functionVersion,
          expiresAt: configuration.expiresAt,
          markerSnapshotSha256: snapshot.sha256,
          markersValidated: 1,
          comparison: diagnosis.comparison
            ? {
                ...diagnosis.comparison,
                completionCollisions: [...diagnosis.comparison.completionCollisions].sort(),
              }
            : null,
          reason: diagnosis.outcome === "refused" ? diagnosis.reason : null,
          corroboration:
            diagnosis.outcome === "persisted_candidate" ? diagnosis.corroboration : null,
          dispatchEvidence: diagnosis.dispatchEvidence,
          candidate:
            candidate && candidateSha256
              ? {
                  correctedCompletedAt: candidate.correctedCompletedAt,
                  evidenceSha256,
                  candidateSha256,
                }
              : null,
          databaseWrites: 0,
          s3Writes: 0,
          recoveryLedgerWrites: 0,
          identityProviderCalls: 0,
        };
        stage = "completion_result";
        if (!validateRestoreCompletionDiagnosisResult(result)) rejected();
        active();
        return result;
      }
      if (!documents) rejected();
      stage = "store_open";
      opened = await dependencies.openStore(configuration, environment, controller.signal);
      active();
      stage = "store_preflight";
      const preflight = await opened.store.preflight(entries, controller.signal);
      active();
      stage = "document_preflight";
      const absent = await documents.inspectExpectedAbsentDocuments(
        preflight.documentObjects,
        controller.signal,
      );
      active();
      stage = "inspection_result";
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
      stage = "inspection_binding";
      if (
        request.action === "replay" &&
        request.reviewedInspectionSha256 !== inspection.inspectionSha256
      )
        rejected();
      // Re-read immutable cloud authority immediately before any restored SQL writes.
      stage = "ledger_recheck";
      await ledger.assertUnchanged(snapshot, active(), controller.signal);
      stage = "document_recheck";
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
      stage = "reconcile";
      const reconciliation = await opened.store.reconcile(entries, preflight, controller.signal);
      active();
      stage = "post_reconcile_ledger";
      await ledger.assertUnchanged(snapshot, active(), controller.signal);
      stage = "post_reconcile_documents";
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
      stage = "replay_result";
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
    } catch (failure) {
      logFailure(stage, failure);
      return rejected();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      try {
        await opened?.close();
      } catch (failure) {
        logFailure("store_close", failure);
        rejected();
      }
    }
  };
}

export const handler = createCandidateDeletionRestoreHandler();
