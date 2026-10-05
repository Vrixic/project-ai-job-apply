import type { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  createPrivateDocumentsLambda,
  type PrivateDocumentsEnvironment,
} from "./private-documents-lambda.js";
import {
  TemporaryMaterialCompletionError,
  type TemporaryMaterialCompletionInput,
  type TemporaryMaterialCompletionOutput,
  type TemporaryMaterialOriginalCompletionStore,
  validateTemporaryMaterialCompletionInput,
} from "./temporary-material-completion-contract.js";
import { createTemporaryMaterialCompletionHandler } from "./temporary-material-completion-handler.js";
import { PostgresTemporaryMaterialCompletionStore } from "./temporary-material-completion-store.js";

/** Source-only default-off private numeric-version entrypoint. Reviewed sender IAM required.
 * Max-one native-codec SQL pool; no memory, model, renderer, object storage or content transport. */
export function createTemporaryMaterialCompletionLambda(
  options: {
    environment?: () => PrivateDocumentsEnvironment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createPool?: (
      url: string,
      options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
    ) => postgres.Sql;
    createStore?: (url: string, enabled: () => boolean) => TemporaryMaterialOriginalCompletionStore;
  } = {},
) {
  const createPool = options.createPool ?? postgres;
  const createStore =
    options.createStore ??
    ((url, enabled) =>
      new PostgresTemporaryMaterialCompletionStore(
        createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 }),
        enabled,
      ));
  return createPrivateDocumentsLambda<
    TemporaryMaterialCompletionInput,
    TemporaryMaterialCompletionOutput
  >({
    flag: "TEMPORARY_MATERIAL_COMPLETION_ENABLED",
    validateInput: validateTemporaryMaterialCompletionInput,
    invalidInput: () => new TemporaryMaterialCompletionError(),
    unavailable: (input) => ({ ...input, outcome: "unavailable" }),
    createControl: (url, functionArn, enabled) =>
      createTemporaryMaterialCompletionHandler({
        functionArn,
        store: createStore(url, enabled),
        enabled,
      }),
    environment: options.environment,
    resolveDatabaseUrl: options.resolveDatabaseUrl,
  });
}
export const handler = createTemporaryMaterialCompletionLambda();
