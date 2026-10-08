import {
  createApplicationsDatabase,
  lockNativeMaterialApplicationAdmission,
  lockNativePreparationLaunchAdmission,
} from "@ai-job-apply/applications-service/native-material-runtime";
import {
  type NativeLaunchControlInput,
  type NativeLaunchControlOutput,
  nativeLaunchControlUnavailable,
  validateNativeLaunchControlInput,
  validateNativeLaunchControlOutput,
} from "@ai-job-apply/documents-service/native-launch-control";
import { PostgresNativeMaterialRegistry } from "@ai-job-apply/documents-service/native-material-registry";
import {
  createNativeTaskLaunch,
  nativeTaskLaunchConfiguration,
} from "@ai-job-apply/documents-service/native-task-launch";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service/lambda-database-url";

type Environment = Readonly<Record<string, string | undefined>>;

import { validateNativeMaterialRouteControlInput } from "@ai-job-apply/documents-service/native-material-route-control-contract";
import {
  type NativeMaterialControlConfiguration as Configuration,
  nativeMaterialControlConfiguration as configuration,
} from "./native-material-control-configuration.js";
import { createNativeMaterialRouteControlLambda } from "./native-material-route-control-lambda.js";

/** Actual owner composition, one native-codec SQL pool. It has no grant issuer, provider,
 * content, object, renderer, task-stop or retirement/settlement authority. */
export function createNativeMaterialLaunchRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
  launchEnabled: () => boolean,
  testClient?: Parameters<typeof createNativeTaskLaunch>[0]["testClient"],
) {
  if (testClient && process.env.NODE_ENV !== "test") throw nativeLaunchControlUnavailable();
  const task = nativeTaskLaunchConfiguration(config.task);
  const pool = createApplicationsDatabase(url, { maxConnections: 1 });
  const registry = new PostgresNativeMaterialRegistry(
    pool,
    enabled,
    lockNativeMaterialApplicationAdmission,
    lockNativePreparationLaunchAdmission,
  );
  const control = createNativeTaskLaunch({
    registry,
    configuration: task,
    enabled,
    launchEnabled,
    ...(testClient ? { testClient } : {}),
  });
  let active = false;
  return Object.freeze({
    async run(input: NativeLaunchControlInput): Promise<NativeLaunchControlOutput> {
      if (
        active ||
        !validateNativeLaunchControlInput(input) ||
        !enabled() ||
        (input.action === "launch" && !launchEnabled())
      )
        throw nativeLaunchControlUnavailable();
      const fixed = structuredClone(input);
      active = true;
      try {
        if (fixed.action === "recover") {
          const allocation = await control.recover(fixed.scope, fixed.taskArn);
          return {
            schemaVersion: 1,
            request: fixed,
            outcome: "captured",
            capture: { scope: fixed.scope, allocation },
          };
        }
        const intent = await registry.admit({
          ownerUserId: fixed.ownerUserId,
          applicationId: fixed.applicationId,
          original: fixed.original,
          previousEpochId: fixed.previousEpochId,
          deployment: {
            clusterArn: task.clusterArn,
            taskDefinitionArn: task.taskDefinitionArn,
            containerName: task.containerName,
          },
        });
        const originalScope = {
          allocationId: intent.allocationId,
          ownerUserId: intent.ownerUserId,
          applicationId: intent.applicationId,
          generationId: intent.generationId,
          epochId: intent.epochId,
        };
        const allocation = await control.launch(originalScope);
        return {
          schemaVersion: 1,
          request: fixed,
          outcome: "captured",
          capture: { scope: originalScope, allocation },
        };
      } finally {
        active = false;
      }
    },
    close: () => pool.end(),
  });
}

/** Default-off numeric private Lambda. Managed invocation authentication is supplied by
 * reviewed IAM, not by event fields or target matching. No public route is created. */
export function createNativeMaterialLaunchLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeMaterialLaunchRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeMaterialLaunchRuntime;
  let pinned: Configuration | undefined;
  let initialization: Promise<ReturnType<typeof createRuntime>> | undefined;
  const same = (config: Configuration | undefined) =>
    config !== undefined && JSON.stringify(config) === JSON.stringify(pinned);
  const enabled = () => {
    try {
      return same(configuration(environment()));
    } catch {
      return false;
    }
  };
  const launchEnabled = () =>
    enabled() && environment().NATIVE_MATERIAL_NEW_LAUNCH_ENABLED === "true";
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<NativeLaunchControlOutput> => {
    if (!validateNativeLaunchControlInput(raw)) throw nativeLaunchControlUnavailable();
    const input = structuredClone(raw);
    const unavailable: NativeLaunchControlOutput = {
      schemaVersion: 1,
      request: input,
      outcome: "unavailable",
      capture: null,
    };
    try {
      const env = environment();
      const config = configuration(env);
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && !same(config)) ||
        (input.action === "launch" && env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED !== "true")
      )
        return unavailable;
      if (!initialization) {
        pinned = config;
        const sessionToken = env.AWS_SESSION_TOKEN;
        if (!sessionToken) return unavailable;
        initialization = (async () => {
          const url = await resolve(
            { DATABASE_SECRET_ID: config.secretId },
            { sessionToken, requestTimeoutMilliseconds: 3_000, retryDelaysMilliseconds: [] },
          );
          if (!enabled()) throw nativeLaunchControlUnavailable();
          return createRuntime(url, config, enabled, launchEnabled);
        })();
      }
      const startup = initialization;
      let runtime: ReturnType<typeof createRuntime>;
      try {
        runtime = await startup;
      } catch {
        if (initialization === startup) initialization = undefined;
        return unavailable;
      }
      if (!enabled() || (input.action === "launch" && !launchEnabled())) return unavailable;
      const result = await runtime.run(input);
      if (
        !enabled() ||
        (input.action === "launch" && !launchEnabled()) ||
        !validateNativeLaunchControlOutput(result) ||
        JSON.stringify(result.request) !== JSON.stringify(input)
      )
        return unavailable;
      return structuredClone(result);
    } catch {
      return unavailable;
    }
  };
}
const launchHandler = createNativeMaterialLaunchLambda();
const routeHandler = createNativeMaterialRouteControlLambda();
/** One numeric private endpoint; legacy launch/recovery shapes remain unchanged. */
export const handler = (raw: unknown, context: { invokedFunctionArn: string }) =>
  validateNativeMaterialRouteControlInput(raw)
    ? routeHandler(raw, context)
    : launchHandler(raw, context);
