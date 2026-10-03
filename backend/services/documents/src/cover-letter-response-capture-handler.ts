import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import {
  CoverLetterResponseCaptureError,
  type CoverLetterResponseCaptureInput,
  type CoverLetterResponseCaptureOutput,
  validateResponseCaptureInput,
} from "./cover-letter-response-capture-contract.js";
import type { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";

/** Documents-owned private boundary. Exact target matching is NOT caller authentication.
 * Compose only after reviewed exact-version provider-role IAM. No content, read, disposal,
 * work settlement, renewal, generation or purge capabilities are supplied.
 */
export function createCoverLetterResponseCaptureHandler(options: {
  functionArn: string;
  capture: Pick<PostgresCoverLetterResponseStore, "reserve" | "recordCreation">;
  enabled?: () => boolean;
}) {
  providerControlVersion(options.functionArn);
  const target = options.functionArn;
  const enabled = options.enabled ?? (() => false);
  const capture = options.capture;
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<CoverLetterResponseCaptureOutput> => {
    let input: CoverLetterResponseCaptureInput;
    try {
      if (!validateResponseCaptureInput(raw)) throw new CoverLetterResponseCaptureError();
      input = structuredClone(raw);
    } catch {
      throw new CoverLetterResponseCaptureError();
    }
    const unavailable: CoverLetterResponseCaptureOutput = { ...input, outcome: "unavailable" };
    try {
      if (!enabled() || context.invokedFunctionArn !== target) return unavailable;
      if (input.action === "reserve") {
        // Await the original transaction. Losing its ACK never grants a second dispatch.
        const result = await capture.reserve(structuredClone(input.reference));
        if (!enabled() || (result.kind !== "reserved" && result.kind !== "already_reserved"))
          return unavailable;
        return { ...input, outcome: result.kind };
      }
      // Drain original creation ACK after quarantine/expiry; the store never renews authority.
      await capture.recordCreation(
        structuredClone(input.reference),
        structuredClone(input.response),
      );
      return enabled() ? { ...input, outcome: "recorded" } : unavailable;
    } catch {
      return unavailable;
    }
  };
}
