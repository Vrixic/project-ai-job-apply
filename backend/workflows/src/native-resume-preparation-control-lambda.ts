import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { PostgresNativeResumeGenerationStore } from "@ai-job-apply/documents-service/native-resume-generation-store";
import {
  type NativeResumePreparationControlInput,
  type NativeResumePreparationControlOutput,
  nativeResumePreparationControlUnavailable,
  validateNativeResumePreparationControlInput,
  validateNativeResumePreparationControlOutput,
} from "@ai-job-apply/documents-service/native-resume-preparation-control-contract";
import {
  type NativeResumeRouteConfiguration,
  nativeResumeRouteConfiguration,
} from "@ai-job-apply/documents-service/native-resume-route-policy";
import { createNativeResumeTaskAddressReader } from "@ai-job-apply/documents-service/native-resume-task-address";
import {
  createNativeResumeTaskLaunch,
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
} from "@ai-job-apply/documents-service/native-resume-task-launch";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service/lambda-database-url";
import {
  createNativeResumeGenerationOwnerPorts,
  createNativeResumePacketAuthority,
} from "./native-resume-owner-ports.js";
import { createNativeResumePreparation } from "./native-resume-preparation.js";
import { createNativeResumeRouteOwner } from "./native-resume-route-owner.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  task: ReturnType<typeof nativeTaskLaunchConfiguration>;
  route?: NativeResumeRouteConfiguration;
}
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_RESUME_PREPARATION_CONTROL_ENABLED !== "true" ||
    env.RESTRICTED_PACKET_PROTECTION_ENABLED !== "true" ||
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
  const json = env.NATIVE_RESUME_LAUNCH_CONFIGURATION_JSON;
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
  let route: NativeResumeRouteConfiguration | undefined;
  if (env.NATIVE_RESUME_ROUTE_OWNER_ENABLED === "true") {
    const routeJson = env.NATIVE_RESUME_ROUTE_CONFIGURATION_JSON;
    if (!routeJson || Buffer.byteLength(routeJson) > 1024 || task.assignPublicIp !== "ENABLED")
      return;
    route = nativeResumeRouteConfiguration(JSON.parse(routeJson) as NativeResumeRouteConfiguration);
  }
  return { target, secretId, task, ...(route ? { route } : {}) };
}

/** Private owner control only: scalar reservation/launch and ready packet attachment. No source
 * objects, generated content, renderer, model, retirement or approval capability. */
export function createNativeResumePreparationControlRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
  launchEnabled: () => boolean,
  testClient?: Parameters<typeof createNativeResumeTaskLaunch>[0]["testClient"],
  testAddressClients?: Parameters<typeof createNativeResumeTaskAddressReader>[0]["testClients"],
) {
  if ((testClient || testAddressClients) && process.env.NODE_ENV !== "test")
    throw nativeResumePreparationControlUnavailable();
  const task = nativeTaskLaunchConfiguration(config.task);
  const pool = createApplicationsDatabase(url, { maxConnections: 2 });
  const generations = new PostgresNativeResumeGenerationStore(
    pool,
    createNativeResumeGenerationOwnerPorts(enabled),
    enabled,
  );
  const applications = new PostgresApplicationStore(pool, () => new Date(), {
    definitions: defaultFieldDefinitions(),
    nativeResumeMaterials: createNativeResumePacketAuthority(enabled),
  });
  const launcher = createNativeResumeTaskLaunch({
    registry: generations,
    configuration: task,
    enabled,
    launchEnabled,
    ...(testClient ? { testClient } : {}),
  });
  const preparation = createNativeResumePreparation({
    generations,
    applications,
    launcher,
    enabled,
  });
  const routeOwner = config.route
    ? createNativeResumeRouteOwner({
        generations,
        configurationSha256: launcher.configurationSha256,
        route: config.route,
        enabled,
        address: createNativeResumeTaskAddressReader({
          registry: generations,
          configuration: task,
          enabled,
          ...(testAddressClients ? { testClients: testAddressClients } : {}),
        }),
      })
    : undefined;
  let active = false;
  return Object.freeze({
    async run(
      input: NativeResumePreparationControlInput,
    ): Promise<NativeResumePreparationControlOutput> {
      if (
        active ||
        !enabled() ||
        !validateNativeResumePreparationControlInput(input) ||
        (input.action === "start" && !launchEnabled())
      )
        throw nativeResumePreparationControlUnavailable();
      const fixed = structuredClone(input);
      active = true;
      try {
        if (fixed.action === "start") {
          for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
            if (fixed.reservation.deployment[key] !== task[key])
              throw nativeResumePreparationControlUnavailable();
          const scope = await preparation.start(fixed.reservation);
          return { schemaVersion: 1, request: fixed, outcome: "reserved", scope, packet: null };
        }
        if (fixed.action === "recover") {
          await launcher.recover(fixed.scope, fixed.taskArn);
          return {
            schemaVersion: 1,
            request: fixed,
            outcome: "captured",
            scope: fixed.scope,
            packet: null,
          };
        }
        if (
          fixed.action === "route_capture" ||
          fixed.action === "route_admit" ||
          fixed.action === "route_retired"
        ) {
          if (!routeOwner) throw nativeResumePreparationControlUnavailable();
          const base = {
            schemaVersion: 1 as const,
            request: fixed,
            scope: fixed.scope,
            packet: null,
          };
          if (fixed.action === "route_capture") {
            const route = await routeOwner.capture(fixed.scope);
            return route
              ? { ...base, outcome: "route_captured", route }
              : { ...base, outcome: "pending" };
          }
          if (fixed.action === "route_admit") {
            if (!(await routeOwner.admit(fixed.scope, fixed.route)))
              throw nativeResumePreparationControlUnavailable();
            return { ...base, outcome: "admitted" };
          }
          return {
            ...base,
            outcome: (await routeOwner.retired(fixed.scope)) ? "retired" : "pending",
          };
        }
        const result = await preparation.complete(fixed.scope);
        return {
          schemaVersion: 1,
          request: fixed,
          outcome: result.kind === "ready" ? "ready" : "pending",
          scope: fixed.scope,
          packet:
            result.kind === "ready" ? { id: result.packetId, revision: result.revision } : null,
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
export function createNativeResumePreparationControlLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeResumePreparationControlRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeResumePreparationControlRuntime;
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
    enabled() && environment().NATIVE_RESUME_NEW_LAUNCH_ENABLED === "true";
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<NativeResumePreparationControlOutput> => {
    if (!validateNativeResumePreparationControlInput(raw))
      throw nativeResumePreparationControlUnavailable();
    const input = structuredClone(raw);
    const unavailable: NativeResumePreparationControlOutput = {
      schemaVersion: 1,
      request: input,
      outcome: "unavailable",
      scope: null,
      packet: null,
    };
    try {
      const env = environment();
      const config = configuration(env);
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && !same(config)) ||
        (input.action === "start" && env.NATIVE_RESUME_NEW_LAUNCH_ENABLED !== "true")
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
          if (!enabled()) throw nativeResumePreparationControlUnavailable();
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
      if (!enabled() || (input.action === "start" && !launchEnabled())) return unavailable;
      const result = await runtime.run(input);
      if (
        !enabled() ||
        (input.action === "start" && !launchEnabled()) ||
        !validateNativeResumePreparationControlOutput(result) ||
        JSON.stringify(result.request) !== JSON.stringify(input)
      )
        return unavailable;
      return structuredClone(result);
    } catch {
      return unavailable;
    }
  };
}
export const handler = createNativeResumePreparationControlLambda();
