import { createApplicationsDatabase } from "@ai-job-apply/applications-service";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { PostgresNativeResumeGenerationStore } from "@ai-job-apply/documents-service/native-resume-generation-store";
import { createNativeResumeTaskObserver } from "@ai-job-apply/documents-service/native-resume-task-observer";
import {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope,
} from "@ai-job-apply/documents-service/native-task-launch-policy";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { nativeResumeStoppedTaskEvent } from "./native-resume-task-event.js";

type Environment = Readonly<Record<string, string | undefined>>;
const unavailable = () => Error("NativeResumeTaskObserverUnavailable");
function request(raw: unknown) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Object.getPrototypeOf(raw) !== Object.prototype ||
    Reflect.ownKeys(raw).length !== 3
  )
    throw unavailable();
  for (const key of ["schemaVersion", "action", "scope"]) {
    const field = Object.getOwnPropertyDescriptor(raw, key);
    if (!field?.enumerable || !("value" in field)) throw unavailable();
  }
  const input = raw as {
    schemaVersion: unknown;
    action: unknown;
    scope: Parameters<typeof nativeTaskLaunchScope>[0];
  };
  if (input.schemaVersion !== 1 || input.action !== "observe") throw unavailable();
  return nativeTaskLaunchScope(input.scope);
}
function configuration(env: Environment) {
  if (
    env.NATIVE_RESUME_TASK_OBSERVER_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
    ].some((key) => env[key] !== undefined)
  )
    throw unavailable();
  const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  nativeLaunchControlVersion(target);
  const secretId = env.DATABASE_SECRET_ID;
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId)
  )
    throw unavailable();
  const json = env.NATIVE_RESUME_OBSERVER_CONFIGURATION_JSON;
  if (!json || Buffer.byteLength(json) > 8192) throw unavailable();
  const task = nativeTaskLaunchConfiguration(JSON.parse(json) as NativeTaskLaunchConfiguration);
  if (!task.clusterArn.startsWith(`arn:aws:ecs:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:cluster/`))
    throw unavailable();
  return { target, secretId, task };
}
type Configuration = ReturnType<typeof configuration>;

/** No creation/admission ports are supplied. Runtime exposes only original observation and
 * positive retirement persistence; ECS policy must allow DescribeTasks and deny StopTask. */
export function createNativeResumeTaskObserverRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
) {
  const database = createApplicationsDatabase(url, { maxConnections: 1 });
  const denied = async () => {
    throw unavailable();
  };
  const registry = new PostgresNativeResumeGenerationStore(
    database,
    { application: denied, job: denied },
    enabled,
  );
  const observer = createNativeResumeTaskObserver({
    registry,
    configuration: config.task,
    enabled,
  });
  return Object.freeze({ observe: observer.observe, close: () => database.end() });
}

/** Private numeric version only. Caller authentication is reviewed IAM, not event fields.
 * No event/HTTP route, task stop, generation, packet attachment or external receipt ingestion. */
export function createNativeResumeTaskObserverLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeResumeTaskObserverRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeResumeTaskObserverRuntime;
  let pinned: string | undefined;
  let startup: Promise<ReturnType<typeof createRuntime>> | undefined;
  const enabled = () => {
    try {
      return pinned !== undefined && JSON.stringify(configuration(environment())) === pinned;
    } catch {
      return false;
    }
  };
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    try {
      const env = environment(),
        config = configuration(env),
        key = JSON.stringify(config);
      if (context?.invokedFunctionArn !== config.target || (pinned !== undefined && pinned !== key))
        throw unavailable();
      const isEvent =
        raw !== null &&
        typeof raw === "object" &&
        Object.getOwnPropertyDescriptor(raw, "source")?.value === "aws.ecs";
      const hint = isEvent
        ? nativeResumeStoppedTaskEvent(raw, config.task)
        : { scope: request(raw), taskArn: undefined };
      if (!startup) {
        pinned = key;
        startup = (async () => {
          const url = await resolve(
            { DATABASE_SECRET_ID: config.secretId },
            {
              sessionToken: env.AWS_SESSION_TOKEN as string,
              requestTimeoutMilliseconds: 3000,
              retryDelaysMilliseconds: [],
            },
          );
          if (!enabled()) throw unavailable();
          return createRuntime(url, config, enabled);
        })();
      }
      const current = startup;
      let runtime: ReturnType<typeof createRuntime>;
      try {
        runtime = await current;
      } catch {
        if (startup === current) startup = undefined;
        throw unavailable();
      }
      if (!enabled()) throw unavailable();
      const result = await runtime.observe(hint.scope, hint.taskArn);
      if (!enabled()) throw unavailable();
      return result;
    } catch {
      throw unavailable();
    }
  };
}
export const handler = createNativeResumeTaskObserverLambda();
