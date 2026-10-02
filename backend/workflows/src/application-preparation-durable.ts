import {
  type DurableContext,
  type DurableExecutionHandler,
  withDurableExecution,
  withRetry,
} from "@aws/durable-execution-sdk-js";
import {
  APPLICATION_PREPARATION_DEFINITION_VERSION,
  type ApplicationPreparationActivityInput,
  type ApplicationPreparationActivityResult,
  type ApplicationPreparationDurableInput,
  validateApplicationPreparationActivityResult,
  validateApplicationPreparationDurableInput,
} from "./application-preparation-contract.js";

export const applicationPreparationOperations = {
  advance: "application-preparation.advance.v1",
  compensate: "application-preparation.compensate.v1",
} as const;
export class ApplicationPreparationWorkflowError extends Error {
  constructor(
    code:
      | "WorkflowInputRejected"
      | "ActivityContractViolation"
      | "ActivityRejected"
      | "ActivityUnavailable"
      | "ActivityPending"
      | "WorkflowActivityFailed",
  ) {
    super(code);
    this.name = "ApplicationPreparationWorkflowError";
  }
}
class NonRetryablePreparationError extends ApplicationPreparationWorkflowError {}
export interface ApplicationPreparationWorkflowResult {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  eventId: string;
  preparationId: string;
  /** Processing finished. The owning operation, not this checkpoint, proves draft success. */
  state: "completed";
}

async function invoke(
  context: DurableContext,
  arn: string,
  name: string,
  input: ApplicationPreparationActivityInput,
): Promise<void> {
  await withRetry(
    context,
    name,
    async (attemptContext, attempt) => {
      let result: unknown;
      try {
        result = await attemptContext.invoke<
          ApplicationPreparationActivityInput,
          ApplicationPreparationActivityResult
        >(`${name}.attempt-${attempt}`, arn, input);
      } catch {
        throw new ApplicationPreparationWorkflowError("ActivityUnavailable");
      }
      if (!validateApplicationPreparationActivityResult(result, input))
        throw new NonRetryablePreparationError("ActivityContractViolation");
      if (result.outcome === "non_retryable_failure")
        throw new NonRetryablePreparationError("ActivityRejected");
      if (result.outcome === "retryable_failure")
        throw new ApplicationPreparationWorkflowError("ActivityPending");
    },
    {
      wrapWithRunInChildContext: false,
      retryStrategy: (error, attempt) => ({
        shouldRetry: !(error instanceof NonRetryablePreparationError) && attempt < 5,
        delay: { seconds: Math.min(2 ** attempt, 16) },
      }),
    },
  );
}

/** Deterministic SDK workflow. No database, document text, credentials, clocks or model I/O. */
export function createApplicationPreparationWorkflow(
  activityArn: string,
): DurableExecutionHandler<
  ApplicationPreparationDurableInput,
  ApplicationPreparationWorkflowResult
> {
  if (
    !/^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]+:[1-9]\d*$/u.test(
      activityArn,
    )
  )
    throw new Error("Application preparation requires an exact numeric activity Lambda version");
  return async (event, context) => {
    if (!validateApplicationPreparationDurableInput(event))
      throw new NonRetryablePreparationError("WorkflowInputRejected");
    const input: ApplicationPreparationActivityInput = {
      schemaVersion: 1,
      workflowDefinitionVersion: APPLICATION_PREPARATION_DEFINITION_VERSION,
      eventId: event.eventId,
      preparationId: event.data.preparationId,
      action: "advance",
    };
    try {
      await invoke(context, activityArn, applicationPreparationOperations.advance, input);
    } catch {
      try {
        await invoke(context, activityArn, applicationPreparationOperations.compensate, {
          ...input,
          action: "fail",
        });
      } catch {
        // An independently bound terminal reconciler must recover a failed compensation.
        // It is not yet wired: never claim this factory supplies the dispatch/recovery runtime.
      }
      throw new ApplicationPreparationWorkflowError("WorkflowActivityFailed");
    }
    return {
      schemaVersion: 1,
      workflowDefinitionVersion: APPLICATION_PREPARATION_DEFINITION_VERSION,
      eventId: event.eventId,
      preparationId: event.data.preparationId,
      state: "completed",
    };
  };
}
export function createApplicationPreparationDurableHandler(activityArn: string) {
  return withDurableExecution(createApplicationPreparationWorkflow(activityArn));
}
