import postgres from "postgres";
import { resolveLambdaDatabaseUrl } from "./lambda-database-url.js";
import { PostgresPrivilegedModerationAuditStore } from "./privileged-moderation-audit.js";

type Environment = Readonly<Record<string, string | undefined>>;
interface Configuration {
  target: string;
  secretId: string;
  limit: number;
}
const unavailable = () => Error("PrivilegedModerationAuditRetentionUnavailable");
function configuration(env: Environment): Configuration | undefined {
  if (
    env.PRIVILEGED_MODERATION_AUDIT_RETENTION_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !/^[1-9][0-9]{0,9}$/u.test(env.AWS_LAMBDA_FUNCTION_VERSION ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    env.DATABASE_URL !== undefined
  )
    return;
  const secretId = env.DATABASE_SECRET_ID;
  const batch = env.PRIVILEGED_MODERATION_AUDIT_RETENTION_BATCH_LIMIT ?? "100";
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId) ||
    !/^[1-9][0-9]{0,3}$/u.test(batch) ||
    Number(batch) > 1_000
  )
    return;
  return {
    target: `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`,
    secretId,
    limit: Number(batch),
  };
}
function validInput(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype)
    return false;
  if (Reflect.ownKeys(raw).length !== 2) return false;
  const version = Object.getOwnPropertyDescriptor(raw, "schemaVersion");
  const action = Object.getOwnPropertyDescriptor(raw, "action");
  return !!(
    version?.enumerable &&
    "value" in version &&
    version.value === 1 &&
    action?.enumerable &&
    "value" in action &&
    action.value === "expire"
  );
}

/** Dedicated owner pool and expiry-only facade. No writer or row reader is exposed. */
export function createPrivilegedModerationAuditRetentionRuntime(
  url: string,
  enabled: () => boolean,
) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: 10_000 },
    onnotice: () => undefined,
  });
  const store = new PostgresPrivilegedModerationAuditStore(sql, enabled);
  return Object.freeze({ expire: store.expire.bind(store), close: () => sql.end() });
}

/** Private numeric-version Lambda; reviewed IAM supplies invocation authority, not event fields.
 * Each invocation owns and closes its pool. Configuration changes refuse a warm instance. */
export function createPrivilegedModerationAuditRetentionLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createPrivilegedModerationAuditRetentionRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createPrivilegedModerationAuditRetentionRuntime;
  let pinned: Configuration | undefined;
  let active = false;
  const enabled = () => {
    try {
      const current = configuration(environment());
      return current !== undefined && JSON.stringify(current) === JSON.stringify(pinned);
    } catch {
      return false;
    }
  };
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    let runtime: ReturnType<typeof createRuntime> | undefined;
    let expired: number | undefined;
    let failed = false;
    // A rejected concurrent call must not release the owning invocation's guard.
    if (active) throw unavailable();
    active = true;
    try {
      if (!validInput(raw)) throw unavailable();
      const env = environment();
      const config = configuration(env);
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && JSON.stringify(config) !== JSON.stringify(pinned))
      )
        throw unavailable();
      const sessionToken = env.AWS_SESSION_TOKEN;
      if (!sessionToken) throw unavailable();
      pinned ??= Object.freeze(config);
      const url = await resolve(
        { DATABASE_SECRET_ID: config.secretId },
        {
          sessionToken,
          requestTimeoutMilliseconds: 3_000,
          retryDelaysMilliseconds: [],
        },
      );
      if (!enabled()) throw unavailable();
      runtime = createRuntime(url, enabled);
      const count = await runtime.expire(config.limit);
      if (!enabled() || !Number.isInteger(count) || count < 0 || count > config.limit)
        throw unavailable();
      expired = count;
    } catch {
      failed = true;
    } finally {
      try {
        await runtime?.close();
      } catch {
        failed = true;
      } finally {
        active = false;
      }
    }
    if (failed || expired === undefined || !enabled()) throw unavailable();
    return { schemaVersion: 1, owner: "profile", privilegedModerationAuditExpired: expired };
  };
}
export const handler = createPrivilegedModerationAuditRetentionLambda();
