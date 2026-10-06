import { randomBytes } from "node:crypto";
import {
  createApplicationsDatabase,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import {
  lockNativeMaterialApplicationAdmission,
  readNativePreparationBootstrap,
} from "@ai-job-apply/applications-service/native-material-runtime";
import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import { PostgresNativeMaterialRegistry } from "@ai-job-apply/documents-service/native-material-registry";
import { createNativeOwnerControlStore } from "@ai-job-apply/documents-service/native-owner-control-store";
import {
  type NativeOwnerRpcOutput,
  nativeOwnerClosed,
  nativeOwnerRpcUnavailable,
} from "@ai-job-apply/documents-service/native-owner-rpc-contract";
import {
  createNativeOwnerRpcHandler,
  type NativeOwnerRpcOwners,
} from "@ai-job-apply/documents-service/native-owner-rpc-handler";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  PostgresProfileStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import { readNativePrincipal } from "@ai-job-apply/profile-service/native-principal";
import { createNativeOwnedCoverLetterEvidenceSource } from "./native-material-evidence.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  taskRoleArn: string;
  deployment: { clusterArn: string; taskDefinitionArn: string; containerName: string };
}
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_OWNER_RPC_ENABLED !== "true" ||
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
  const json = env.NATIVE_OWNER_RPC_DEPLOYMENT_JSON;
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

/** Real owner API composition. Separate native SQL admission/lease clients avoid nested pool
 * waits. No provider, renderer, generated body, object store, task control or work issuer. */
export function createNativeOwnerRpcRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
): NativeOwnerRpcOwners & { close(): Promise<void> } {
  const applicationPool = createApplicationsDatabase(url, { maxConnections: 1 });
  const profilePool = createDatabase(url, { maxConnections: 1 });
  const jobsPool = createJobCatalogDatabase(url, { maxConnections: 1 });
  const controls = createNativeOwnerControlStore(url, config.target, enabled);
  const applications = new PostgresApplicationStore(applicationPool);
  const profile = new PostgresProfileStore(profilePool);
  const catalog = new PostgresJobCatalog(jobsPool, {
    searchCursorKeys: {
      active: { id: "native-evidence-unused", key: randomBytes(32) },
    },
  });
  const registry = new PostgresNativeMaterialRegistry(
    applicationPool,
    enabled,
    lockNativeMaterialApplicationAdmission,
  );
  const checkAdmission = registry.checkEvidenceAdmission.bind(registry);
  return Object.freeze({
    checkAdmission,
    principal: async (binding: Parameters<typeof checkAdmission>[0], issuer: string) => {
      const original = await readNativePreparationBootstrap(
        applicationPool,
        binding.scope,
        enabled,
      );
      await controls.checkBootstrap(binding, original);
      const principal = await readNativePrincipal(
        profilePool.client,
        binding.scope.ownerUserId,
        issuer,
        enabled,
      );
      await readNativePreparationBootstrap(applicationPool, binding.scope, enabled);
      await controls.checkBootstrap(binding, original);
      return principal;
    },
    bootstrap: async (binding: Parameters<typeof checkAdmission>[0]) => {
      const identity = await readNativePreparationBootstrap(
        applicationPool,
        binding.scope,
        enabled,
      );
      await controls.checkBootstrap(binding, identity);
      const rechecked = await readNativePreparationBootstrap(
        applicationPool,
        binding.scope,
        enabled,
      );
      if (JSON.stringify(identity) !== JSON.stringify(rechecked)) throw nativeOwnerRpcUnavailable();
      return identity;
    },
    evidence: (
      binding: Parameters<typeof checkAdmission>[0],
      context: { jobContextHash: string; confirmedFactsHash: string },
    ) =>
      createNativeOwnedCoverLetterEvidenceSource({
        binding,
        context,
        checkAdmission: async (original) => {
          await checkAdmission(original);
          await controls.checkEvidenceContext(original, context);
        },
        applications,
        profile,
        catalog,
        candidateLease: controls.candidateLease,
        enabled,
      }),
    work: controls.work,
    completion: controls.completion,
    close: async () => {
      await Promise.all([
        applicationPool.end(),
        profilePool.client.end(),
        jobsPool.end(),
        controls.close(),
      ]);
    },
  });
}

/** Lazy private numeric-version handler. STS authentication happens before secret resolution
 * or owner initialization. The old unauthenticated scalar contracts are not accepted here. */
export function createNativeOwnerRpcLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeOwnerRpcRuntime;
    testFetch?: Parameters<typeof createNativeOwnerRpcHandler>[0]["testFetch"];
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeOwnerRpcRuntime;
  if (options.testFetch && process.env.NODE_ENV !== "test") throw nativeOwnerRpcUnavailable();
  let pinned: Configuration | undefined;
  let initialization: Promise<ReturnType<typeof createRuntime>> | undefined;
  let receiver: ReturnType<typeof createNativeOwnerRpcHandler> | undefined;
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
  ): Promise<NativeOwnerRpcOutput> => {
    try {
      const config = configuration(environment());
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && JSON.stringify(config) !== JSON.stringify(pinned))
      )
        throw nativeOwnerRpcUnavailable();
      if (!receiver) {
        pinned = config;
        receiver = createNativeOwnerRpcHandler({
          ...config,
          targetArn: config.target,
          enabled,
          ...(options.testFetch ? { testFetch: options.testFetch } : {}),
          owners: async () => {
            if (!enabled()) throw nativeOwnerRpcUnavailable();
            if (!initialization) {
              const sessionToken = environment().AWS_SESSION_TOKEN;
              if (!sessionToken) throw nativeOwnerRpcUnavailable();
              initialization = (async () => {
                const url = await resolve(
                  { DATABASE_SECRET_ID: config.secretId },
                  { sessionToken, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
                );
                if (!enabled()) throw nativeOwnerRpcUnavailable();
                return createRuntime(url, config, enabled);
              })();
            }
            const startup = initialization;
            try {
              return await startup;
            } catch {
              if (initialization === startup) initialization = undefined;
              throw nativeOwnerRpcUnavailable();
            }
          },
        });
      }
      return await receiver(raw, context);
    } catch {
      throw nativeOwnerRpcUnavailable();
    }
  };
}
export const handler = createNativeOwnerRpcLambda();
