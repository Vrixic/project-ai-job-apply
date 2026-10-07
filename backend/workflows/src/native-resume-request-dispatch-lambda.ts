import { randomBytes } from "node:crypto";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { createApplicationsDatabase } from "@ai-job-apply/applications-service";
import { PostgresNativeResumeRequestStore } from "@ai-job-apply/applications-service/native-resume-request-store";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import {
  PostgresNativeResumeGenerationStore,
  type NativeResumeReservation,
} from "@ai-job-apply/documents-service/native-resume-generation-store";
import { nativeTaskDeploymentRegion } from "@ai-job-apply/documents-service/native-task-allocation";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import { nativeResumeJobBindings } from "@ai-job-apply/jobs-service/native-resume-admission";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service/lambda-database-url";
import type { PreparationLambdaInvoker } from "./application-preparation-dispatch-aws.js";
import { createNativeResumeGenerationOwnerPorts } from "./native-resume-owner-ports.js";
import { createNativeResumeRequestDispatcher } from "./native-resume-request-dispatch.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  workflowArn: string;
  deployment: NativeResumeReservation["deployment"];
}
const unavailable = () => Error("NativeResumeDispatchUnavailable");
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED !== "true" ||
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
  const prefix = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const workflowArn = env.NATIVE_RESUME_PREPARATION_WORKFLOW_ARN,
    secretId = env.DATABASE_SECRET_ID;
  nativeLaunchControlVersion(target);
  if (
    !workflowArn?.startsWith(prefix) ||
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId)
  )
    return;
  nativeLaunchControlVersion(workflowArn);
  if (
    target.slice(0, target.lastIndexOf(":")) === workflowArn.slice(0, workflowArn.lastIndexOf(":"))
  )
    return;
  const json = env.NATIVE_RESUME_DEPLOYMENT_JSON;
  if (!json || Buffer.byteLength(json) > 2048) return;
  const deployment = JSON.parse(json) as NativeResumeReservation["deployment"];
  if (
    !deployment ||
    Object.keys(deployment).sort().join(",") !== "clusterArn,containerName,taskDefinitionArn" ||
    nativeTaskDeploymentRegion(deployment) !== "us-east-2" ||
    !deployment.clusterArn.startsWith(
      `arn:aws:ecs:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:cluster/`,
    )
  )
    return;
  return { target, secretId, workflowArn, deployment };
}
/** Scheduled private consumer of the existing Applications outbox. Captures original Documents
 * metadata before named durable invocation; it has no model/source-object/generated-body port. */
export function createNativeResumeRequestDispatchRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
  testInvoker?: PreparationLambdaInvoker,
) {
  if (testInvoker && process.env.NODE_ENV !== "test") throw unavailable();
  const sql = createApplicationsDatabase(url, { maxConnections: 2 });
  const jobPool = createJobCatalogDatabase(url, { maxConnections: 1 });
  const catalog = new PostgresJobCatalog(jobPool, {
    searchCursorKeys: { active: { id: "native-resume-unused", key: randomBytes(32) } },
  });
  const requests = new PostgresNativeResumeRequestStore(sql, enabled);
  const generations = new PostgresNativeResumeGenerationStore(
    sql,
    createNativeResumeGenerationOwnerPorts(enabled),
    enabled,
  );
  const invoker =
    testInvoker ??
    new LambdaClient({
      region: "us-east-2",
      endpoint: "https://lambda.us-east-2.amazonaws.com",
      maxAttempts: 1,
    });
  const dispatch = createNativeResumeRequestDispatcher({
    requests,
    generations,
    enabled,
    workflowArn: config.workflowArn,
    deployment: config.deployment,
    invoker,
    jobContext: async (application) => {
      const job = await catalog.getActiveJob(application.canonicalJobId, new Date());
      if (!job || !enabled()) throw unavailable();
      const bindings = nativeResumeJobBindings(job);
      if (bindings.jobRevision !== application.jobRevision) throw unavailable();
      return bindings.jobContextSha256;
    },
  });
  let active = false;
  return {
    async run() {
      if (active || !enabled()) throw unavailable();
      active = true;
      const counts = {
        schemaVersion: 1 as const,
        examined: 0,
        started: 0,
        noResume: 0,
        pending: 0,
      };
      try {
        for (const id of await requests.pending(5)) {
          if (!enabled()) throw unavailable();
          counts.examined++;
          try {
            const result = await dispatch(id);
            if (result === "started") counts.started++;
            else if (result === "no_resume") counts.noResume++;
            else counts.pending++;
          } catch {
            counts.pending++;
          }
        }
        if (!enabled()) throw unavailable();
        return counts;
      } finally {
        active = false;
      }
    },
    close: async () => {
      await Promise.all([sql.end(), jobPool.end()]);
    },
  };
}
export function createNativeResumeRequestDispatchLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeResumeRequestDispatchRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env),
    resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeResumeRequestDispatchRuntime;
  let pinned: Configuration | undefined,
    initialization: Promise<ReturnType<typeof createRuntime>> | undefined;
  const enabled = () => {
    try {
      return (
        pinned !== undefined &&
        JSON.stringify(configuration(environment())) === JSON.stringify(pinned)
      );
    } catch {
      return false;
    }
  };
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Object.keys(raw).sort().join(",") !== "action,schemaVersion" ||
      (raw as { schemaVersion: unknown }).schemaVersion !== 1 ||
      (raw as { action: unknown }).action !== "sweep"
    )
      throw unavailable();
    try {
      const env = environment(),
        config = configuration(env);
      if (!config || context?.invokedFunctionArn !== config.target || (pinned && !enabled()))
        throw unavailable();
      if (!initialization) {
        pinned = config;
        const sessionToken = env.AWS_SESSION_TOKEN;
        if (!sessionToken) throw unavailable();
        initialization = (async () => {
          const url = await resolve(
            { DATABASE_SECRET_ID: config.secretId },
            {
              sessionToken,
              requestTimeoutMilliseconds: 3000,
              retryDelaysMilliseconds: [],
            },
          );
          if (!enabled()) throw unavailable();
          return createRuntime(url, config, enabled);
        })();
      }
      const startup = initialization;
      let runtime: Awaited<typeof startup>;
      try {
        runtime = await startup;
      } catch {
        if (initialization === startup) initialization = undefined;
        throw unavailable();
      }
      if (!enabled()) throw unavailable();
      return await runtime.run();
    } catch {
      throw unavailable();
    }
  };
}
export const handler = createNativeResumeRequestDispatchLambda();
