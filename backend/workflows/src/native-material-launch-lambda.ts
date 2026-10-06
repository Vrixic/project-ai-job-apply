import {
  createApplicationsDatabase,
  lockNativeMaterialApplicationAdmission,
} from "@ai-job-apply/applications-service/native-material-runtime";
import {
  type NativeLaunchControlInput,
  type NativeLaunchControlOutput,
  nativeLaunchControlUnavailable,
  nativeLaunchControlVersion,
  validateNativeLaunchControlInput,
  validateNativeLaunchControlOutput,
} from "@ai-job-apply/documents-service/native-launch-control";
import { PostgresNativeMaterialRegistry } from "@ai-job-apply/documents-service/native-material-registry";
import {
  createNativeTaskLaunch,
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
} from "@ai-job-apply/documents-service/native-task-launch";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service/lambda-database-url";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  task: ReturnType<typeof nativeTaskLaunchConfiguration>;
}
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
    ].some((key) => env[key] !== undefined)
  )
    return;
  const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  nativeLaunchControlVersion(target);
  const secretId = env.DATABASE_SECRET_ID;
  const json = env.NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON;
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId) ||
    !json ||
    new TextEncoder().encode(json).length > 8_192
  )
    return;
  const task = nativeTaskLaunchConfiguration(JSON.parse(json) as NativeTaskLaunchConfiguration);
  if (!task.clusterArn.startsWith(`arn:aws:ecs:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:cluster/`))
    return;
  return { target, secretId, task };
}

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
export const handler = createNativeMaterialLaunchLambda();
