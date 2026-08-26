import {
  type DurableContext,
  type DurableExecutionHandler,
  type DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  createIngestionProviderFailureWorkflow,
  type IngestionProviderFailureWorkflowInputV1,
  type IngestionProviderFailureWorkflowResultV1,
  isIngestionProviderFailureFixtureCandidate,
} from "./ingestion-provider-failure-durable.js";

export const INGESTION_WORKFLOW_DEFINITION_VERSION = 1 as const;

export interface IngestionWorkflowInputV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  dispatchId: string;
  executionId: string;
  workflowGeneration: number;
}

export type IngestionActivityInputV1 =
  | {
      schemaVersion: 1;
      workflowDefinitionVersion: 1;
      action: "advance";
      dispatchId: string;
      executionId: string;
      workflowGeneration: number;
    }
  | {
      schemaVersion: 1;
      workflowDefinitionVersion: 1;
      action: "run";
      dispatchId: string;
      executionId: string;
      workflowGeneration: number;
      revision: number;
      leaseId: string;
      leaseExpiresAt: string;
      attempt: number;
    };

export type IngestionActivityResultV1 =
  | {
      schemaVersion: 1;
      action: "run";
      dispatchId: string;
      executionId: string;
      workflowGeneration: number;
      revision: number;
      leaseId: string;
      leaseExpiresAt: string;
      attempt: number;
    }
  | {
      schemaVersion: 1;
      action: "wait";
      dispatchId: string;
      executionId: string;
      workflowGeneration: number;
      revision: number;
      waitMilliseconds: number;
    }
  | {
      schemaVersion: 1;
      action: "terminal";
      dispatchId: string;
      executionId: string;
      workflowGeneration: number;
      revision: number;
      status: "paused" | "succeeded" | "dead_lettered";
      progressKnown: boolean;
      observationCount: number;
      createdCount: number;
      updatedCount: number;
    };

export interface IngestionWorkflowResultV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  dispatchId: string;
  executionId: string;
  workflowGeneration: number;
  status: "paused" | "succeeded" | "dead_lettered";
  progressKnown: boolean;
  observationCount: number;
  createdCount: number;
  updatedCount: number;
}

const shaPattern = /^[a-f0-9]{64}$/u;
const uuidV7Pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function isExactNumericLambdaVersionArn(value: string): boolean {
  return /^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$/u.test(
    value,
  );
}

export function validateIngestionWorkflowInput(value: unknown): value is IngestionWorkflowInputV1 {
  return (
    record(value) &&
    exactKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "dispatchId",
      "executionId",
      "workflowGeneration",
    ]) &&
    value.schemaVersion === 1 &&
    value.workflowDefinitionVersion === 1 &&
    typeof value.dispatchId === "string" &&
    uuidV7Pattern.test(value.dispatchId) &&
    typeof value.executionId === "string" &&
    shaPattern.test(value.executionId) &&
    Number.isSafeInteger(value.workflowGeneration) &&
    Number(value.workflowGeneration) >= 1 &&
    Number(value.workflowGeneration) <= 20
  );
}

export function validateIngestionActivityInput(value: unknown): value is IngestionActivityInputV1 {
  if (!record(value)) return false;
  const base =
    value.schemaVersion === 1 &&
    value.workflowDefinitionVersion === 1 &&
    typeof value.dispatchId === "string" &&
    uuidV7Pattern.test(value.dispatchId) &&
    typeof value.executionId === "string" &&
    shaPattern.test(value.executionId) &&
    Number.isSafeInteger(value.workflowGeneration) &&
    Number(value.workflowGeneration) >= 1 &&
    Number(value.workflowGeneration) <= 20;
  if (!base) return false;
  if (value.action === "advance") {
    return exactKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "action",
      "dispatchId",
      "executionId",
      "workflowGeneration",
    ]);
  }
  return (
    value.action === "run" &&
    exactKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "action",
      "dispatchId",
      "executionId",
      "workflowGeneration",
      "revision",
      "leaseId",
      "leaseExpiresAt",
      "attempt",
    ]) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    typeof value.leaseId === "string" &&
    uuidV7Pattern.test(value.leaseId) &&
    canonicalTimestamp(value.leaseExpiresAt) &&
    Number.isSafeInteger(value.attempt) &&
    Number(value.attempt) >= 1 &&
    Number(value.attempt) <= 5
  );
}

