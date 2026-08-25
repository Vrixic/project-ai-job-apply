import {
  eventTypes,
  type ProfileAccountDeletionConfirmedData,
  type ProfileDataExportRequestedData,
  validateEventData,
} from "@ai-job-apply/event-contracts";
import {
  type DurableContext,
  type DurableExecutionHandler,
  type DurableLambdaHandler,
  withDurableExecution,
  withRetry,
} from "@aws/durable-execution-sdk-js";
import type { DurableExecutionPayloadV1 } from "./serverless-outbox.js";

export const CANDIDATE_RIGHTS_WORKFLOW_DEFINITION_VERSION = 1 as const;

export const candidateRightsOperationNames = {
  exportBegin: "candidate-rights.export.begin.v1",
  exportAssemble: "candidate-rights.export.assemble.v1",
  exportFail: "candidate-rights.export.fail.v1",
  deletionRecordRecovery: "candidate-rights.deletion.record-recovery.v1",
  deletionDeleteActiveSystems: "candidate-rights.deletion.delete-active-systems.v1",
  deletionReconcileSubprocessors: "candidate-rights.deletion.reconcile-subprocessors.v1",
  deletionComplete: "candidate-rights.deletion.complete.v1",
} as const;

export type CandidateRightsActivityAction =
  | "export_begin"
  | "export_assemble"
  | "export_fail"
  | "deletion_record_recovery"
  | "deletion_delete_active_systems"
  | "deletion_reconcile_subprocessors"
  | "deletion_complete";

export interface CandidateRightsActivityInputV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  action: CandidateRightsActivityAction;
  eventId: string;
  resourceId: string;
  operationId: string;
  policyVersion: string;
  traceparent?: string;
  errorCode?: string;
}

export interface CandidateRightsActivityResultV1 {
  schemaVersion: 1;
  action: CandidateRightsActivityAction;
  outcome: "completed" | "retryable_failure" | "non_retryable_failure";
  errorCode?: string;
}

export interface CandidateRightsWorkflowResultV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  eventId: string;
  resourceId: string;
  operationId: string;
  kind: "candidate_data_export" | "account_deletion";
  state: "succeeded";
}

type CandidateRightsDurableInput = DurableExecutionPayloadV1 &
  (
    | {
        eventType: typeof eventTypes.profileDataExportRequested;
        data: ProfileDataExportRequestedData;
      }
    | {
        eventType: typeof eventTypes.profileAccountDeletionConfirmed;
        data: ProfileAccountDeletionConfirmedData;
      }
  );

class NonRetryableCandidateRightsError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "NonRetryableCandidateRightsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isPolicyVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value);
}

function isSafeErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value);
}

function isTraceparent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(value) &&
    !value.includes("00000000000000000000000000000000") &&
    !value.includes("-0000000000000000-")
  );
}

export function validateCandidateRightsDurableInput(
  value: unknown,
): value is CandidateRightsDurableInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "eventId", "eventType", "data", "traceparent"]) ||
    value.schemaVersion !== 1 ||
    !isUuid(value.eventId) ||
    ![eventTypes.profileDataExportRequested, eventTypes.profileAccountDeletionConfirmed].includes(
      String(value.eventType) as never,
    ) ||
    !isRecord(value.data) ||
    !validateEventData(String(value.eventType), value.data) ||
    (value.traceparent !== undefined && !isTraceparent(value.traceparent))
  ) {
    return false;
  }
  return true;
}

export function validateCandidateRightsActivityInput(
  value: unknown,
): value is CandidateRightsActivityInputV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "action",
      "eventId",
      "resourceId",
      "operationId",
      "policyVersion",
      "traceparent",
      "errorCode",
    ]) ||
    value.schemaVersion !== 1 ||
    value.workflowDefinitionVersion !== CANDIDATE_RIGHTS_WORKFLOW_DEFINITION_VERSION ||
    ![
      "export_begin",
      "export_assemble",
      "export_fail",
      "deletion_record_recovery",
      "deletion_delete_active_systems",
      "deletion_reconcile_subprocessors",
      "deletion_complete",
    ].includes(String(value.action)) ||
    !isUuid(value.eventId) ||
    !isUuid(value.resourceId) ||
    !isUuid(value.operationId) ||
    !isPolicyVersion(value.policyVersion) ||
    (value.traceparent !== undefined && !isTraceparent(value.traceparent)) ||
    (value.errorCode !== undefined && !isSafeErrorCode(value.errorCode))
  ) {
    return false;
  }
  return value.action === "export_fail"
    ? value.errorCode !== undefined
    : value.errorCode === undefined;
}

export function validateCandidateRightsActivityResult(
  value: unknown,
  expectedAction: CandidateRightsActivityAction,
): value is CandidateRightsActivityResultV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "action", "outcome", "errorCode"]) ||
    value.schemaVersion !== 1 ||
    value.action !== expectedAction ||
    !["completed", "retryable_failure", "non_retryable_failure"].includes(String(value.outcome))
  ) {
    return false;
  }
  return value.outcome === "completed"
    ? value.errorCode === undefined
    : isSafeErrorCode(value.errorCode);
}

