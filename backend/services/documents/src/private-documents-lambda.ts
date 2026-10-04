import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import {
  CoverLetterProviderControlError,
  providerControlVersion,
} from "./cover-letter-provider-control-contract.js";

export type PrivateDocumentsEnvironment = Readonly<Record<string, string | undefined>>;
type Configuration = { target: string; secretId: string };
type Context = { invokedFunctionArn: string };

function configuration(env: PrivateDocumentsEnvironment, flag: string): Configuration | undefined {
  if (
    env[flag] !== "true" ||
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

/** Internal trusted composition only. No caller authentication or quiescence proof.
 * Entry-specific validators and capability factories never come from invocation input.
 */
export function createPrivateDocumentsLambda<Input, Output>(options: {
  flag: string;
  validateInput: (raw: unknown) => raw is Input;
  invalidInput: () => Error;
  unavailable: (input: Input) => Output;
  createControl: (
    url: string,
    functionArn: string,
    enabled: () => boolean,
  ) => (input: Input, context: Context) => Promise<Output>;
  environment?: (() => PrivateDocumentsEnvironment) | undefined;
  resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl | undefined;
}) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  let pinned: Configuration | undefined;
  let initialization: Promise<ReturnType<typeof options.createControl>> | undefined;
  const enabled = () => {
    try {
      const current = configuration(environment(), options.flag);
      return (
        current !== undefined &&
        current.target === pinned?.target &&
        current.secretId === pinned.secretId
      );
    } catch {
      return false;
    }
  };
  return async (raw: unknown, context: Context): Promise<Output> => {
    let input: Input;
    try {
      if (!options.validateInput(raw)) throw options.invalidInput();
      input = structuredClone(raw);
    } catch {
      throw options.invalidInput();
    }
    const unavailable = options.unavailable(input);
    try {
      const env = environment();
      const config = configuration(env, options.flag);
      const invokedFunctionArn = context?.invokedFunctionArn;
      if (!config || invokedFunctionArn !== config.target) return unavailable;
      if (pinned && (pinned.target !== config.target || pinned.secretId !== config.secretId))
        return unavailable;
      if (!initialization) {
        const sessionToken = env.AWS_SESSION_TOKEN;
        if (typeof sessionToken !== "string" || !sessionToken) return unavailable;
        pinned = config;
        // Single-flight read-only setup, not effect retries or local timeout settlement.
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
          return options.createControl(url, config.target, enabled);
        })();
      }
      const startup = initialization;
      let control: ReturnType<typeof options.createControl>;
      try {
        control = await startup;
      } catch {
        // Retry only failed read-only setup on a later call; a stale waiter cannot clear new setup.
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
