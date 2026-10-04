import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  CoverLetterProviderControlError,
  type CoverLetterProviderControlOutput,
  providerControlVersion,
  validateProviderControlInput,
} from "./cover-letter-provider-control-contract.js";
import { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

type Work = Parameters<typeof createCoverLetterProviderControlHandler>[0]["work"];
type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = { target: string; secretId: string };

function configuration(env: Environment): Configuration | undefined {
  if (
    env.COVER_LETTER_PROVIDER_CONTROL_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    typeof env.PLATFORM_AWS_ACCOUNT_ID !== "string" ||
    typeof env.AWS_LAMBDA_FUNCTION_NAME !== "string" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    env.DATABASE_URL
  )
    return undefined;
  const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  providerControlVersion(target);
  const secretId = env.DATABASE_SECRET_ID;
  if (
    typeof secretId !== "string" ||
    !secretId.startsWith(
      `arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:`,
    ) ||
    !/^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(secretId)
  )
    return undefined;
  return { target, secretId };
}

/** Source-only private entrypoint. Not built/deployed or caller-authenticated by this module.
 * Reviewed exact-version caller IAM and isolated database/secret permissions remain mandatory.
 * No model, object, renderer, Invoke, issue, renewal, maintenance or purge capability exists here.
 */
export function createCoverLetterProviderControlLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createPool?: (
      url: string,
      options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
    ) => postgres.Sql;
    createWork?: (url: string, enabled: () => boolean) => Work;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createPool = options.createPool ?? postgres;
  const createWork =
    options.createWork ??
    ((url, enabled) => {
      // The ORM helper rewrites timestamp parsers to strings. This raw ledger needs native Dates.
      const client = createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
      const work = new PostgresCoverLetterWorkStore(client, enabled);
      return {
        claimProviderDispatch: work.claimProviderDispatch.bind(work),
        settleProviderDispatch: work.settleProviderDispatch.bind(work),
        settleRejectedProviderDispatch: work.settleRejectedProviderDispatch.bind(work),
        settleUndispatchedProviderDispatch: work.settleUndispatchedProviderDispatch.bind(work),
      };
    });
  let pinned: Configuration | undefined;
  let initialization:
    | Promise<ReturnType<typeof createCoverLetterProviderControlHandler>>
    | undefined;
  const enabled = () => {
    try {
      const current = configuration(environment());
      return (
        current !== undefined &&
        current.target === pinned?.target &&
        current.secretId === pinned.secretId
      );
    } catch {
      return false;
    }
  };
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterProviderControlOutput> => {
    let input: import("./cover-letter-provider-control-contract.js").CoverLetterProviderControlInput;
    try {
      if (!validateProviderControlInput(raw)) throw new CoverLetterProviderControlError();
      input = structuredClone(raw);
    } catch {
      throw new CoverLetterProviderControlError();
    }
    const unavailable: CoverLetterProviderControlOutput = {
      schemaVersion: 1,
      action: input.action,
      documentId: input.documentId,
      outcome: "unavailable",
    };
    try {
      const env = environment();
      const config = configuration(env);
      const invokedFunctionArn = context?.invokedFunctionArn;
      if (!config || invokedFunctionArn !== config.target) return unavailable;
      if (pinned && (pinned.target !== config.target || pinned.secretId !== config.secretId))
        return unavailable;
      if (!initialization) {
        const sessionToken = env.AWS_SESSION_TOKEN;
        if (typeof sessionToken !== "string" || !sessionToken) return unavailable;
        pinned = config;
        // Single-flight bootstrap only; effects are never raced, retried or inferred from timeouts.
        initialization = (async () => {
          const url = await resolve(
            { DATABASE_SECRET_ID: config.secretId },
            {
              sessionToken,
              requestTimeoutMilliseconds: 3_000,
              retryDelaysMilliseconds: [],
            },
          );
          if (!enabled()) throw new CoverLetterProviderControlError();
          const work = createWork(url, enabled);
          return createCoverLetterProviderControlHandler({
            functionArn: config.target,
            work,
            enabled,
          });
        })();
      }
      const startup = initialization;
      let control: ReturnType<typeof createCoverLetterProviderControlHandler>;
      try {
        control = await startup;
      } catch {
        // Failed read-only initialization may retry on a later invocation, never ledger effects.
        if (initialization === startup) initialization = undefined;
        return unavailable;
      }
      if (!enabled()) return unavailable;
      return await control(input, { invokedFunctionArn });
    } catch {
      return unavailable;
    }
  };
}

// Construction is lazy and performs no secret, SQL or cloud I/O at module load.
export const handler = createCoverLetterProviderControlLambda();