export function validateIngestionActivityResult(
  value: unknown,
): value is IngestionActivityResultV1 {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.executionId !== "string" ||
    !shaPattern.test(value.executionId) ||
    typeof value.dispatchId !== "string" ||
    !uuidV7Pattern.test(value.dispatchId) ||
    !Number.isSafeInteger(value.workflowGeneration) ||
    Number(value.workflowGeneration) < 1 ||
    Number(value.workflowGeneration) > 20
  ) {
    return false;
  }
  if (value.action === "run") {
    return (
      exactKeys(value, [
        "schemaVersion",
        "action",
        "dispatchId",
        "executionId",
        "workflowGeneration",
        "revision",
        "leaseId",
        "leaseExpiresAt",
        "attempt",
      ]) &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) >= 0 &&
      Number(value.revision) >= 1 &&
      typeof value.leaseId === "string" &&
      uuidV7Pattern.test(value.leaseId) &&
      canonicalTimestamp(value.leaseExpiresAt) &&
      Number.isSafeInteger(value.attempt) &&
      Number(value.attempt) >= 1 &&
      Number(value.attempt) <= 5
    );
  }
  if (value.action === "wait") {
    return (
      exactKeys(value, [
        "schemaVersion",
        "action",
        "dispatchId",
        "executionId",
        "workflowGeneration",
        "revision",
        "waitMilliseconds",
      ]) &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) >= 0 &&
      Number.isSafeInteger(value.waitMilliseconds) &&
      Number(value.waitMilliseconds) >= 1 &&
      Number(value.waitMilliseconds) <= 15 * 60 * 1_000
    );
  }
  return (
    value.action === "terminal" &&
    exactKeys(value, [
      "schemaVersion",
      "action",
      "dispatchId",
      "executionId",
      "workflowGeneration",
      "revision",
      "status",
      "progressKnown",
      "observationCount",
      "createdCount",
      "updatedCount",
    ]) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    ["paused", "succeeded", "dead_lettered"].includes(String(value.status)) &&
    typeof value.progressKnown === "boolean" &&
    [value.observationCount, value.createdCount, value.updatedCount].every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 100,
    ) &&
    Number(value.observationCount) === Number(value.createdCount) + Number(value.updatedCount) &&
    (value.progressKnown || Number(value.observationCount) === 0)
  );
}

async function invoke(
  context: DurableContext,
  activityArn: string,
  operationName: string,
  input: IngestionActivityInputV1,
): Promise<IngestionActivityResultV1> {
  const result = await context.invoke<IngestionActivityInputV1, IngestionActivityResultV1>(
    operationName,
    activityArn,
    input,
  );
  if (
    !validateIngestionActivityResult(result) ||
    result.dispatchId !== input.dispatchId ||
    result.executionId !== input.executionId ||
    result.workflowGeneration !== input.workflowGeneration
  ) {
    throw new Error("IngestionActivityContractRejected");
  }
  return result;
}

export function createIngestionWorkflow(
  activityArn: string,
): DurableExecutionHandler<IngestionWorkflowInputV1, IngestionWorkflowResultV1> {
  if (!isExactNumericLambdaVersionArn(activityArn)) {
    throw new Error("INGESTION_ACTIVITY_FUNCTION_ARN must be an exact numeric Lambda version ARN");
  }
  return async (event, context) => {
    if (!validateIngestionWorkflowInput(event)) throw new Error("IngestionWorkflowInputRejected");
    let result = await invoke(context, activityArn, "ingestion.advance.0", {
      ...event,
      action: "advance",
    });
    for (let operations = 0; operations < 20; operations += 1) {
      if (result.action === "terminal") {
        return {
          schemaVersion: 1,
          workflowDefinitionVersion: 1,
          dispatchId: event.dispatchId,
          executionId: event.executionId,
          workflowGeneration: event.workflowGeneration,
          status: result.status,
          progressKnown: result.progressKnown,
          observationCount: result.observationCount,
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
        };
      }
      if (result.action === "wait") {
        const previousRevision = result.revision;
        await context.wait(`ingestion.wait.${result.revision}`, {
          seconds: Math.max(1, Math.ceil(result.waitMilliseconds / 1_000)),
        });
        result = await invoke(context, activityArn, `ingestion.advance.${result.revision}`, {
          ...event,
          action: "advance",
        });
        if (result.revision < previousRevision || result.revision > previousRevision + 1) {
          throw new Error("IngestionActivityRevisionRejected");
        }
        continue;
      }
      const claimedRevision = result.revision;
      result = await invoke(context, activityArn, `ingestion.run.${claimedRevision}`, {
        ...event,
        action: "run",
        revision: result.revision,
        leaseId: result.leaseId,
        leaseExpiresAt: result.leaseExpiresAt,
        attempt: result.attempt,
      });
      if (result.action === "run" || result.revision !== claimedRevision + 1) {
        throw new Error("IngestionActivityLeaseSettlementRejected");
      }
    }
    throw new Error("IngestionWorkflowOperationLimitExceeded");
  };
}

export function createIngestionDurableHandler(activityArn: string): DurableLambdaHandler {
  return withDurableExecution(createIngestionWorkflow(activityArn));
}

type ProductionIngestionWorkflowInput =
  | IngestionWorkflowInputV1
  | IngestionProviderFailureWorkflowInputV1;
type ProductionIngestionWorkflowResult =
  | IngestionWorkflowResultV1
  | IngestionProviderFailureWorkflowResultV1;

export function createProductionIngestionWorkflow(
  activityArn: string,
): DurableExecutionHandler<ProductionIngestionWorkflowInput, ProductionIngestionWorkflowResult> {
  return async (event, context) => {
    if (isIngestionProviderFailureFixtureCandidate(event)) {
      return createIngestionProviderFailureWorkflow(activityArn)(
        event as unknown as IngestionProviderFailureWorkflowInputV1,
        context,
      );
    }
    return createIngestionWorkflow(activityArn)(event as IngestionWorkflowInputV1, context);
  };
}

const productionWorkflow: DurableExecutionHandler<
  ProductionIngestionWorkflowInput,
  ProductionIngestionWorkflowResult
> = async (event, context) => {
  const activityArn = process.env.INGESTION_ACTIVITY_FUNCTION_ARN;
  if (!activityArn) throw new Error("INGESTION_ACTIVITY_FUNCTION_ARN is required");
  return createProductionIngestionWorkflow(activityArn)(event, context);
};

export const handler = withDurableExecution(productionWorkflow);
