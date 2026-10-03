import {
  CoverLetterCleanupError,
  type CoverLetterCleanupOutput,
  validateCoverLetterCleanupInput,
} from "./cover-letter-cleanup-contract.js";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

/** Source-only private maintenance capability, separate from the isolated provider. Exact
 * target matching is not caller authentication: reviewed maintenance-only IAM is required
 * before composition. No settlement, renewal, object I/O or deletion capability is supplied.
 */
export function createCoverLetterCleanupHandler(options: {
  functionArn: string;
  work: Pick<PostgresCoverLetterWorkStore, "fenceForCleanup">;
  enabled?: () => boolean;
}) {
  try {
    providerControlVersion(options.functionArn);
  } catch {
    throw new CoverLetterCleanupError();
  }
  const target = options.functionArn;
  const enabled = options.enabled ?? (() => false);
  const work = options.work;
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterCleanupOutput> => {
    if (!validateCoverLetterCleanupInput(raw)) throw new CoverLetterCleanupError();
    const input = structuredClone(raw);
    const unavailable: CoverLetterCleanupOutput = { ...input, outcome: "unavailable" };
    try {
      if (!enabled() || context.invokedFunctionArn !== target) return unavailable;
      // Await the original committed fence, never race it with a caller timeout. A lost
      // response remains unknown; it cannot convert unresolved work into terminal work.
      const outcome = await work.fenceForCleanup(input.reference);
      if (!enabled() || (outcome !== "pending" && outcome !== "ledger_terminal"))
        return unavailable;
      return { ...input, outcome };
    } catch {
      return unavailable;
    }
  };
}
