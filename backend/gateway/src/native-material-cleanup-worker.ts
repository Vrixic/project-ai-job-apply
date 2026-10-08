import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import { nativeMaterialDisposalFromEnvironment } from "./native-material-disposal-runtime.js";

const unavailable = () => Error("NativeMaterialCleanupWorkerUnavailable");
type Runtime = Pick<
  NonNullable<ReturnType<typeof nativeMaterialDisposalFromEnvironment>>,
  "runOwnerCleanup" | "close"
>;
/** Private numeric Lambda invocation with identifier-free scheduled input. Invocation authority
 * is IAM, not payload fields. One queue lease per invocation; crashes recover after lease expiry. */
export function createNativeMaterialCleanupWorker(
  options: {
    environment?: () => NodeJS.ProcessEnv;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: (url: string, environment: NodeJS.ProcessEnv) => Runtime | undefined;
  } = {},
) {
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    let runtime: Runtime | undefined;
    try {
      const env = (options.environment ?? (() => process.env))();
      const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
      if (
        env.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED !== "true" ||
        env.NATIVE_APPLICATION_DISPOSAL_ENABLED !== "true" ||
        env.AWS_REGION !== "us-east-2" ||
        !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
        !/^[1-9][0-9]{0,8}$/u.test(env.AWS_LAMBDA_FUNCTION_VERSION ?? "") ||
        context?.invokedFunctionArn !== target ||
        !env.AWS_SESSION_TOKEN ||
        env.DATABASE_URL !== undefined ||
        !new RegExp(
          `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
          "u",
        ).test(env.DATABASE_SECRET_ID ?? "")
      )
        throw unavailable();
      if (
        !raw ||
        typeof raw !== "object" ||
        Object.getPrototypeOf(raw) !== Object.prototype ||
        Reflect.ownKeys(raw).length !== 2 ||
        !["schemaVersion", "action"].every((key) => {
          const d = Object.getOwnPropertyDescriptor(raw, key);
          return (
            d?.enumerable && "value" in d && d.value === (key === "schemaVersion" ? 1 : "drain")
          );
        })
      )
        throw unavailable();
      const url = await (options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl)(
        { DATABASE_SECRET_ID: env.DATABASE_SECRET_ID },
        { sessionToken: env.AWS_SESSION_TOKEN },
      );
      runtime = (options.createRuntime ?? nativeMaterialDisposalFromEnvironment)(url, env);
      if (!runtime) throw unavailable();
      try {
        return await runtime.runOwnerCleanup();
      } finally {
        await runtime.close();
      }
    } catch {
      throw unavailable();
    }
  };
}
export const handler = createNativeMaterialCleanupWorker();
