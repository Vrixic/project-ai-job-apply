import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import {
  type NativeOwnerRpcOutput,
  nativeOwnerClosed,
} from "@ai-job-apply/documents-service/native-owner-rpc-contract";
import { nativeResumeSourceUnavailable } from "@ai-job-apply/documents-service/native-resume-source";
import {
  createNativeResumeSourceRpcHandler,
  type NativeResumeSourceOwners,
} from "@ai-job-apply/documents-service/native-resume-source-rpc-handler";
import { createNativeResumeSourceStore } from "@ai-job-apply/documents-service/native-resume-source-store";
import { S3NormalizedDocumentReader } from "@ai-job-apply/documents-service/normalized-document-reader";
import { S3SourceDocumentReader } from "@ai-job-apply/documents-service/source-document-reader";
import { readNativeResumeJobSource } from "@ai-job-apply/jobs-service/native-resume-admission";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { S3Client } from "@aws-sdk/client-s3";
import { createNativeResumeGenerationOwnerPorts } from "./native-resume-owner-ports.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  bucket: string;
  kmsKeyArn: string;
  secretId: string;
  /** Also read the candidate's own PDF so the generated resume keeps its design (default off). */
  originalPdf: boolean;
  taskRoleArn: string;
  deployment: { clusterArn: string; taskDefinitionArn: string; containerName: string };
}
function configuration(env: Environment): Configuration | undefined {
  if (
    env.NATIVE_RESUME_SOURCE_RPC_ENABLED !== "true" ||
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
  const bucket = env.NATIVE_RESUME_SOURCE_BUCKET;
  const kmsKeyArn = env.NATIVE_RESUME_SOURCE_KMS_KEY_ARN;
  if (
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) ||
    !kmsKeyArn ||
    !new RegExp(`^arn:aws:kms:us-east-2:${account}:key/[a-f0-9-]{36}$`, "u").test(kmsKeyArn)
  )
    return;
  const secretId = env.DATABASE_SECRET_ID;
  const json = env.NATIVE_RESUME_SOURCE_RPC_DEPLOYMENT_JSON;
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
    bucket,
    kmsKeyArn,
    secretId,
    originalPdf: env.NATIVE_RESUME_ORIGINAL_PDF_ENABLED === "true",
    taskRoleArn: config.taskRoleArn,
    deployment: {
      clusterArn: config.clusterArn,
      taskDefinitionArn: config.taskDefinitionArn,
      containerName: config.containerName,
    },
  };
}

/** Authenticated retained source composition. No generated content or rendering capability. */
export function createNativeResumeSourceRpcRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
): NativeResumeSourceOwners & { close(): Promise<void> } {
  const s3 = new S3Client({
    region: "us-east-2",
    endpoint: "https://s3.us-east-2.amazonaws.com",
    ignoreConfiguredEndpointUrls: true,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 8000 },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return createNativeResumeSourceStore({
    url,
    enabled,
    ports: createNativeResumeGenerationOwnerPorts(enabled),
    job: (scope, query) => readNativeResumeJobSource(scope, query, enabled),
    reader: new S3NormalizedDocumentReader(config.bucket, config.kmsKeyArn, s3),
    ...(config.originalPdf
      ? { original: new S3SourceDocumentReader(config.bucket, config.kmsKeyArn, s3) }
      : {}),
  });
}

/** Lazy private numeric-version handler. STS authentication happens before secret resolution
 * or owner initialization. The old unauthenticated scalar contracts are not accepted here. */
export function createNativeResumeSourceRpcLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeResumeSourceRpcRuntime;
    testFetch?: Parameters<typeof createNativeResumeSourceRpcHandler>[0]["testFetch"];
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeResumeSourceRpcRuntime;
  if (options.testFetch && process.env.NODE_ENV !== "test") throw nativeResumeSourceUnavailable();
  let pinned: Configuration | undefined;
  let initialization: Promise<ReturnType<typeof createRuntime>> | undefined;
  let receiver: ReturnType<typeof createNativeResumeSourceRpcHandler> | undefined;
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
        throw nativeResumeSourceUnavailable();
      if (!receiver) {
        pinned = config;
        receiver = createNativeResumeSourceRpcHandler({
          ...config,
          targetArn: config.target,
          enabled,
          ...(options.testFetch ? { testFetch: options.testFetch } : {}),
          owners: async () => {
            if (!enabled()) throw nativeResumeSourceUnavailable();
            if (!initialization) {
              const sessionToken = environment().AWS_SESSION_TOKEN;
              if (!sessionToken) throw nativeResumeSourceUnavailable();
              initialization = (async () => {
                const url = await resolve(
                  { DATABASE_SECRET_ID: config.secretId },
                  { sessionToken, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
                );
                if (!enabled()) throw nativeResumeSourceUnavailable();
                return createRuntime(url, config, enabled);
              })();
            }
            const startup = initialization;
            try {
              return await startup;
            } catch {
              if (initialization === startup) initialization = undefined;
              throw nativeResumeSourceUnavailable();
            }
          },
        });
      }
      return await receiver(raw, context);
    } catch {
      throw nativeResumeSourceUnavailable();
    }
  };
}
export const handler = createNativeResumeSourceRpcLambda();