function deterministicRetryDelay(
  eventId: string,
  operationName: string,
  attempt: number,
): { seconds: number } {
  let hash = 2166136261;
  for (const character of `${eventId}:${operationName}:${attempt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const baseSeconds = Math.min(2 ** attempt, 16);
  const jitterSeconds = Math.abs(hash) % Math.max(1, baseSeconds);
  return { seconds: Math.min(30, baseSeconds + jitterSeconds) };
}

async function invokeActivity(
  context: DurableContext,
  activityFunctionArn: string,
  operationName: string,
  input: CandidateRightsActivityInputV1,
): Promise<void> {
  await withRetry(
    context,
    operationName,
    async (attemptContext, attempt) => {
      const result = await attemptContext.invoke<
        CandidateRightsActivityInputV1,
        CandidateRightsActivityResultV1
      >(`${operationName}.attempt-${attempt}`, activityFunctionArn, input);
      if (!validateCandidateRightsActivityResult(result, input.action)) {
        throw new NonRetryableCandidateRightsError("ActivityContractViolation");
      }
      if (result.outcome === "non_retryable_failure") {
        throw new NonRetryableCandidateRightsError(result.errorCode ?? "ActivityRejected");
      }
      if (result.outcome === "retryable_failure") {
        throw new Error(result.errorCode ?? "ActivityRetryableFailure");
      }
    },
    {
      wrapWithRunInChildContext: false,
      retryStrategy: (error, attempt) => ({
        shouldRetry: !(error instanceof NonRetryableCandidateRightsError) && attempt < 5,
        delay: deterministicRetryDelay(input.eventId, operationName, attempt),
      }),
    },
  );
}

function workflowFailureCode(error: unknown): string {
  return error instanceof NonRetryableCandidateRightsError
    ? "WorkflowNonRetryableFailure"
    : "WorkflowActivityRetryExhausted";
}

export function createCandidateRightsWorkflow(
  activityFunctionArn: string,
): DurableExecutionHandler<DurableExecutionPayloadV1, CandidateRightsWorkflowResultV1> {
  if (
    !/^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]+:[1-9]\d*$/u.test(
      activityFunctionArn,
    )
  ) {
    throw new Error("PROFILE_ACTIVITY_FUNCTION_ARN must be an exact numeric Lambda version ARN");
  }

  return async (event, context) => {
    if (!validateCandidateRightsDurableInput(event)) {
      throw new NonRetryableCandidateRightsError("WorkflowInputRejected");
    }
    const resourceId =
      event.eventType === eventTypes.profileDataExportRequested
        ? event.data.dataExportId
        : event.data.deletionRequestId;
    const base: Omit<CandidateRightsActivityInputV1, "action" | "errorCode"> = {
      schemaVersion: 1,
      workflowDefinitionVersion: CANDIDATE_RIGHTS_WORKFLOW_DEFINITION_VERSION,
      eventId: event.eventId,
      resourceId,
      operationId: event.data.operationId,
      policyVersion: event.data.policyVersion,
      ...(event.traceparent ? { traceparent: event.traceparent } : {}),
    };

    if (event.eventType === eventTypes.profileDataExportRequested) {
      try {
        await invokeActivity(
          context,
          activityFunctionArn,
          candidateRightsOperationNames.exportBegin,
          {
            ...base,
            action: "export_begin",
          },
        );
        await invokeActivity(
          context,
          activityFunctionArn,
          candidateRightsOperationNames.exportAssemble,
          { ...base, action: "export_assemble" },
        );
      } catch (error) {
        try {
          await invokeActivity(
            context,
            activityFunctionArn,
            candidateRightsOperationNames.exportFail,
            {
              ...base,
              action: "export_fail",
              errorCode: workflowFailureCode(error),
            },
          );
        } catch {
          // The retained outbox row and terminal event are the independent recovery paths.
        }
        throw error;
      }
      return {
        schemaVersion: 1,
        workflowDefinitionVersion: CANDIDATE_RIGHTS_WORKFLOW_DEFINITION_VERSION,
        eventId: event.eventId,
        resourceId,
        operationId: event.data.operationId,
        kind: "candidate_data_export",
        state: "succeeded",
      };
    }

    await invokeActivity(
      context,
      activityFunctionArn,
      candidateRightsOperationNames.deletionRecordRecovery,
      { ...base, action: "deletion_record_recovery" },
    );
    await invokeActivity(
      context,
      activityFunctionArn,
      candidateRightsOperationNames.deletionDeleteActiveSystems,
      { ...base, action: "deletion_delete_active_systems" },
    );
    await invokeActivity(
      context,
      activityFunctionArn,
      candidateRightsOperationNames.deletionReconcileSubprocessors,
      { ...base, action: "deletion_reconcile_subprocessors" },
    );
    await invokeActivity(
      context,
      activityFunctionArn,
      candidateRightsOperationNames.deletionComplete,
      { ...base, action: "deletion_complete" },
    );
    return {
      schemaVersion: 1,
      workflowDefinitionVersion: CANDIDATE_RIGHTS_WORKFLOW_DEFINITION_VERSION,
      eventId: event.eventId,
      resourceId,
      operationId: event.data.operationId,
      kind: "account_deletion",
      state: "succeeded",
    };
  };
}

export function createCandidateRightsDurableHandler(
  activityFunctionArn: string,
): DurableLambdaHandler {
  return withDurableExecution(createCandidateRightsWorkflow(activityFunctionArn));
}
