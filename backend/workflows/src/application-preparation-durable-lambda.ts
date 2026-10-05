import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import { createApplicationPreparationDurableHandler } from "./application-preparation-durable.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = { target: string; activity: string };
const unavailable = () => new Error("ApplicationPreparationWorkflowUnavailable");

function configuration(env: Environment): Configuration | undefined {
  if (
    env.APPLICATION_PREPARATION_DURABLE_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    [
      "DATABASE_URL",
      "DATABASE_SECRET_ID",
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
  const activity = env.APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN;
  const numeric =
    /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,8}$/u;
  if (
    !activity?.startsWith(prefix) ||
    !numeric.test(target) ||
    !numeric.test(activity) ||
    target.slice(0, target.lastIndexOf(":")) === activity.slice(0, activity.lastIndexOf(":"))
  )
    return;
  return { target, activity };
}

/** Configuration and kill-switch qualification stay outside deterministic SDK workflow code.
 * Exact numeric matching is not caller authentication or remote-writer stopping evidence.
 * No SQL, secret, object, model, dispatcher or terminal-recovery capability is composed here.
 */
export function createNativeApplicationPreparationDurableHandler(
  options: { environment?: () => Environment } = {},
): DurableLambdaHandler {
  const environment = options.environment ?? (() => process.env);
  let pinned: Configuration | undefined;
  let runtime: DurableLambdaHandler | undefined;
  return async (event, context) => {
    let config: Configuration | undefined;
    try {
      config = configuration(environment());
    } catch {
      throw unavailable();
    }
    if (
      !config ||
      context?.invokedFunctionArn !== config.target ||
      (pinned && (pinned.target !== config.target || pinned.activity !== config.activity))
    )
      throw unavailable();
    if (!runtime) {
      pinned = config;
      runtime = createApplicationPreparationDurableHandler(config.activity);
    }
    // Delegate the original SDK control envelope unchanged; its workflow validates the strict
    // identifier-only application payload. Never wrap SDK continuation/checkpoint exceptions.
    return runtime(event, context);
  };
}
export const handler = createNativeApplicationPreparationDurableHandler();
