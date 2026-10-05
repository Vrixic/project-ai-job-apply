import {
  TemporaryMaterialCompletionError,
  type TemporaryMaterialCompletionOutput,
  type TemporaryMaterialOriginalCompletionStore,
  temporaryMaterialCompletionVersion,
  validateTemporaryMaterialCompletionInput,
  validateTemporaryMaterialCompletionOutput,
} from "./temporary-material-completion-contract.js";

/** Exact target matching is not caller authentication. Restrict the numeric version to the
 * original generator role before composition. No content, work issuance or settlement port. */
export function createTemporaryMaterialCompletionHandler(options: {
  functionArn: string;
  store: TemporaryMaterialOriginalCompletionStore;
  enabled?: () => boolean;
}) {
  temporaryMaterialCompletionVersion(options.functionArn);
  const enabled = options.enabled ?? (() => false);
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<TemporaryMaterialCompletionOutput> => {
    if (!validateTemporaryMaterialCompletionInput(raw))
      throw new TemporaryMaterialCompletionError();
    const input = structuredClone(raw);
    const unavailable: TemporaryMaterialCompletionOutput = { ...input, outcome: "unavailable" };
    try {
      if (!enabled() || context?.invokedFunctionArn !== options.functionArn) return unavailable;
      // Await the original SQL commit; a local deadline is never settlement evidence.
      const outcome = await options.store.claimOriginalCompletion(
        structuredClone(input.work),
        structuredClone(input.material),
      );
      const output = { ...input, outcome };
      return enabled() && validateTemporaryMaterialCompletionOutput(output) ? output : unavailable;
    } catch {
      return unavailable;
    }
  };
}
