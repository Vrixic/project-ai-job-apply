import type { DatabaseHandle, ProfileStore } from "@ai-job-apply/profile-service";
import {
  createDatabase,
  errorCodeFromUnknown,
  loadCandidateRightsPolicy,
  PostgresProfileStore,
  PostgresResumeProposalWriter,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import type { Handler } from "aws-lambda";
import { createProfileReadinessActivities } from "./activities.js";
import {
  createCandidateRightsActivityHandler,
  PostgresCandidateRightsActivityStore,
} from "./candidate-rights-activities.js";
import { Auth0CandidateIdentityProvider } from "./candidate-rights-auth0.js";
import {
  AwsCandidateDocumentObjectStore,
  AwsCandidateExportArtifactStore,
} from "./candidate-rights-aws.js";
import {
  type CandidateRightsActivityResultV1,
  validateCandidateRightsActivityInput,
} from "./candidate-rights-durable.js";
import { AwsCandidateDeletionRecoveryLedger } from "./candidate-rights-recovery-ledger.js";
import { resolveCandidateRightsAuth0Secret } from "./candidate-rights-secret.js";
import {
  type ProfileReadinessActivityInputV1,
  type ProfileReadinessActivityResultV1,
  validateProfileReadinessActivityInput,
} from "./profile-readiness-durable.js";

type ReadinessActivityStore = Pick<
  ProfileStore,
  | "getPreferencesById"
  | "markOperationRunning"
  | "completeReadinessOperation"
  | "failReadinessOperation"
  | "failDurableReadinessOperation"
>;

export type DurableTerminalStatus = "FAILED" | "RUNNING" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT";

export interface DurableTerminalEvent {
  source: "aws.lambda";
  "detail-type": "Durable Execution Status Change";
  detail: {
    durableExecutionArn: string;
    durableExecutionName: string;
    functionArn: string;
    status: DurableTerminalStatus;
  };
}

export type ProfileReadinessActivityHandler = (
  event: unknown,
) => Promise<ProfileReadinessActivityResultV1>;
export type DurableTerminalHandler = (event: unknown) => Promise<{ handled: boolean }>;
export interface CandidateRightsMaintenanceResult {
  schemaVersion: 1;
  scanned: number;
  expired: number;
  resumePurge: { scanned: number; purged: number; failed: number; heldWaiting: number };
}

function safeFailureCode(error: unknown): string {
  const candidate =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(candidate)
    ? candidate
    : errorCodeFromUnknown(error);
}

function isRetryableActivityFailure(error: unknown): boolean {
  const code = safeFailureCode(error);
  return (
    /^08/u.test(code) ||
    /^53/u.test(code) ||
    [
      "40001",
      "40P01",
      "55P03",
      "57014",
      "57P01",
      "AbortError",
      "ConnectionError",
      "ETIMEDOUT",
      "TimeoutError",
    ].includes(code)
  );
}

function completed(
  action: ProfileReadinessActivityInputV1["action"],
): ProfileReadinessActivityResultV1 {
  return { schemaVersion: 1, action, outcome: "completed" };
}

export function createProfileReadinessActivityHandler(
  store: ReadinessActivityStore,
): ProfileReadinessActivityHandler {
  const activities = createProfileReadinessActivities(store);
  return async (event) => {
    if (!validateProfileReadinessActivityInput(event)) {
      return {
        schemaVersion: 1,
        action: "mark_running",
        outcome: "non_retryable_failure",
        errorCode: "ActivityInputRejected",
      };
    }
    try {
      if (event.action === "mark_running") {
        await activities.markRunning(event);
      } else if (event.action === "calculate_and_persist") {
        await activities.calculateAndPersist(event);
      } else {
        await store.failReadinessOperation(
          event.operationId,
          event.preferenceSetId,
          event.errorCode ?? "WorkflowFailure",
        );
      }
      return completed(event.action);
    } catch (error) {
      return {
        schemaVersion: 1,
        action: event.action,
        outcome: isRetryableActivityFailure(error) ? "retryable_failure" : "non_retryable_failure",
        errorCode: safeFailureCode(error),
      };
    }
  };
}

function isTerminalEvent(
  value: unknown,
  expectedFunctionArn: string,
): value is DurableTerminalEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Partial<DurableTerminalEvent>;
  const detail = event.detail;
  return (
    event.source === "aws.lambda" &&
    event["detail-type"] === "Durable Execution Status Change" &&
    typeof detail === "object" &&
    detail !== null &&
    detail.functionArn === expectedFunctionArn &&
    typeof detail.durableExecutionArn === "string" &&
    typeof detail.durableExecutionName === "string" &&
    /^outbox-[0-9a-f-]{36}$/iu.test(detail.durableExecutionName) &&
    ["FAILED", "RUNNING", "STOPPED", "SUCCEEDED", "TIMED_OUT"].includes(String(detail.status))
  );
}

