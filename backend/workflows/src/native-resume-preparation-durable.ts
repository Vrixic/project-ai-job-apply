import { isDeepStrictEqual } from "node:util";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { createNativeResumePreparationControlClient } from "@ai-job-apply/documents-service/native-resume-preparation-control-client";
import {
  type NativeResumePreparationControlInput,
  type NativeResumePreparationControlOutput,
  validateNativeResumePreparationControlInput,
  validateNativeResumePreparationControlOutput,
} from "@ai-job-apply/documents-service/native-resume-preparation-control-contract";
import {
  type DurableContext,
  type DurableExecutionHandler,
  withDurableExecution,
  withRetry,
} from "@aws/durable-execution-sdk-js";
import { createNativeResumeRouteLifecycle } from "./native-resume-route-lifecycle.js";

type Input = Extract<NativeResumePreparationControlInput, { action: "start" }>;
export interface NativeResumeRoutingOptions {
  enabled: () => boolean;
  creationEnabled: () => boolean;
  testControlClient?: Parameters<
    typeof createNativeResumePreparationControlClient
  >[0]["testClient"];
  testRoute?: Parameters<typeof createNativeResumeRouteLifecycle>[0]["testRoute"];
}
type RouteResult = Awaited<ReturnType<ReturnType<typeof createNativeResumeRouteLifecycle>>> & {
  schemaVersion: 1;
  outcome: "route_lifecycle_finished";
};
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
  routing?: NativeResumeRoutingOptions,
): DurableExecutionHandler<Input, NativeResumePreparationControlOutput | RouteResult> {
  nativeLaunchControlVersion(target);
  const control = routing
    ? createNativeResumePreparationControlClient({
        functionArn: target,
        enabled: routing.enabled,
        ...(routing.testControlClient ? { testClient: routing.testControlClient } : {}),
      })
    : undefined;
  return async (event, context) => {
    if (!validateNativeResumePreparationControlInput(event) || event.action !== "start")
      throw new ContractRejected();
    const original = structuredClone(event);
    const reserved = await invoke(context, target, "native-resume.reserve.v1", original, 3);
    if (reserved.outcome !== "reserved" || !reserved.scope) throw new ContractRejected();
    if (routing && control) {
      const scope = reserved.scope;
      const captured = await invoke(
        context,
        target,
        "native-resume.route-capture.v1",
        {
          schemaVersion: 1,
          action: "route_capture",
          scope,
        },
        15,
      );
      if (captured.outcome !== "route_captured" || !captured.route) throw new ContractRejected();
      const route = structuredClone(captured.route);
      const lifecycle = createNativeResumeRouteLifecycle({
        capture: async () => structuredClone(route),
        admit: async (_scope, snapshot) =>
          (await control.run({ schemaVersion: 1, action: "route_admit", scope, route: snapshot }))
            .outcome === "admitted",
        attach: async () => {
          const attached = await control.run({ schemaVersion: 1, action: "complete", scope });
          if (attached.outcome !== "ready" || !attached.packet) throw new Pending();
        },
        retired: async () =>
          (await control.run({ schemaVersion: 1, action: "route_retired", scope })).outcome ===
          "retired",
        enabled: routing.enabled,
        creationEnabled: routing.creationEnabled,
        ...(routing.testRoute ? { testRoute: routing.testRoute } : {}),
      });
      return {
        schemaVersion: 1,
        outcome: "route_lifecycle_finished",
        ...(await lifecycle(context, scope)),
      };
    }
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
export function createNativeResumePreparationDurableHandler(
  target: string,
  routing?: NativeResumeRoutingOptions,
) {
  return withDurableExecution(createNativeResumePreparationWorkflow(target, routing));
}
