import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { nativeOwnerClosed } from "@ai-job-apply/documents-service/native-owner-rpc-contract";
import {
  type NativeResumeOwnerRpcOutput,
  nativeResumeOwnerUnavailable,
} from "@ai-job-apply/documents-service/native-resume-owner-rpc-contract";
import {
  createNativeResumeOwnerRpcHandler,
  type NativeResumeOwnerRpcOwners,
} from "@ai-job-apply/documents-service/native-resume-owner-rpc-handler";
import { createNativeResumeOwnerControlStore } from "@ai-job-apply/documents-service/native-resume-owner-controls";
import type { NativeResumeTaskBinding } from "@ai-job-apply/documents-service/native-resume-task-binding";
import { createDatabase, resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { readNativePrincipal } from "@ai-job-apply/profile-service/native-principal";
import { createNativeResumeGenerationOwnerPorts } from "./native-resume-owner-ports.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  taskRoleArn: string;
  deployment: { clusterArn: string; taskDefinitionArn: string; containerName: string };
}
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_RESUME_OWNER_RPC_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
    ].some((k) => env[k] !== undefined)
  )
    return;
  const account = env.PLATFORM_AWS_ACCOUNT_ID;
  const target = `arn:aws:lambda:us-east-2:${account}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  nativeLaunchControlVersion(target);
  const secretId = env.DATABASE_SECRET_ID;
  const json = env.NATIVE_RESUME_OWNER_RPC_DEPLOYMENT_JSON;
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${account}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId) ||
    !json ||
    Buffer.byteLength(json) > 4096
  )
    return;
  const config: unknown = JSON.parse(json);
  if (
    !nativeOwnerClosed(config, [
      "taskRoleArn",
      "clusterArn",
      "taskDefinitionArn",
      "containerName",
    ]) ||
    typeof config.taskRoleArn !== "string" ||
    !new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]{1,512}$`, "u").test(
      config.taskRoleArn,
    ) ||
    typeof config.clusterArn !== "string" ||
    !new RegExp(`^arn:aws:ecs:us-east-2:${account}:cluster/[A-Za-z0-9_-]{1,255}$`, "u").test(
      config.clusterArn,
    ) ||
    typeof config.taskDefinitionArn !== "string" ||
    !new RegExp(
      `^arn:aws:ecs:us-east-2:${account}:task-definition/[A-Za-z0-9_-]{1,255}:[1-9][0-9]{0,8}$`,
      "u",
    ).test(config.taskDefinitionArn) ||
    typeof config.containerName !== "string" ||
    !/^[A-Za-z0-9_-]{1,255}$/u.test(config.containerName)
  )
    return;
  return {
    target,
    secretId,
    taskRoleArn: config.taskRoleArn,
    deployment: {
      clusterArn: config.clusterArn,
      taskDefinitionArn: config.taskDefinitionArn,
      containerName: config.containerName,
    },
  };
}

/** Actual Documents ledger with same-transaction Applications/Jobs admission. No generated
 * bodies, object storage, rendering, provider work, launch, renewal or retirement capability. */
export function createNativeResumeOwnerRpcRuntime(
  url: string,
  _config: Configuration,
  enabled: () => boolean,
): NativeResumeOwnerRpcOwners & { close(): Promise<void> } {
  const controls = createNativeResumeOwnerControlStore(
    url,
    createNativeResumeGenerationOwnerPorts(enabled),
    enabled,
  );
  const profile = createDatabase(url, { maxConnections: 1 });
  return Object.freeze({
    ...controls,
    principal: (binding: Readonly<NativeResumeTaskBinding>, issuer: string) =>
      readNativePrincipal(profile.client, binding.scope.ownerUserId, issuer, enabled),
    close: async () => {
      await Promise.all([controls.close(), profile.client.end()]);
    },
  });
}

/** Lazy private numeric-version handler. STS authentication happens before secret resolution
 * or owner initialization. The old unauthenticated scalar contracts are not accepted here. */
export function createNativeResumeOwnerRpcLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeResumeOwnerRpcRuntime;
    testFetch?: Parameters<typeof createNativeResumeOwnerRpcHandler>[0]["testFetch"];
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeResumeOwnerRpcRuntime;
  if (options.testFetch && process.env.NODE_ENV !== "test") throw nativeResumeOwnerUnavailable();
  let pinned: Configuration | undefined;
  let initialization: Promise<ReturnType<typeof createRuntime>> | undefined;
  let receiver: ReturnType<typeof createNativeResumeOwnerRpcHandler> | undefined;
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
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<NativeResumeOwnerRpcOutput> => {
    try {
      const config = configuration(environment());
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && JSON.stringify(config) !== JSON.stringify(pinned))
      )
        throw nativeResumeOwnerUnavailable();
      if (!receiver) {
        pinned = config;
        receiver = createNativeResumeOwnerRpcHandler({
          ...config,
          targetArn: config.target,
          enabled,
          ...(options.testFetch ? { testFetch: options.testFetch } : {}),
          owners: async () => {
            if (!enabled()) throw nativeResumeOwnerUnavailable();
            if (!initialization) {
              const sessionToken = environment().AWS_SESSION_TOKEN;
              if (!sessionToken) throw nativeResumeOwnerUnavailable();
              initialization = (async () => {
                const url = await resolve(
                  { DATABASE_SECRET_ID: config.secretId },
                  { sessionToken, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
                );
                if (!enabled()) throw nativeResumeOwnerUnavailable();
                return createRuntime(url, config, enabled);
              })();
            }
            const startup = initialization;
            try {
              return await startup;
            } catch {
              if (initialization === startup) initialization = undefined;
              throw nativeResumeOwnerUnavailable();
            }
          },
        });
      }
      return await receiver(raw, context);
    } catch {
      throw nativeResumeOwnerUnavailable();
    }
  };
}
export const handler = createNativeResumeOwnerRpcLambda();