export function createDurableTerminalHandler(
  store: {
    reconcileDurableOperationFailure(executionName: string, errorCode: string): Promise<void>;
  },
  expectedFunctionArn: string,
): DurableTerminalHandler {
  return async (event) => {
    if (!isTerminalEvent(event, expectedFunctionArn)) {
      throw new Error("DurableTerminalEventRejected");
    }
    if (!["FAILED", "STOPPED", "TIMED_OUT"].includes(event.detail.status)) {
      return { handled: false };
    }
    const errorCode =
      event.detail.status === "STOPPED"
        ? "WorkflowStopped"
        : event.detail.status === "TIMED_OUT"
          ? "WorkflowTimedOut"
          : "WorkflowFailed";
    await store.reconcileDurableOperationFailure(event.detail.durableExecutionName, errorCode);
    return { handled: true };
  };
}

function isCandidateRightsMaintenanceEvent(value: unknown, expectedRuleArn: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const rule =
    /^arn:(aws|aws-us-gov|aws-cn):events:([a-z]{2}(?:-[a-z]+)+-[0-9]):([0-9]{12}):rule\/[A-Za-z0-9._/-]+$/u.exec(
      expectedRuleArn,
    );
  return (
    rule !== null &&
    event.account === rule[3] &&
    event.region === rule[2] &&
    event.source === "aws.events" &&
    event["detail-type"] === "Scheduled Event" &&
    Array.isArray(event.resources) &&
    event.resources.length === 1 &&
    event.resources[0] === expectedRuleArn &&
    !!event.detail &&
    typeof event.detail === "object" &&
    !Array.isArray(event.detail) &&
    Object.keys(event.detail as object).length === 0
  );
}

export function createCandidateRightsMaintenanceHandler(
  store: Pick<PostgresCandidateRightsActivityStore, "expireDueExports" | "purgeDeletedResumes">,
  expectedRuleArn: string,
): (event: unknown) => Promise<CandidateRightsMaintenanceResult> {
  if (!expectedRuleArn) throw new Error("CandidateRightsMaintenanceConfigurationInvalid");
  return async (event) => {
    if (!isCandidateRightsMaintenanceEvent(event, expectedRuleArn)) {
      throw new Error("CandidateRightsMaintenanceEventRejected");
    }
    // The two sweeps are independent: one failing must not stop the other. Both run, then any failure is raised so the
    // Lambda error alarm and the rule's dead-letter alarm fire (ADR-034).
    let exportResult: { scanned: number; expired: number } | undefined;
    let exportFailure: unknown;
    try {
      exportResult = await store.expireDueExports();
    } catch (error) {
      exportFailure = error;
    }
    let purgeResult: CandidateRightsMaintenanceResult["resumePurge"] | undefined;
    let purgeFailure: unknown;
    try {
      purgeResult = await store.purgeDeletedResumes();
      console.info({ event: "resume_purge_swept", ...purgeResult });
    } catch (error) {
      purgeFailure = error;
    }
    if (exportFailure !== undefined) throw exportFailure;
    if (purgeFailure !== undefined) throw purgeFailure;
    if (!exportResult || !purgeResult) throw new Error("CandidateRightsMaintenanceResultMissing");
    if (purgeResult.failed > 0) throw new Error("ResumePurgeIncomplete");
    return { schemaVersion: 1, ...exportResult, resumePurge: purgeResult };
  };
}

let runtimeDatabase: DatabaseHandle | undefined;
let runtimeStore: PostgresProfileStore | undefined;
let runtimeCandidateRightsStore: PostgresCandidateRightsActivityStore | undefined;

