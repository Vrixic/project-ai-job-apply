import {
  type CoverLetterPreparationPort,
  createPreparationActivity,
  type PreparationActivityStore,
  PreparationNotFoundError,
} from "@ai-job-apply/applications-service";
import {
  type ApplicationPreparationActivityResult,
  validateApplicationPreparationActivityInput,
} from "./application-preparation-contract.js";

const transientStoreCodes = new Set([
  "40001",
  "40P01",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

/** Private I/O handler. Its composition must use an isolated provider port under ADR-016. */
export function createApplicationPreparationActivityHandler(
  store: PreparationActivityStore,
  documents: CoverLetterPreparationPort,
) {
  const advance = createPreparationActivity(store, documents);
  return async (event: unknown): Promise<ApplicationPreparationActivityResult> => {
    if (!validateApplicationPreparationActivityInput(event))
      throw new Error("ApplicationPreparationActivityInputRejected");
    const base = {
      schemaVersion: 1 as const,
      action: event.action,
      preparationId: event.preparationId,
    };
    try {
      if (event.action === "fail") {
        await store.failPreparation(event.eventId, event.preparationId, "generation_unavailable");
        return { ...base, outcome: "completed" };
      }
      const result = await advance(event.eventId, event.preparationId);
      if (result.outcome === "completed") return { ...base, outcome: "completed" };
      return {
        ...base,
        outcome: "retryable_failure",
        errorCode: result.errorCode ?? "store_unavailable",
      };
    } catch (error) {
      if (error instanceof PreparationNotFoundError)
        return { ...base, outcome: "non_retryable_failure", errorCode: "preparation_missing" };
      const code =
        error && typeof error === "object"
          ? Object.getOwnPropertyDescriptor(error, "code")?.value
          : undefined;
      if (code === "42501")
        return { ...base, outcome: "non_retryable_failure", errorCode: "candidate_inactive" };
      if (typeof code === "string" && transientStoreCodes.has(code))
        return { ...base, outcome: "retryable_failure", errorCode: "store_unavailable" };
      return { ...base, outcome: "non_retryable_failure", errorCode: "activity_failed" };
    }
  };
}
