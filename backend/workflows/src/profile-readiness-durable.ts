import {
  eventTypes,
  type ProfilePreferencesUpdatedData,
  validateEventData,
} from "@ai-job-apply/event-contracts";
import {
  type DurableContext,
  type DurableExecutionHandler,
  type DurableLambdaHandler,
  withDurableExecution,
  withRetry,
} from "@aws/durable-execution-sdk-js";
import {
  type CandidateRightsWorkflowResultV1,
  createCandidateRightsWorkflow,
  validateCandidateRightsDurableInput,
} from "./candidate-rights-durable.js";
import type { DurableExecutionPayloadV1 } from "./serverless-outbox.js";

export const PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION = 1 as const;
export const profileReadinessOperationNames = {
  markRunning: "profile-readiness.mark-running.v1",
  calculateAndPersist: "profile-readiness.calculate-and-persist.v1",
  compensateFailure: "profile-readiness.compensate-failure.v1",
} as const;

export type ProfileReadinessActivityAction =
  | "mark_running"
  | "calculate_and_persist"
  | "mark_failed";

export interface ProfileReadinessActivityInputV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  action: ProfileReadinessActivityAction;
  eventId: string;
  operationId: string;
  preferenceSetId: string;
  traceparent?: string;
  errorCode?: string;
}

export interface ProfileReadinessActivityResultV1 {
  schemaVersion: 1;
  action: ProfileReadinessActivityAction;
  outcome: "completed" | "retryable_failure" | "non_retryable_failure";
  errorCode?: string;
}

export interface ProfileReadinessWorkflowResultV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  eventId: string;
  operationId: string;
  state: "succeeded";
}

class NonRetryableActivityError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "NonRetryableActivityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isTraceparent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(value) &&
    !value.includes("00000000000000000000000000000000") &&
    !value.includes("-0000000000000000-")
  );
}

export function isExactNumericVersionFunctionArn(value: string): boolean {
  return /^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]+:[1-9]\d*$/u.test(
    value,
  );
}

export function validateProfileReadinessDurableInput(
  value: unknown,
): value is DurableExecutionPayloadV1 & { data: ProfilePreferencesUpdatedData } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "eventId", "eventType", "data", "traceparent"]) ||
    value.schemaVersion !== 1 ||
    !isUuid(value.eventId) ||
    value.eventType !== eventTypes.profilePreferencesUpdated ||
    !isRecord(value.data) ||
    !validateEventData(value.eventType, value.data)
  ) {
    return false;
  }
  return value.traceparent === undefined || isTraceparent(value.traceparent);
}

export function validateProfileReadinessActivityInput(
  value: unknown,
): value is ProfileReadinessActivityInputV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "action",
      "eventId",
      "operationId",
      "preferenceSetId",
      "traceparent",
      "errorCode",
    ]) ||
    value.schemaVersion !== 1 ||
    value.workflowDefinitionVersion !== PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION ||
    !["mark_running", "calculate_and_persist", "mark_failed"].includes(String(value.action)) ||
    !isUuid(value.eventId) ||
    !isUuid(value.operationId) ||
    !isUuid(value.preferenceSetId) ||
    (value.traceparent !== undefined && !isTraceparent(value.traceparent)) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/u.test(value.errorCode)))
  ) {
    return false;
  }
  return value.action === "mark_failed"
    ? value.errorCode !== undefined
    : value.errorCode === undefined;
}

