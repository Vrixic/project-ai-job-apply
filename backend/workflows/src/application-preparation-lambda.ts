import { randomBytes } from "node:crypto";
import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import {
  providerControlVersion,
  S3CoverLetterProviderObjects,
} from "@ai-job-apply/documents-service/cover-letter-provider";
import {
  CoverLetterProviderInvoker,
  createCoverLetterPersistence,
  S3CoverLetterObjectStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  PostgresProfileStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { createApplicationPreparationActivityHandler } from "./application-preparation-activity.js";
import {
  type ApplicationPreparationActivityInput,
  type ApplicationPreparationActivityResult,
  validateApplicationPreparationActivityInput,
} from "./application-preparation-contract.js";
import { createIsolatedCoverLetterPreparationPort } from "./application-preparation-documents.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = {
  target: string;
  secretId: string;
  provider: string;
  bucket: string;
  kms: string;
};
const clientConfiguration = {
  region: "us-east-2",
  maxAttempts: 1,
  ignoreConfiguredEndpointUrls: true,
} as const;

function configuration(env: Environment): Configuration | undefined {
  if (
    env.APPLICATION_PREPARATION_ACTIVITY_ENABLED !== "true" ||
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
  const provider = env.COVER_LETTER_PROVIDER_FUNCTION_ARN;
  if (!provider?.startsWith(prefix)) return;
  providerControlVersion(target);
  providerControlVersion(provider);
  if (target.slice(0, target.lastIndexOf(":")) === provider.slice(0, provider.lastIndexOf(":")))
    return;
  const secretId = env.DATABASE_SECRET_ID;
  const bucket = env.DOCUMENT_BUCKET_NAME;
  const kms = env.DOCUMENT_KMS_KEY_ARN;
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) ||
    bucket.includes("..") ||
    !kms ||
    !new RegExp(
      `^arn:aws:kms:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:key/[a-f0-9-]{36}$`,
      "u",
    ).test(kms)
  )
    return;
  return { target, secretId, provider, bucket, kms };
}
type Runtime = {
  run: ReturnType<typeof createApplicationPreparationActivityHandler>;
  close: () => Promise<void>;
};

/** Real owner composition; seams replace external transports only in synthetic tests. No model/key. */
export function createApplicationPreparationRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
  clients: { s3?: S3Client; lambda?: LambdaClient } = {},
): Runtime {
  const s3 = clients.s3 ?? new S3Client(clientConfiguration);
  const lambda = clients.lambda ?? new LambdaClient(clientConfiguration);
  const finalObjects = new S3CoverLetterObjectStore(config.bucket, config.kms, s3);
  const persistence = createCoverLetterPersistence(url, finalObjects, enabled);
  const applicationsPool = createApplicationsDatabase(url, { maxConnections: 1 });
  const profilePool = createDatabase(url, { maxConnections: 1 });
  const jobsPool = createJobCatalogDatabase(url, { maxConnections: 1 });
  const applications = new PostgresApplicationStore(applicationsPool, undefined, {
    definitions: defaultFieldDefinitions(),
  });
  const profile = new PostgresProfileStore(profilePool);
  // This capability never searches or emits cursors; a fresh key keeps unused search authority private.
  const catalog = new PostgresJobCatalog(jobsPool, {
    searchCursorKeys: { active: { id: "preparation-unused", key: randomBytes(32) } },
  });
  const port = createIsolatedCoverLetterPreparationPort({
    owners: { applications, profile, catalog },
    documents: persistence.documents,
    work: persistence.work,
    candidateLease: persistence.candidateLease,
    objects: new S3CoverLetterProviderObjects(config.bucket, config.kms, s3),
    provider: new CoverLetterProviderInvoker(config.provider, lambda, enabled),
    enabled,
  });
  return {
    run: createApplicationPreparationActivityHandler(
      Object.freeze({
        getPreparationForEvent: applications.getPreparationForEvent.bind(applications),
        claimPreparationGeneration: applications.claimPreparationGeneration.bind(applications),
        completePreparation: applications.completePreparation.bind(applications),
        failPreparation: applications.failPreparation.bind(applications),
      }),
      port,
    ),
    close: async () => {
      await Promise.all([
        persistence.close(),
        applicationsPool.end(),
        profilePool.client.end(),
        jobsPool.end(),
      ]);
      if (!clients.s3) s3.destroy();
      if (!clients.lambda) lambda.destroy();
    },
  };
}

/** Lazy, default-off private activity. Exact version matching is not caller authentication. */
export function createApplicationPreparationLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createApplicationPreparationRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createApplicationPreparationRuntime;
  let pinned: Configuration | undefined;
  let initialization: Promise<Runtime> | undefined;
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
  ): Promise<ApplicationPreparationActivityResult> => {
    let input: ApplicationPreparationActivityInput;
    try {
      if (!validateApplicationPreparationActivityInput(raw)) throw Error();
      input = structuredClone(raw);
    } catch {
      throw new Error("ApplicationPreparationActivityInputRejected");
    }
    const unavailable: ApplicationPreparationActivityResult = {
      schemaVersion: 1,
      action: input.action,
      preparationId: input.preparationId,
      outcome: "retryable_failure",
      errorCode: "store_unavailable",
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
            { sessionToken, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
          );
          if (!enabled()) throw Error();
          return createRuntime(url, config, enabled);
        })();
      }
      const startup = initialization;
      let runtime: Runtime;
      try {
        runtime = await startup;
      } catch {
        if (initialization === startup) initialization = undefined;
        return unavailable;
      }
      if (!enabled()) return unavailable;
      const result = await runtime.run(input);
      return enabled() ? result : unavailable;
    } catch {
      return unavailable;
    }
  };
}
export const handler = createApplicationPreparationLambda();