async function getRuntimeDatabase(): Promise<DatabaseHandle> {
  if (!runtimeDatabase) {
    const databaseUrl = await resolveLambdaDatabaseUrl(
      {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.DATABASE_SECRET_ID
          ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
          : {}),
      },
      { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
    );
    runtimeDatabase = createDatabase(databaseUrl, { maxConnections: 1 });
  }
  return runtimeDatabase;
}

async function getRuntimeStore(): Promise<PostgresProfileStore> {
  runtimeStore ??= new PostgresProfileStore(await getRuntimeDatabase());
  return runtimeStore;
}

async function getRuntimeCandidateRightsStore(): Promise<PostgresCandidateRightsActivityStore> {
  if (runtimeCandidateRightsStore) return runtimeCandidateRightsStore;
  const exportBucket = process.env.CANDIDATE_DATA_EXPORT_BUCKET;
  const exportKmsKeyArn = process.env.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN;
  const documentBucket = process.env.CANDIDATE_DOCUMENT_BUCKET;
  const recoveryBucket = process.env.CANDIDATE_DELETION_RECOVERY_BUCKET;
  const issuer = process.env.OIDC_ISSUER;
  if (!exportBucket || !exportKmsKeyArn || !documentBucket || !recoveryBucket || !issuer) {
    throw new Error("CandidateRightsRuntimeConfigurationIncomplete");
  }
  const policy = loadCandidateRightsPolicy(process.env);
  if (policy.subprocessorInventory.length !== 0) {
    throw new Error("CandidateRightsSubprocessorAdapterUnavailable");
  }
  const auth0 = await resolveCandidateRightsAuth0Secret(
    process.env.CANDIDATE_RIGHTS_AUTH0_SECRET_ID,
    { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
  );
  runtimeCandidateRightsStore = new PostgresCandidateRightsActivityStore({
    database: await getRuntimeDatabase(),
    policy,
    artifactStore: new AwsCandidateExportArtifactStore(exportBucket, exportKmsKeyArn),
    documentObjectStore: new AwsCandidateDocumentObjectStore(documentBucket),
    resumeProposals: new PostgresResumeProposalWriter(),
    identityProvider: new Auth0CandidateIdentityProvider({ issuer, ...auth0 }),
    subprocessors: [],
    recoveryLedger: new AwsCandidateDeletionRecoveryLedger(recoveryBucket, exportKmsKeyArn),
  });
  return runtimeCandidateRightsStore;
}

export const activity: Handler<
  unknown,
  | ProfileReadinessActivityResultV1
  | CandidateRightsActivityResultV1
  | CandidateRightsMaintenanceResult
> = async (event) => {
  // Terraform supplies this exact rule only while candidate rights are enabled.
  const maintenanceRuleArn = process.env.CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN;
  if (maintenanceRuleArn && isCandidateRightsMaintenanceEvent(event, maintenanceRuleArn)) {
    return createCandidateRightsMaintenanceHandler(
      await getRuntimeCandidateRightsStore(),
      maintenanceRuleArn,
    )(event);
  }
  if (validateCandidateRightsActivityInput(event)) {
    return createCandidateRightsActivityHandler(await getRuntimeCandidateRightsStore())(event);
  }
  if (!validateProfileReadinessActivityInput(event)) {
    return {
      schemaVersion: 1,
      action: "mark_running",
      outcome: "non_retryable_failure",
      errorCode: "ActivityInputRejected",
    };
  }
  return createProfileReadinessActivityHandler(await getRuntimeStore())(event);
};

export const terminal: Handler<unknown, { handled: boolean }> = async (event) => {
  const durableFunctionArn = process.env.DURABLE_FUNCTION_ARN;
  if (!durableFunctionArn) {
    throw new Error("DURABLE_FUNCTION_ARN is required");
  }
  return createDurableTerminalHandler(await getRuntimeStore(), durableFunctionArn)(event);
};

export const maintenance: Handler<unknown, CandidateRightsMaintenanceResult> = async (event) => {
  const ruleArn = process.env.CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN;
  if (!ruleArn) throw new Error("CANDIDATE_RIGHTS_MAINTENANCE_RULE_ARN is required");
  if (!isCandidateRightsMaintenanceEvent(event, ruleArn)) {
    throw new Error("CandidateRightsMaintenanceEventRejected");
  }
  return createCandidateRightsMaintenanceHandler(
    await getRuntimeCandidateRightsStore(),
    ruleArn,
  )(event);
};
