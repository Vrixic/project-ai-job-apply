import {
  CoverLetterProviderControlError,
  type CoverLetterProviderControlOutput,
  providerControlVersion,
  validateProviderControlInput,
  validateProviderControlOutput,
} from "./cover-letter-provider-control-contract.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

/** Private Documents handler. IAM must restrict the exact version to the reviewed provider role
 * before composition. Context target matching is not caller authentication or quiescence proof.
 * The provider may only consume existing work and positively settle its original provider phase.
 */
export function createCoverLetterProviderControlHandler(options: {
  functionArn: string;
  work: Pick<PostgresCoverLetterWorkStore, "claimProviderDispatch" | "settleProviderDispatch">;
  enabled?: () => boolean;
}) {
  providerControlVersion(options.functionArn);
  const target = options.functionArn;
  const enabled = options.enabled ?? (() => false);
  const work = options.work;
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterProviderControlOutput> => {
    if (!validateProviderControlInput(raw)) throw new CoverLetterProviderControlError();
    const input = structuredClone(raw);
    const unavailable: CoverLetterProviderControlOutput = {
      schemaVersion: 1,
      action: input.action,
      documentId: input.documentId,
      outcome: "unavailable",
    };
    try {
      if (!enabled() || context.invokedFunctionArn !== target) return unavailable;
      if (input.action === "claim") {
        // Original committed control is awaited, not raced against a caller deadline.
        const result = await work.claimProviderDispatch({
          documentId: input.documentId,
          requestSha256: input.requestSha256,
          consentExpiresAt: new Date(input.consentExpiresAt),
        });
        if (result.kind !== "claimed" || !enabled()) return unavailable;
        const output: CoverLetterProviderControlOutput = {
          schemaVersion: 1,
          action: "claim",
          documentId: input.documentId,
          outcome: "claimed",
          reference: structuredClone(result.reference),
        };
        if (
          !validateProviderControlOutput(output) ||
          output.reference.requestSha256 !== input.requestSha256
        )
          return unavailable;
        return output;
      }
      await work.settleProviderDispatch(input.reference);
      return {
        schemaVersion: 1,
        action: "settle",
        documentId: input.documentId,
        outcome: "settled",
        reference: structuredClone(input.reference),
      };
    } catch {
      // Never reflect private SQL diagnostics or certify a lost acknowledgement as settled.
      return unavailable;
    }
  };
}
