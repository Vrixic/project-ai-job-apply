import {
  generatedSyntheticProviderFaultAdapterVersion,
  generatedSyntheticProviderFaultSourceId,
} from "@ai-job-apply/ingestion-worker";
import type { DurableContext, DurableExecutionHandler } from "@aws/durable-execution-sdk-js";

export const INGESTION_PROVIDER_FAILURE_FIXTURE_KIND =
  "d1-generated-synthetic-provider-failure-v1" as const;
export const INGESTION_PROVIDER_FAILURE_WORKFLOW_DEFINITION_VERSION = 1 as const;

export interface IngestionProviderFailureWorkflowInputV1 {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  fixtureKind: typeof INGESTION_PROVIDER_FAILURE_FIXTURE_KIND;
  runId: string;
  reviewedConfigSha256: string;
  releaseSourceSha: string;
}

export interface IngestionProviderFailureActivityInputV1
  extends IngestionProviderFailureWorkflowInputV1 {
  attempt: 1 | 2;
}

interface IngestionProviderFailureActivityResultBaseV1 {
  schemaVersion: 1;
  fixtureKind: typeof INGESTION_PROVIDER_FAILURE_FIXTURE_KIND;
  attempt: 1 | 2;
  providerRequests: 0;
  observationCount: 0;
  createdCount: 0;
  updatedCount: 0;
}

export type IngestionProviderFailureActivityResultV1 =
  | (IngestionProviderFailureActivityResultBaseV1 & {
      attempt: 1;
      status: "retry";
      reason: "source_unavailable";
      retryAfterMs: 1_000;
    })
  | (IngestionProviderFailureActivityResultBaseV1 & {
      attempt: 2;
      status: "succeeded";
    });

export interface IngestionProviderFailureWorkflowResultV1 {
  schemaVersion: 1;
  profile: "d1_deployed_provider_failure_durable_v1";
  fixtureKind: typeof INGESTION_PROVIDER_FAILURE_FIXTURE_KIND;
  sourceId: typeof generatedSyntheticProviderFaultSourceId;
  adapterVersion: typeof generatedSyntheticProviderFaultAdapterVersion;
  runId: string;
  reviewedConfigSha256: string;
  releaseSourceSha: string;
  providerFaultsInjected: 1;
  providerFailuresObserved: 1;
  recoveryAttempts: 1;
  recoveriesSucceeded: 1;
  providerRequests: 0;
  observationCount: 0;
  createdCount: 0;
  updatedCount: 0;
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitShaPattern = /^[0-9a-f]{40}$/u;
const numericLambdaVersionArnPattern =
  /^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

export function isIngestionProviderFailureFixtureCandidate(
  value: unknown,
): value is Record<string, unknown> {
  return record(value) && "fixtureKind" in value;
}

export function validateIngestionProviderFailureWorkflowInput(
  value: unknown,
): value is IngestionProviderFailureWorkflowInputV1 {
  return (
    record(value) &&
    exactKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "fixtureKind",
      "runId",
      "reviewedConfigSha256",
      "releaseSourceSha",
    ]) &&
    value.schemaVersion === 1 &&
    value.workflowDefinitionVersion === INGESTION_PROVIDER_FAILURE_WORKFLOW_DEFINITION_VERSION &&
    value.fixtureKind === INGESTION_PROVIDER_FAILURE_FIXTURE_KIND &&
    typeof value.runId === "string" &&
    uuidV4Pattern.test(value.runId) &&
    typeof value.reviewedConfigSha256 === "string" &&
    sha256Pattern.test(value.reviewedConfigSha256) &&
    typeof value.releaseSourceSha === "string" &&
    gitShaPattern.test(value.releaseSourceSha)
  );
}

