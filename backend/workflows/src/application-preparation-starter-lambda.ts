import {
  createApplicationsDatabase,
  PostgresApplicationStore,
  PreparationDispatchError,
} from "@ai-job-apply/applications-service";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { LambdaClient } from "@aws-sdk/client-lambda";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { validateApplicationPreparationDurableInput } from "./application-preparation-contract.js";
import { createPreparationStarter } from "./application-preparation-dispatch.js";
import { createAwsPreparationExecutionStarter } from "./application-preparation-dispatch-aws.js";
import { createPreparationSqsHandler } from "./application-preparation-recovery-aws.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = {
  target: string;
  durable: string;
  queue: string;
  secret: string;
  retained: readonly string[];
  intake: boolean;
};
const numeric =
  /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,8}$/u;
const base = (arn: string) => arn.slice(0, arn.lastIndexOf(":"));
function configuration(env: Environment): Configuration | undefined {
  if (
    env.APPLICATION_PREPARATION_STARTER_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
      "CANDIDATE_DOCUMENT_BUCKET",
      "PLATFORM_KMS_KEY_ARN",
      "COVER_LETTER_PROVIDER_FUNCTION_ARN",
    ].some((key) => env[key] !== undefined)
  )
    return;
  const prefix = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const durable = env.APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN;
  const queue = env.APPLICATION_PREPARATION_QUEUE_ARN;
  const secret = env.DATABASE_SECRET_ID;
  if (
    !numeric.test(target) ||
    !durable?.startsWith(prefix) ||
    !numeric.test(durable) ||
    base(target) === base(durable) ||
    !queue ||
    !new RegExp(
      `^arn:aws:sqs:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:[A-Za-z0-9_-]{1,80}$`,
      "u",
    ).test(queue) ||
    !secret ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secret)
  )
    return;
  const raw = env.APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS;
  const retained: unknown = raw === undefined ? [durable] : JSON.parse(raw);
  if (
    !Array.isArray(retained) ||
    retained.length < 1 ||
    retained.length > 20 ||
    new Set(retained).size !== retained.length ||
    !retained.includes(durable) ||
    !retained.every(
      (arn) => typeof arn === "string" && numeric.test(arn) && base(arn) === base(durable),
    ) ||
    (raw !== undefined && JSON.stringify(retained) !== raw)
  )
    return;
  return {
    target,
    durable,
    queue,
    secret,
    retained: Object.freeze([...retained].sort()),
    intake: env.APPLICATION_PREPARATION_INTAKE_ENABLED === "true",
  };
}
type Runtime = { start: (value: unknown) => Promise<void>; close: () => Promise<void> };

/** Applications owns the original dispatch claim; no model, object or terminal authority. */
export function createApplicationPreparationStarterRuntime(
  url: string,
  config: Configuration,
  enabled: () => boolean,
  options: { client?: LambdaClient; clock?: () => Date } = {},
): Runtime {
  const sql = createApplicationsDatabase(url, { maxConnections: 1 });
  const applications = new PostgresApplicationStore(sql, options.clock);
  const lambda =
    options.client ??
    new LambdaClient({ region: "us-east-2", maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  const execution = createAwsPreparationExecutionStarter(lambda);
  const start = createPreparationStarter(
    config.durable,
    Object.freeze({
      claimPreparationDispatch: async (
        ...args: Parameters<typeof applications.claimPreparationDispatch>
      ) => {
        if (!enabled()) throw new PreparationDispatchError();
        return applications.claimPreparationDispatch(args[0], args[1], args[2], {
          allowUnbound: config.intake,
          retained: config.retained,
        });
      },
      // A positively acknowledged original dispatch may finish its owning receipt after withdrawal.
      markPreparationStarted: applications.markPreparationStarted.bind(applications),
    }),
    Object.freeze({
      start: async (input: Parameters<typeof execution.start>[0]) => {
        if (!enabled() || !config.retained.includes(input.functionArn))
          throw new PreparationDispatchError();
        if ((await lambda.config.maxAttempts()) !== 1 || !enabled())
          throw new PreparationDispatchError();
        return execution.start(input);
      },
    }),
  );
  return {
    start,
    close: async () => {
      await sql.end();
      if (!options.client) lambda.destroy();
    },
  };
}

/** Lazy, default-off SQS bootstrap. Unavailable work stays failed for retry; no message is dropped. */
export function createApplicationPreparationStarterLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createApplicationPreparationStarterRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createApplicationPreparationStarterRuntime;
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
  ): Promise<SQSBatchResponse> => {
    let event: SQSEvent;
    try {
      const records = (raw as SQSEvent)?.Records;
      if (
        !Array.isArray(records) ||
        records.length > 25 ||
        records.some(
          (record) =>
            typeof record?.messageId !== "string" ||
            !/^[A-Za-z0-9_-]{1,100}$/u.test(record.messageId),
        ) ||
        new Set(records.map((record) => record.messageId)).size !== records.length
      )
        throw Error();
      // Project only fields used by the existing source SQS contract, before any asynchronous work.
      event = {
        Records: records.map((record) => ({
          messageId: record.messageId,
          eventSource: record.eventSource,
          eventSourceARN: record.eventSourceARN,
          body: record.body,
        })),
      } as SQSEvent;
    } catch {
      throw new Error("ApplicationPreparationStarterInputRejected");
    }
    const unavailable = {
      batchItemFailures: event.Records.map((record) => ({ itemIdentifier: record.messageId })),
    };
    try {
      const config = configuration(environment());
      if (!config || context?.invokedFunctionArn !== config.target || (pinned && !same(config)))
        return unavailable;
      let setupFailed = false;
      return await createPreparationSqsHandler(config.queue, async (input) => {
        if (!validateApplicationPreparationDurableInput(input))
          throw new PreparationDispatchError();
        if (setupFailed) throw new PreparationDispatchError();
        if (!initialization) {
          pinned = config;
          const token = environment().AWS_SESSION_TOKEN;
          if (!token) throw new PreparationDispatchError();
          initialization = (async () => {
            const url = await resolve(
              { DATABASE_SECRET_ID: config.secret },
              {
                sessionToken: token,
                requestTimeoutMilliseconds: 3000,
                retryDelaysMilliseconds: [],
              },
            );
            if (!enabled()) throw new PreparationDispatchError();
            return createRuntime(url, config, enabled);
          })();
        }
        const startup = initialization;
        let runtime: Runtime;
        try {
          runtime = await startup;
        } catch {
          setupFailed = true;
          if (initialization === startup) initialization = undefined;
          throw new PreparationDispatchError();
        }
        if (!enabled()) throw new PreparationDispatchError();
        await runtime.start(structuredClone(input));
      })(event);
    } catch {
      return unavailable;
    }
  };
}
export const handler = createApplicationPreparationStarterLambda();
