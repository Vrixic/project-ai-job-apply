import {
  createApplicationsDatabase,
  PostgresApplicationStore,
  PreparationDispatchError,
} from "@ai-job-apply/applications-service";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  createPreparationReconciler,
  createPreparationTerminalHandler,
  type PreparationRecoveryStore,
  parsePreparationTerminalEvent,
} from "./application-preparation-recovery.js";
import {
  createAwsPreparationNudgePublisher,
  createAwsPreparationStatusReader,
} from "./application-preparation-recovery-aws.js";

type Mode = "terminal" | "reconcile";
type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = {
  target: string;
  durable: string;
  secret: string;
  retained: readonly string[];
  rule?: string;
  queue?: string;
};
const numeric =
  /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,8}$/u;
const base = (arn: string) => arn.slice(0, arn.lastIndexOf(":"));
const unavailable = () => new Error("ApplicationPreparationRecoveryUnavailable");
function configuration(env: Environment, mode: Mode): Configuration | undefined {
  if (
    env.APPLICATION_PREPARATION_RECOVERY_ENABLED !== "true" ||
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
  const account = env.PLATFORM_AWS_ACCOUNT_ID;
  const prefix = `arn:aws:lambda:us-east-2:${account}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const durable = env.APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN;
  const secret = env.DATABASE_SECRET_ID;
  if (
    !numeric.test(target) ||
    !durable?.startsWith(prefix) ||
    !numeric.test(durable) ||
    base(target) === base(durable) ||
    !secret ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${account}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
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
  const config: Configuration = {
    target,
    durable,
    secret,
    retained: Object.freeze([...retained].sort()),
  };
  if (mode === "terminal") {
    if (
      env.APPLICATION_PREPARATION_RECOVERY_RULE_ARN !== undefined ||
      env.APPLICATION_PREPARATION_QUEUE_URL !== undefined ||
      env.APPLICATION_PREPARATION_NUDGES_ENABLED !== undefined
    )
      return;
  } else {
    const rule = env.APPLICATION_PREPARATION_RECOVERY_RULE_ARN;
    const queue = env.APPLICATION_PREPARATION_QUEUE_URL;
    if (
      !rule ||
      !new RegExp(`^arn:aws:events:us-east-2:${account}:rule/[A-Za-z0-9_-]{1,64}$`, "u").test(
        rule,
      ) ||
      !queue ||
      !new RegExp(
        `^https://sqs\\.us-east-2\\.amazonaws\\.com/${account}/[A-Za-z0-9_-]{1,80}$`,
        "u",
      ).test(queue)
    )
      return;
    config.rule = rule;
    config.queue = queue;
  }
  return config;
}
function scheduled(value: unknown, config: Configuration, now: Date) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const keys = [
    "version",
    "id",
    "detail-type",
    "source",
    "account",
    "time",
    "region",
    "resources",
    "detail",
  ];
  if (
    Object.getPrototypeOf(event) !== Object.prototype ||
    Reflect.ownKeys(event).length !== keys.length ||
    !keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(event, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    })
  )
    return false;
  const time = typeof event.time === "string" ? new Date(event.time) : undefined;
  return (
    event.version === "0" &&
    typeof event.id === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(event.id) &&
    event.source === "aws.events" &&
    event["detail-type"] === "Scheduled Event" &&
    event.account === config.target.split(":")[4] &&
    event.region === "us-east-2" &&
    time &&
    Number.isFinite(time.getTime()) &&
    time.toISOString() === event.time &&
    Number.isFinite(now.getTime()) &&
    Math.abs(time.getTime() - now.getTime()) <= 300_000 &&
    Array.isArray(event.resources) &&
    event.resources.length === 1 &&
    Object.getPrototypeOf(event.resources) === Array.prototype &&
    Reflect.ownKeys(event.resources).length === 2 &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(event.resources, "0") ?? {}, "value") &&
    event.resources[0] === config.rule &&
    !!event.detail &&
    typeof event.detail === "object" &&
    Object.getPrototypeOf(event.detail) === Object.prototype &&
    Reflect.ownKeys(event.detail).length === 0
  );
}
type Runtime = { run: (event: unknown) => Promise<unknown>; close: () => Promise<void> };

