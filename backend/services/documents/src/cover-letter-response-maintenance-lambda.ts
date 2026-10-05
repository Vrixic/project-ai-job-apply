import { OpenAiLunaResponseCleanup } from "@ai-job-apply/ai-sdk";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { CoverLetterCleanupClient } from "./cover-letter-cleanup-client.js";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { CoverLetterResponseDisposalClient } from "./cover-letter-response-disposal-client.js";
import {
  CoverLetterResponseMaintenanceError,
  type CoverLetterResponseMaintenanceOutput,
  validateResponseMaintenanceInput,
} from "./cover-letter-response-maintenance-contract.js";
import {
  createCoverLetterResponseReconciler,
  createCoverLetterSuccessfulResponseReconciler,
} from "./cover-letter-response-reconciliation.js";
import { resolveLambdaProviderKey, validProviderKey } from "./lambda-provider-key.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Configuration = { target: string; disposal: string; fence: string; secretId: string };
type ClientConfiguration = {
  region: "us-east-2";
  maxAttempts: 1;
  ignoreConfiguredEndpointUrls: true;
};

function configuration(env: Environment): Configuration | undefined {
  if (
    env.COVER_LETTER_RESPONSE_MAINTENANCE_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "DATABASE_SECRET_ID",
      "OPENAI_API_KEY",
      "CANDIDATE_DOCUMENT_BUCKET",
      "PLATFORM_KMS_KEY_ARN",
    ].some((key) => env[key] !== undefined)
  )
    return;
  const prefix = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const disposal = env.COVER_LETTER_RESPONSE_DISPOSAL_FUNCTION_ARN;
  const fence = env.COVER_LETTER_CLEANUP_FUNCTION_ARN;
  if (!disposal?.startsWith(prefix) || !fence?.startsWith(prefix)) return;
  for (const arn of [target, disposal, fence]) providerControlVersion(arn);
  if (
    new Set([target, disposal, fence].map((arn) => arn.slice(0, arn.lastIndexOf(":")))).size !== 3
  )
    return;
  const secretId = env.COVER_LETTER_OPENAI_SECRET_ID;
  if (
    !secretId?.startsWith(
      `arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:`,
    ) ||
    !/^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(secretId)
  )
    return;
  return { target, disposal, fence, secretId };
}

/** Source-only internet maintenance actor. Owning private reads establish eligibility before
 * provider-secret access/effects. No SQL, objects, model creation, writer settlement or purge.
 * Exact target checks are not authentication. Reviewed IAM and maintained scheduling remain open.
 */
export function createCoverLetterResponseMaintenanceLambda(
  options: {
    environment?: () => Environment;
    resolveProviderKey?: typeof resolveLambdaProviderKey;
    createLambdaClient?: (configuration: ClientConfiguration) => CoverLetterProviderLambdaClient;
    providerFetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveProviderKey ?? resolveLambdaProviderKey;
  const createClient =
    options.createLambdaClient ??
    ((settings) => {
      const sdk = new LambdaClient(settings);
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
      } satisfies CoverLetterProviderLambdaClient;
    });
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new CoverLetterResponseMaintenanceError();
  let pinned: Configuration | undefined;
  let ports:
    | { responses: CoverLetterResponseDisposalClient; work: CoverLetterCleanupClient }
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
  ): Promise<CoverLetterResponseMaintenanceOutput> => {
    if (!validateResponseMaintenanceInput(raw)) throw new CoverLetterResponseMaintenanceError();
    const input = structuredClone(raw);
    const unresolved: CoverLetterResponseMaintenanceOutput = { ...input, outcome: "unresolved" };
    try {
      const env = environment();
      const config = configuration(env);
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && JSON.stringify(config) !== JSON.stringify(pinned))
      )
        return unresolved;
      pinned = config;
      if (!ports) {
        const client = createClient({
          region: "us-east-2",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
        });
        ports = {
          responses: new CoverLetterResponseDisposalClient(config.disposal, client, enabled),
          work: new CoverLetterCleanupClient(config.fence, client, enabled),
        };
      }
      // Resolve only inside the selected provider capability, after owning eligibility. Keep
      // the key local to this invocation/effect; the extension owns caching and rotation.
      const cleanup = async (
        method: "deleteCompleted" | "stopAndDelete",
        reference: Parameters<OpenAiLunaResponseCleanup["deleteCompleted"]>[0],
        signal: AbortSignal,
      ) => {
        signal.throwIfAborted();
        if (!enabled()) throw Error();
        const key = await resolve({
          secretId: config.secretId,
          sessionToken: env.AWS_SESSION_TOKEN ?? "",
        });
        signal.throwIfAborted();
        if (!validProviderKey(key) || !enabled()) throw Error();
        const provider = new OpenAiLunaResponseCleanup({
          enabled,
          apiKey: () => key,
          ...(options.providerFetch ? { fetch: options.providerFetch } : {}),
        });
        return provider[method](reference, signal);
      };
      const signal = AbortSignal.timeout(timeoutMs);
      const result =
        input.action === "reconcile_completed"
          ? await createCoverLetterSuccessfulResponseReconciler({
              responses: {
                readCompleted: ports.responses.readCompleted.bind(ports.responses),
                recordDisposal: ports.responses.recordDisposal.bind(ports.responses),
              },
              cleanup: { deleteCompleted: (ref, abort) => cleanup("deleteCompleted", ref, abort) },
              enabled,
              timeoutMs,
            })(input.reference, signal)
          : await createCoverLetterResponseReconciler({
              responses: ports.responses,
              work: ports.work,
              cleanup: { stopAndDelete: (ref, abort) => cleanup("stopAndDelete", ref, abort) },
              enabled,
              timeoutMs,
            })(input.reference, signal);
      if (!enabled() || signal.aborted) return unresolved;
      return { ...input, outcome: result.kind };
    } catch {
      return unresolved;
    }
  };
}

export const handler = createCoverLetterResponseMaintenanceLambda();