export function validateProfileReadinessActivityResult(
  value: unknown,
  expectedAction: ProfileReadinessActivityAction,
): value is ProfileReadinessActivityResultV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "action", "outcome", "errorCode"]) ||
    value.schemaVersion !== 1 ||
    value.action !== expectedAction ||
    !["completed", "retryable_failure", "non_retryable_failure"].includes(String(value.outcome))
  ) {
    return false;
  }
  if (value.outcome === "completed") {
    return value.errorCode === undefined;
  }
  return typeof value.errorCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value.errorCode);
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
  input: ProfileReadinessActivityInputV1,
): Promise<void> {
  await withRetry(
    context,
    operationName,
    async (attemptContext, attempt) => {
      const result = await attemptContext.invoke<
        ProfileReadinessActivityInputV1,
        ProfileReadinessActivityResultV1
      >(`${operationName}.attempt-${attempt}`, activityFunctionArn, input);
      if (!validateProfileReadinessActivityResult(result, input.action)) {
        throw new NonRetryableActivityError("ActivityContractViolation");
      }
      if (result.outcome === "non_retryable_failure") {
        throw new NonRetryableActivityError(result.errorCode ?? "ActivityRejected");
      }
      if (result.outcome === "retryable_failure") {
        throw new Error(result.errorCode ?? "ActivityRetryableFailure");
      }
    },
    {
      wrapWithRunInChildContext: false,
      retryStrategy: (error, attempt) => ({
        shouldRetry: !(error instanceof NonRetryableActivityError) && attempt < 5,
        delay: deterministicRetryDelay(input.eventId, operationName, attempt),
      }),
    },
  );
}

function workflowFailureCode(error: unknown): string {
  if (error instanceof NonRetryableActivityError) {
    return "WorkflowNonRetryableFailure";
  }
  return "WorkflowActivityRetryExhausted";
}

export function createProfileReadinessWorkflow(
  activityFunctionArn: string,
): DurableExecutionHandler<DurableExecutionPayloadV1, ProfileReadinessWorkflowResultV1> {
  if (!isExactNumericVersionFunctionArn(activityFunctionArn)) {
    throw new Error("PROFILE_ACTIVITY_FUNCTION_ARN must be an exact numeric Lambda version ARN");
  }

  return async (event, context) => {
    if (!validateProfileReadinessDurableInput(event)) {
      throw new NonRetryableActivityError("WorkflowInputRejected");
    }
    const activityInput: Omit<ProfileReadinessActivityInputV1, "action" | "errorCode"> = {
      schemaVersion: 1,
      workflowDefinitionVersion: PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION,
      eventId: event.eventId,
      operationId: event.data.operationId,
      preferenceSetId: event.data.preferenceSetId,
      ...(event.traceparent ? { traceparent: event.traceparent } : {}),
    };

    try {
      await invokeActivity(
        context,
        activityFunctionArn,
        profileReadinessOperationNames.markRunning,
        { ...activityInput, action: "mark_running" },
      );
      await invokeActivity(
        context,
        activityFunctionArn,
        profileReadinessOperationNames.calculateAndPersist,
        { ...activityInput, action: "calculate_and_persist" },
      );
    } catch (error) {
      try {
        await invokeActivity(
          context,
          activityFunctionArn,
          profileReadinessOperationNames.compensateFailure,
          {
            ...activityInput,
            action: "mark_failed",
            errorCode: workflowFailureCode(error),
          },
        );
      } catch {
        // The terminal status event is the independent recovery path when compensation cannot run.
      }
      throw error;
    }

    return {
      schemaVersion: 1,
      workflowDefinitionVersion: PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION,
      eventId: event.eventId,
      operationId: event.data.operationId,
      state: "succeeded",
    };
  };
}

export function createProfileReadinessDurableHandler(
  activityFunctionArn: string,
): DurableLambdaHandler {
  return withDurableExecution(createProfileReadinessWorkflow(activityFunctionArn));
}

const productionWorkflow: DurableExecutionHandler<
  DurableExecutionPayloadV1,
  ProfileReadinessWorkflowResultV1 | CandidateRightsWorkflowResultV1
> = async (event, context) => {
  const activityFunctionArn = process.env.PROFILE_ACTIVITY_FUNCTION_ARN;
  if (!activityFunctionArn) {
    throw new Error("PROFILE_ACTIVITY_FUNCTION_ARN is required");
  }
  if (validateCandidateRightsDurableInput(event)) {
    return createCandidateRightsWorkflow(activityFunctionArn)(event, context);
  }
  return createProfileReadinessWorkflow(activityFunctionArn)(event, context);
};

export const handler = withDurableExecution(productionWorkflow);