/** Read-only AWS execution metadata and owning SQL settlement; no durable Invoke or private writer. */
export function createApplicationPreparationRecoveryRuntime(
  url: string,
  config: Configuration,
  mode: Mode,
  enabled: () => boolean,
  nudgesEnabled: () => boolean,
  options: { lambda?: LambdaClient; sqs?: SQSClient; clock?: () => Date } = {},
): Runtime {
  const sql = createApplicationsDatabase(url, { maxConnections: 1 });
  const applications = new PostgresApplicationStore(sql, options.clock);
  const lambda =
    options.lambda ??
    new LambdaClient({ region: "us-east-2", maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  const sqs =
    mode === "reconcile"
      ? (options.sqs ??
        new SQSClient({ region: "us-east-2", maxAttempts: 1, ignoreConfiguredEndpointUrls: true }))
      : undefined;
  const check = () => {
    if (!enabled()) throw new PreparationDispatchError();
  };
  const store: PreparationRecoveryStore = Object.freeze({
    getPreparationDispatch: async (
      ...args: Parameters<typeof applications.getPreparationDispatch>
    ) => {
      check();
      return applications.getPreparationDispatch(...args);
    },
    claimPreparationExecutionsForReconciliation: async (
      ...args: Parameters<typeof applications.claimPreparationExecutionsForReconciliation>
    ) => {
      check();
      return applications.claimPreparationExecutionsForReconciliation(...args);
    },
    settlePreparationExecution: async (
      ...args: Parameters<typeof applications.settlePreparationExecution>
    ) => {
      check();
      return applications.settlePreparationExecution(...args);
    },
    claimPreparationNudges: async (
      ...args: Parameters<typeof applications.claimPreparationNudges>
    ) => {
      check();
      return nudgesEnabled() ? applications.claimPreparationNudges(...args) : [];
    },
  });
  const reader = createAwsPreparationStatusReader(lambda);
  const status = Object.freeze({
    read: async (...args: Parameters<typeof reader.read>) => {
      check();
      if (
        !config.retained.includes(args[0].functionArn) ||
        (await lambda.config.maxAttempts()) !== 1
      )
        throw new PreparationDispatchError();
      check();
      return reader.read(...args);
    },
  });
  const publisher = Object.freeze({
    publish: async (
      ...args: Parameters<ReturnType<typeof createAwsPreparationNudgePublisher>["publish"]>
    ) => {
      check();
      if (!sqs || !config.queue || !nudgesEnabled() || (await sqs.config.maxAttempts()) !== 1)
        throw new PreparationDispatchError();
      check();
      if (!nudgesEnabled()) throw new PreparationDispatchError();
      return createAwsPreparationNudgePublisher(config.queue, sqs).publish(...args);
    },
  });
  const run =
    mode === "terminal"
      ? createPreparationTerminalHandler(config.durable, store, status, options.clock)
      : createPreparationReconciler(store, publisher, status, { dispatchEnabled: true });
  return {
    run,
    close: async () => {
      await sql.end();
      if (!options.lambda) lambda.destroy();
      if (!options.sqs) sqs?.destroy();
    },
  };
}

export function createApplicationPreparationRecoveryLambda(
  mode: Mode,
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createApplicationPreparationRecoveryRuntime;
    clock?: () => Date;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createApplicationPreparationRecoveryRuntime;
  const clock = options.clock ?? (() => new Date());
  let pinned: Configuration | undefined;
  let initialization: Promise<Runtime> | undefined;
  const enabled = () => {
    try {
      return (
        pinned !== undefined &&
        JSON.stringify(configuration(environment(), mode)) === JSON.stringify(pinned)
      );
    } catch {
      return false;
    }
  };
  const nudgesEnabled = () =>
    enabled() && environment().APPLICATION_PREPARATION_NUDGES_ENABLED === "true";
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    let config: Configuration | undefined;
    try {
      config = configuration(environment(), mode);
    } catch {
      throw unavailable();
    }
    if (!config || context?.invokedFunctionArn !== config.target || (pinned && !enabled()))
      throw unavailable();
    let event: unknown;
    try {
      event = raw;
      if (mode === "terminal") {
        const parsed = parsePreparationTerminalEvent(config.durable, event, clock());
        if (!config.retained.includes(parsed.detail.functionArn)) throw Error();
      } else if (!scheduled(event, config, clock())) throw Error();
      event = structuredClone(event);
    } catch {
      throw new Error("ApplicationPreparationRecoveryInputRejected");
    }
    if (!initialization) {
      pinned = config;
      let token: string | undefined;
      try {
        token = environment().AWS_SESSION_TOKEN;
      } catch {
        throw unavailable();
      }
      if (!token) throw unavailable();
      initialization = (async () => {
        const url = await resolve(
          { DATABASE_SECRET_ID: config.secret },
          { sessionToken: token, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
        );
        if (!enabled()) throw unavailable();
        return createRuntime(url, config, mode, enabled, nudgesEnabled, { clock });
      })();
    }
    const startup = initialization;
    let runtime: Runtime;
    try {
      runtime = await startup;
    } catch {
      if (initialization === startup) initialization = undefined;
      throw unavailable();
    }
    if (!enabled()) throw unavailable();
    return runtime.run(event);
  };
}
export const terminalHandler = createApplicationPreparationRecoveryLambda("terminal");
export const reconcileHandler = createApplicationPreparationRecoveryLambda("reconcile");
