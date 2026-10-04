import { ModelGateway, OpenAiLunaProvider } from "@ai-job-apply/ai-sdk";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  type CoverLetterProviderInput,
  type CoverLetterProviderOutput,
  CoverLetterProviderTransportError,
  validateCoverLetterProviderInput,
} from "./cover-letter-provider-contract.js";
import { CoverLetterProviderControlClient } from "./cover-letter-provider-control-client.js";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import { createCoverLetterIsolatedProviderHandler } from "./cover-letter-provider-handler.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import {
  type CoverLetterProviderObjectClient,
  coverLetterProviderTransitionPort,
  S3CoverLetterProviderObjects,
} from "./cover-letter-provider-objects.js";
import { CoverLetterResponseCaptureClient } from "./cover-letter-response-capture-client.js";
import { resolveLambdaProviderKey, validProviderKey } from "./lambda-provider-key.js";

type Environment = Readonly<Record<string, string | undefined>>;
type ClientConfiguration = {
  region: "us-east-2";
  maxAttempts: 1;
  ignoreConfiguredEndpointUrls: true;
};
type Configuration = {
  target: string;
  secretId: string;
  bucket: string;
  kmsKeyArn: string;
  control: string;
  capture: string;
};

function configuration(env: Environment): Configuration | undefined {
  if (
    env.COVER_LETTER_ISOLATED_PROVIDER_ENABLED !== "true" ||
    env.COVER_LETTER_BACKGROUND_PROVIDER_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    ["DATABASE_URL", "DATABASE_SECRET_ID", "OPENAI_API_KEY"].some((key) => env[key] !== undefined)
  )
    return;
  const prefix = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const control = env.COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN;
  const capture = env.COVER_LETTER_RESPONSE_CAPTURE_FUNCTION_ARN;
  if (!control || !capture || !control.startsWith(prefix) || !capture.startsWith(prefix)) return;
  for (const arn of [target, control, capture]) providerControlVersion(arn);
  if (new Set([target, control, capture]).size !== 3) return;
  // Distinct functions, not merely different versions of the isolated actor or one private port.
  if (
    new Set([target, control, capture].map((arn) => arn.slice(0, arn.lastIndexOf(":")))).size !== 3
  )
    return;
  const secretId = env.COVER_LETTER_OPENAI_SECRET_ID;
  const bucket = env.CANDIDATE_DOCUMENT_BUCKET;
  const kmsKeyArn = env.PLATFORM_KMS_KEY_ARN;
  if (
    !secretId?.startsWith(
      `arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:`,
    ) ||
    !/^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(
      secretId,
    ) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket) ||
    !kmsKeyArn ||
    !new RegExp(
      `^arn:aws:kms:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`,
      "u",
    ).test(kmsKeyArn)
  )
    return;
  return { target, secretId, bucket, kmsKeyArn, control, capture };
}

/** Source-only internet actor bootstrap. No SQL, initialization, disposal or purge capabilities.
 * Exact target checks are configuration fences, not caller authentication. Reviewed IAM, writer
 * drain, retention and deployed acceptance must precede production composition or activation.
 */
