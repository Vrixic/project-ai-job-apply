import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import {
  CoverLetterResponseDisposalError,
  type CoverLetterResponseDisposalInput,
  type CoverLetterResponseDisposalOutput,
  validateResponseDisposalInput,
  validateResponseDisposalOutput,
} from "./cover-letter-response-disposal-contract.js";
import type { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";

/** Documents-owned inventory/positive-receipt boundary only. Target binding is not caller
 * authentication. Reviewed maintenance-only IAM is required before runtime composition.
 * No reserve/capture, provider call, settlement, renewal, finalization or purge capability.
 */
export function createCoverLetterResponseDisposalHandler(options: {
  functionArn: string;
  responses: Pick<PostgresCoverLetterResponseStore, "read" | "recordDisposal">;
  enabled?: () => boolean;
}) {
  providerControlVersion(options.functionArn);
  const target = options.functionArn;
  const enabled = options.enabled ?? (() => false);
  const responses = options.responses;
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterResponseDisposalOutput> => {
    let input: CoverLetterResponseDisposalInput;
    try {
      if (!validateResponseDisposalInput(raw)) throw new CoverLetterResponseDisposalError();
      input = structuredClone(raw);
    } catch {
      throw new CoverLetterResponseDisposalError();
    }
    const unavailable: CoverLetterResponseDisposalOutput =
      input.action === "read"
        ? { ...input, outcome: "unavailable", inventory: null }
        : { ...input, outcome: "unavailable" };
    try {
      if (!enabled() || context.invokedFunctionArn !== target) return unavailable;
      if (input.action === "read") {
        const inventory = await responses.read(structuredClone(input.reference));
        const output = { ...input, outcome: "read" as const, inventory };
        if (!enabled() || !validateResponseDisposalOutput(output)) return unavailable;
        return structuredClone(output);
      }
      // Await original receipt persistence. A lost ACK is unresolved; replay may read durable
      // disposal, but this handler never retries effects or settles a private writer.
      await responses.recordDisposal(
        structuredClone(input.reference),
        structuredClone(input.cleanup),
      );
      return enabled() ? { ...input, outcome: "recorded" } : unavailable;
    } catch {
      return unavailable;
    }
  };
}
