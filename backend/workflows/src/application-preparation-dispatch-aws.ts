import {
  isPreparationFunctionArn,
  matchesPreparationExecutionArn,
  PreparationDispatchError,
  preparationExecutionName,
} from "@ai-job-apply/applications-service";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { validateApplicationPreparationDurableInput } from "./application-preparation-contract.js";
import {
  PreparationDispatchPendingError,
  type PreparationExecutionStarter,
} from "./application-preparation-dispatch.js";

export interface PreparationLambdaInvoker {
  send(
    command: InvokeCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<{ StatusCode?: number; DurableExecutionArn?: string }>;
}

/** Injected SDK client only. No credentials, environment initialization or deployment entrypoint. */
export function createAwsPreparationExecutionStarter(
  invoker: PreparationLambdaInvoker,
): PreparationExecutionStarter {
  return {
    async start(input) {
      if (
        !isPreparationFunctionArn(input.functionArn) ||
        !validateApplicationPreparationDurableInput(input.payload) ||
        input.executionName !== preparationExecutionName(input.payload.eventId) ||
        input.payload.eventId !== input.payload.eventId.toLowerCase() ||
        input.payload.data.preparationId !== input.payload.data.preparationId.toLowerCase()
      )
        throw new PreparationDispatchError();
      // Always construct the same property order. Retained-version retries must supply the
      // exact same serialized identifiers, never an evolving trace or timestamp field.
      const payload = {
        schemaVersion: 1,
        eventId: input.payload.eventId,
        eventType: input.payload.eventType,
        data: { preparationId: input.payload.data.preparationId },
      };
      try {
        const response = await invoker.send(
          new InvokeCommand({
            FunctionName: input.functionArn,
            InvocationType: "Event",
            DurableExecutionName: input.executionName,
            Payload: new TextEncoder().encode(JSON.stringify(payload)),
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (
          response.StatusCode !== 202 ||
          !response.DurableExecutionArn ||
          !matchesPreparationExecutionArn(
            response.DurableExecutionArn,
            input.functionArn,
            input.executionName,
          )
        )
          throw new PreparationDispatchPendingError();
        return { executionArn: response.DurableExecutionArn };
      } catch {
        throw new PreparationDispatchPendingError();
      }
    },
  };
}
