import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { createNativeMaterialRouteControlClient } from "@ai-job-apply/documents-service/native-material-route-control-client";
import type { DurableExecutionHandler } from "@aws/durable-execution-sdk-js";
import {
  type ApplicationPreparationDurableInput,
  validateApplicationPreparationDurableInput,
} from "./application-preparation-contract.js";
import type { ApplicationPreparationWorkflowResult } from "./application-preparation-durable.js";
import { createNativeMaterialRouteLifecycle } from "./native-material-route-lifecycle.js";
import { createNativePreparationRouteClient } from "./native-preparation-route-client.js";
import {
  type NativePreparationRouteInput,
  type NativePreparationRouteOriginal,
  nativePreparationRouteUnavailable,
  validateNativePreparationRouteOutput,
} from "./native-preparation-route-contract.js";

/** Uses the existing preparation event/name binding, never launches another durable execution.
 * Stage checkpoints only metadata; attachment follows propagated DNS and repeats owner checks. */
export function createNativePreparationRouteWorkflow(options: {
  activityArn: string;
  controlArn: string;
  enabled?: () => boolean;
  creationEnabled?: () => boolean;
  testActivityClient?: NonNullable<
    Parameters<typeof createNativePreparationRouteClient>[0]["testClient"]
  >;
  testControlClient?: NonNullable<
    Parameters<typeof createNativeMaterialRouteControlClient>[0]["testClient"]
  >;
  testRoute?: NonNullable<Parameters<typeof createNativeMaterialRouteLifecycle>[0]["testRoute"]>;
}): DurableExecutionHandler<
  ApplicationPreparationDurableInput,
  ApplicationPreparationWorkflowResult
> {
  nativeLaunchControlVersion(options.activityArn);
  nativeLaunchControlVersion(options.controlArn);
  const enabled = options.enabled ?? (() => false);
  if (
    options.activityArn.split(":")[4] !== options.controlArn.split(":")[4] ||
    ((options.testActivityClient || options.testControlClient || options.testRoute) &&
      process.env.NODE_ENV !== "test")
  )
    throw nativePreparationRouteUnavailable();
  const activity = createNativePreparationRouteClient({
    functionArn: options.activityArn,
    enabled,
    ...(options.testActivityClient ? { testClient: options.testActivityClient } : {}),
  });
  const control = createNativeMaterialRouteControlClient({
    functionArn: options.controlArn,
    enabled,
    ...(options.testControlClient ? { testClient: options.testControlClient } : {}),
  });
  return async (event, context) => {
    if (!enabled() || !validateApplicationPreparationDurableInput(event))
      throw nativePreparationRouteUnavailable();
    const request = {
      schemaVersion: 1 as const,
      protocol: "native-preparation-route.v1" as const,
      eventId: event.eventId,
      preparationId: event.data.preparationId,
    };
    const completed = (): ApplicationPreparationWorkflowResult => ({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId: event.eventId,
      preparationId: event.data.preparationId,
      state: "completed",
    });
    let original: NativePreparationRouteOriginal | null = null;
    try {
      for (let n = 0; n < 60; n++) {
        const input: NativePreparationRouteInput = { ...request, action: "stage" };
        const result = await context.invoke(
          `material-preparation.stage.v1.${n}`,
          options.activityArn,
          input,
        );
        if (
          !validateNativePreparationRouteOutput(result) ||
          JSON.stringify(result.request) !== JSON.stringify(input)
        )
          throw nativePreparationRouteUnavailable();
        if (result.outcome === "terminal") return completed();
        if (result.outcome === "ready") {
          original = result.original;
          break;
        }
        if (n < 59) await context.wait(`material-preparation.stage-wait.v1.${n}`, { seconds: 5 });
      }
      if (!original) throw nativePreparationRouteUnavailable();
      const fixed = structuredClone(original);
      const base = {
        schemaVersion: 1 as const,
        protocol: "native-material-route.v1" as const,
        ...fixed,
      };
      const lifecycle = createNativeMaterialRouteLifecycle({
        enabled,
        creationEnabled: options.creationEnabled ?? (() => false),
        ...(options.testRoute ? { testRoute: options.testRoute } : {}),
        async capture() {
          const result = await control.run({ ...base, action: "capture" });
          if (result.outcome !== "captured" || !result.route)
            throw nativePreparationRouteUnavailable();
          return result.route;
        },
        async admit(_scope, route) {
          return (await control.run({ ...base, action: "admit", route })).outcome === "admitted";
        },
        async retired() {
          return (await control.run({ ...base, action: "retired" })).outcome === "retired";
        },
        async attach() {
          const result = await activity.run({ ...request, action: "attach", original: fixed });
          if (result.outcome !== "attached") throw nativePreparationRouteUnavailable();
        },
      });
      const result = await lifecycle(context, fixed.binding.scope);
      if (result.attachment !== "acknowledged" || result.cleanup !== "removed")
        throw nativePreparationRouteUnavailable();
      return completed();
    } catch {
      // Original completion is idempotent: a succeeded packet is not rewritten by compensation.
      await context.invoke("material-preparation.fail.v1", options.activityArn, {
        ...request,
        action: "fail",
      });
      throw nativePreparationRouteUnavailable();
    }
  };
}