export function validateIngestionProviderFailureActivityInput(
  value: unknown,
): value is IngestionProviderFailureActivityInputV1 {
  if (!record(value)) return false;
  const { attempt, ...workflowInput } = value;
  return (
    exactKeys(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "fixtureKind",
      "runId",
      "reviewedConfigSha256",
      "releaseSourceSha",
      "attempt",
    ]) &&
    (attempt === 1 || attempt === 2) &&
    validateIngestionProviderFailureWorkflowInput(workflowInput)
  );
}

export function validateIngestionProviderFailureActivityResult(
  value: unknown,
): value is IngestionProviderFailureActivityResultV1 {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.fixtureKind !== INGESTION_PROVIDER_FAILURE_FIXTURE_KIND ||
    value.providerRequests !== 0 ||
    value.observationCount !== 0 ||
    value.createdCount !== 0 ||
    value.updatedCount !== 0
  ) {
    return false;
  }
  if (value.attempt === 1) {
    return (
      exactKeys(value, [
        "schemaVersion",
        "fixtureKind",
        "attempt",
        "status",
        "reason",
        "retryAfterMs",
        "providerRequests",
        "observationCount",
        "createdCount",
        "updatedCount",
      ]) &&
      value.status === "retry" &&
      value.reason === "source_unavailable" &&
      value.retryAfterMs === 1_000
    );
  }
  return (
    value.attempt === 2 &&
    exactKeys(value, [
      "schemaVersion",
      "fixtureKind",
      "attempt",
      "status",
      "providerRequests",
      "observationCount",
      "createdCount",
      "updatedCount",
    ]) &&
    value.status === "succeeded"
  );
}

async function invokeAttempt(
  context: DurableContext,
  activityArn: string,
  input: IngestionProviderFailureWorkflowInputV1,
  attempt: 1 | 2,
): Promise<IngestionProviderFailureActivityResultV1> {
  const result = await context.invoke<
    IngestionProviderFailureActivityInputV1,
    IngestionProviderFailureActivityResultV1
  >(`ingestion.provider-failure.attempt.${attempt}`, activityArn, { ...input, attempt });
  if (!validateIngestionProviderFailureActivityResult(result) || result.attempt !== attempt) {
    throw new Error("IngestionProviderFailureActivityContractRejected");
  }
  return result;
}

export function createIngestionProviderFailureWorkflow(
  activityArn: string,
): DurableExecutionHandler<
  IngestionProviderFailureWorkflowInputV1,
  IngestionProviderFailureWorkflowResultV1
> {
  if (!numericLambdaVersionArnPattern.test(activityArn)) {
    throw new Error("INGESTION_ACTIVITY_FUNCTION_ARN must be an exact numeric Lambda version ARN");
  }
  return async (event, context) => {
    if (!validateIngestionProviderFailureWorkflowInput(event)) {
      throw new Error("IngestionProviderFailureWorkflowInputRejected");
    }
    const failure = await invokeAttempt(context, activityArn, event, 1);
    if (
      failure.status !== "retry" ||
      failure.reason !== "source_unavailable" ||
      failure.retryAfterMs !== 1_000
    ) {
      throw new Error("IngestionProviderFailureFaultProofRejected");
    }
    await context.wait("ingestion.provider-failure.retry.1", { seconds: 1 });
    const recovery = await invokeAttempt(context, activityArn, event, 2);
    if (recovery.status !== "succeeded") {
      throw new Error("IngestionProviderFailureRecoveryProofRejected");
    }
    return {
      schemaVersion: 1,
      profile: "d1_deployed_provider_failure_durable_v1",
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      sourceId: generatedSyntheticProviderFaultSourceId,
      adapterVersion: generatedSyntheticProviderFaultAdapterVersion,
      runId: event.runId,
      reviewedConfigSha256: event.reviewedConfigSha256,
      releaseSourceSha: event.releaseSourceSha,
      providerFaultsInjected: 1,
      providerFailuresObserved: 1,
      recoveryAttempts: 1,
      recoveriesSucceeded: 1,
      providerRequests: 0,
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    };
  };
}