export function createCoverLetterIsolatedProviderLambda(
  options: {
    environment?: () => Environment;
    resolveProviderKey?: typeof resolveLambdaProviderKey;
    createObjectClient?: (config: ClientConfiguration) => CoverLetterProviderObjectClient;
    createLambdaClient?: (config: ClientConfiguration) => CoverLetterProviderLambdaClient;
    modelFetch?: typeof fetch;
    clock?: () => Date;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveProviderKey ?? resolveLambdaProviderKey;
  const createObjects =
    options.createObjectClient ??
    ((config) => {
      const sdk = new S3Client(config);
      return {
        config: { maxAttempts: () => sdk.config.maxAttempts() },
        send: async (command: unknown, settings: { abortSignal: AbortSignal }) => {
          if (command instanceof GetObjectCommand)
            return { ...(await sdk.send(command, settings)) };
          if (command instanceof HeadObjectCommand)
            return { ...(await sdk.send(command, settings)) };
          if (command instanceof PutObjectCommand)
            return { ...(await sdk.send(command, settings)) };
          throw new CoverLetterProviderTransportError();
        },
      };
    });
  const createLambda =
    options.createLambdaClient ??
    ((config) => {
      const sdk = new LambdaClient(config);
      return {
        config: { maxAttempts: () => sdk.config.maxAttempts() },
        send: async (command, settings) => {
          const value = await sdk.send(command, settings);
          return {
            ...(value.StatusCode !== undefined ? { StatusCode: value.StatusCode } : {}),
            ...(value.ExecutedVersion !== undefined
              ? { ExecutedVersion: value.ExecutedVersion }
              : {}),
            ...(value.FunctionError !== undefined ? { FunctionError: value.FunctionError } : {}),
            ...(value.LogResult !== undefined ? { LogResult: value.LogResult } : {}),
            ...(value.Payload !== undefined ? { Payload: value.Payload } : {}),
          };
        },
      };
    });
  let pinned: Configuration | undefined;
  let keyRead: Promise<string> | undefined;
  let ports:
    | {
        objects: ReturnType<typeof coverLetterProviderTransitionPort>;
        work: CoverLetterProviderControlClient;
        capture: CoverLetterResponseCaptureClient;
      }
    | undefined;
  const enabled = () => {
    try {
      const current = configuration(environment());
      return current !== undefined && JSON.stringify(current) === JSON.stringify(pinned);
    } catch {
      return false;
    }
  };
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterProviderOutput> => {
    let input: CoverLetterProviderInput;
    try {
      if (!validateCoverLetterProviderInput(raw)) throw new CoverLetterProviderTransportError();
      input = structuredClone(raw);
    } catch {
      throw new CoverLetterProviderTransportError();
    }
    const unavailable: CoverLetterProviderOutput = {
      schemaVersion: 1,
      documentId: input.documentId,
      outcome: "in_progress",
    };
    try {
      const env = environment();
      const config = configuration(env);
      if (
        !config ||
        config.target !== context?.invokedFunctionArn ||
        (pinned && JSON.stringify(config) !== JSON.stringify(pinned))
      )
        return unavailable;
      pinned = config;
      // Extension owns its managed cache/rotation. Coalesce concurrent read-only setup, but do
      // not retain an API key across completed invocations or retry any external actor effect.
      if (!keyRead)
        keyRead = resolve({ secretId: config.secretId, sessionToken: env.AWS_SESSION_TOKEN ?? "" });
      const startup = keyRead;
      let apiKey: string;
      try {
        apiKey = await startup;
      } finally {
        if (keyRead === startup) keyRead = undefined;
      }
      if (!validProviderKey(apiKey) || !enabled()) return unavailable;
      if (!ports) {
        const settings = {
          region: "us-east-2" as const,
          maxAttempts: 1 as const,
          ignoreConfiguredEndpointUrls: true as const,
        };
        const objects = new S3CoverLetterProviderObjects(
          config.bucket,
          config.kmsKeyArn,
          createObjects(settings),
        );
        const client = createLambda(settings);
        ports = {
          objects: coverLetterProviderTransitionPort(objects),
          work: new CoverLetterProviderControlClient(config.control, client, enabled),
          capture: new CoverLetterResponseCaptureClient(config.capture, client, enabled),
        };
      }
      const provider = new OpenAiLunaProvider({
        enabled,
        backgroundEnabled: enabled,
        apiKey: () => apiKey,
        ...(options.modelFetch ? { fetch: options.modelFetch } : {}),
      });
      const gateway = new ModelGateway(provider, {
        enabled,
        ...(options.clock ? { clock: options.clock } : {}),
      });
      return await createCoverLetterIsolatedProviderHandler({
        objects: ports.objects,
        work: ports.work,
        responseCapture: ports.capture,
        gateway,
        enabled,
        ...(options.clock ? { clock: options.clock } : {}),
      })(input);
    } catch {
      return unavailable;
    }
  };
}

export const handler = createCoverLetterIsolatedProviderLambda();
