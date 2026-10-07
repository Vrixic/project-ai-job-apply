import { createHash } from "node:crypto";
import {
  createApplicationsDatabase,
  lockNativeMaterialApplicationAdmission,
} from "@ai-job-apply/applications-service/native-material-runtime";
import { PostgresNativeMaterialLocationStore } from "@ai-job-apply/documents-service/native-material-location-store";
import { PostgresNativeMaterialRegistry } from "@ai-job-apply/documents-service/native-material-registry";
import {
  type NativeMaterialRouteControlInput,
  type NativeMaterialRouteControlOutput,
  nativeMaterialRouteControlUnavailable,
  validateNativeMaterialRouteControlInput,
  validateNativeMaterialRouteControlOutput,
} from "@ai-job-apply/documents-service/native-material-route-control-contract";
import { createNativeMaterialTaskAddressReader } from "@ai-job-apply/documents-service/native-material-task-address";
import {
  type NativeResumeRouteConfiguration,
  nativeResumeRouteConfiguration,
} from "@ai-job-apply/documents-service/native-resume-route-policy";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service/lambda-database-url";
import {
  type NativeMaterialControlConfiguration,
  nativeMaterialControlConfiguration,
} from "./native-material-control-configuration.js";
import { createNativeMaterialRouteOwner } from "./native-material-route-owner.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = NativeMaterialControlConfiguration & { route: NativeResumeRouteConfiguration };
function configuration(env: Environment): Configuration | undefined {
  if (env.NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED !== "true") return;
  const base = nativeMaterialControlConfiguration(env);
  const json = env.NATIVE_MATERIAL_ROUTE_CONFIGURATION_JSON;
  if (base?.task.assignPublicIp !== "ENABLED" || !json || Buffer.byteLength(json) > 1024) return;
  return { ...base, route: nativeResumeRouteConfiguration(JSON.parse(json)) };
}
/** Read-only owning route composition: no DNS writes, task launch/stop or content processing. */
export function createNativeMaterialRouteControlRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
) {
  const pool = createApplicationsDatabase(url, { maxConnections: 1 });
  const registry = new PostgresNativeMaterialRegistry(
    pool,
    enabled,
    lockNativeMaterialApplicationAdmission,
  );
  const ready = new PostgresNativeMaterialLocationStore(pool, enabled);
  const address = createNativeMaterialTaskAddressReader({
    registry,
    ready,
    configuration: config.task,
    enabled,
  });
  const sha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-material-launch.v1", ...config.task }))
    .digest("hex");
  let active = false;
  return Object.freeze({
    async run(input: NativeMaterialRouteControlInput): Promise<NativeMaterialRouteControlOutput> {
      if (active || !enabled() || !validateNativeMaterialRouteControlInput(input))
        throw nativeMaterialRouteControlUnavailable();
      const fixed = structuredClone(input);
      for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
        if (fixed.binding.allocation[key] !== config.task[key])
          throw nativeMaterialRouteControlUnavailable();
      active = true;
      try {
        const owner = createNativeMaterialRouteOwner({
          registry,
          address,
          binding: fixed.binding,
          reference: fixed.reference,
          configurationSha256: sha,
          route: config.route,
          enabled,
        });
        const base = { schemaVersion: 1 as const, request: fixed, route: null };
        if (fixed.action === "capture")
          return { ...base, outcome: "captured", route: await owner.capture(fixed.binding.scope) };
        if (fixed.action === "admit") {
          if (!(await owner.admit(fixed.binding.scope, fixed.route)))
            throw nativeMaterialRouteControlUnavailable();
          return { ...base, outcome: "admitted" };
        }
        return {
          ...base,
          outcome: (await owner.retired(fixed.binding.scope)) ? "retired" : "pending",
        };
      } finally {
        active = false;
      }
    },
    close: () => pool.end(),
  });
}
export function createNativeMaterialRouteControlLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeMaterialRouteControlRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeMaterialRouteControlRuntime;
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
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<NativeMaterialRouteControlOutput> => {
    if (!validateNativeMaterialRouteControlInput(raw))
      throw nativeMaterialRouteControlUnavailable();
    const input = structuredClone(raw);
    const unavailable: NativeMaterialRouteControlOutput = {
      schemaVersion: 1,
      request: input,
      outcome: "unavailable",
      route: null,
    };
    try {
      const env = environment();
      const config = configuration(env);
      if (!config || context?.invokedFunctionArn !== config.target || (pinned && !same(config)))
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
          if (!enabled()) throw nativeMaterialRouteControlUnavailable();
          return createRuntime(url, config, enabled);
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
      if (!enabled()) return unavailable;
      const result = await runtime.run(input);
      if (
        !enabled() ||
        !validateNativeMaterialRouteControlOutput(result) ||
        JSON.stringify(result.request) !== JSON.stringify(input)
      )
        return unavailable;
      return structuredClone(result);
    } catch {
      return unavailable;
    }
  };
}
