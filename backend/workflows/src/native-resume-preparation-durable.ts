import { isDeepStrictEqual } from "node:util";
import {
  type DurableContext,
  type DurableExecutionHandler,
  withDurableExecution,
  withRetry,
} from "@aws/durable-execution-sdk-js";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import {
  type NativeResumePreparationControlInput,
  type NativeResumePreparationControlOutput,
  validateNativeResumePreparationControlInput,
  validateNativeResumePreparationControlOutput,
} from "@ai-job-apply/documents-service/native-resume-preparation-control-contract";

type Input = Extract<NativeResumePreparationControlInput, { action: "start" }>;
class ContractRejected extends Error {
  constructor() {
    super("NativeResumeWorkflowContractRejected");
  }
}
class Pending extends Error {
  constructor() {
    super("NativeResumeWorkflowPending");
  }
}

async function invoke(
  context: DurableContext,
  target: string,
  name: string,
  input: NativeResumePreparationControlInput,
  attempts: number,
): Promise<NativeResumePreparationControlOutput> {
  return withRetry(
    context,
    name,
    async (attemptContext, attempt) => {
      let result: unknown;
      try {
        result = await attemptContext.invoke<
          NativeResumePreparationControlInput,
          NativeResumePreparationControlOutput
        >(`${name}.attempt-${attempt}`, target, input);
      } catch {
        throw new Pending();
      }
      if (
        !validateNativeResumePreparationControlOutput(result) ||
        !isDeepStrictEqual(result.request, input)
      )
        throw new ContractRejected();
      if (result.outcome === "unavailable" || result.outcome === "pending") throw new Pending();
      return result;
    },
    {
      wrapWithRunInChildContext: false,
      retryStrategy: (error, attempt) => ({
        shouldRetry: !(error instanceof ContractRejected) && attempt < attempts,
        delay: { seconds: Math.min(2 ** attempt, 10) },
      }),
    },
  );
}

/** Deterministic scalar orchestration. Start is checkpointed before polling; every retry uses
 * the identical original reservation or scope. Only the owner control may mutate SQL/launch.
 * Exhaustion is unresolved work, never evidence of task death or permission to regenerate. */
export function createNativeResumePreparationWorkflow(
  target: string,
): DurableExecutionHandler<Input, NativeResumePreparationControlOutput> {
  nativeLaunchControlVersion(target);
  return async (event, context) => {
    if (!validateNativeResumePreparationControlInput(event) || event.action !== "start")
      throw new ContractRejected();
    const original = structuredClone(event);
    const reserved = await invoke(context, target, "native-resume.reserve.v1", original, 3);
    if (reserved.outcome !== "reserved" || !reserved.scope) throw new ContractRejected();
    const completed = await invoke(
      context,
      target,
      "native-resume.complete.v1",
      {
        schemaVersion: 1,
        action: "complete",
        scope: reserved.scope,
      },
      15,
    );
    if (completed.outcome !== "ready" || !completed.packet) throw new ContractRejected();
    return completed;
  };
}
export function createNativeResumePreparationDurableHandler(target: string) {
  return withDurableExecution(createNativeResumePreparationWorkflow(target));
}
