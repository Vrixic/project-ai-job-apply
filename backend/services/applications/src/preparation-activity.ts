import type {
  GenerationClaim,
  PreparationContext,
  PreparationFailureCode,
  PreparationRecord,
} from "./preparation.js";
import type { PostgresApplicationStore } from "./store.js";

import type { VaultReader } from "./vault.js";

export type PreparationActivityStore = Pick<
  PostgresApplicationStore,
  | "getPreparationForEvent"
  | "getPreparationVaultReferences"
  | "claimPreparationGeneration"
  | "completePreparation"
  | "failPreparation"
>;
export interface ReadyCoverLetter {
  contentSha256: string;
  sourceFactIds: readonly string[];
  confidence: number;
}
export interface CoverLetterPreparationPort {
  /** Loads current owned job/evidence through their APIs, without exposing values to workflow state. */
  context(preparation: PreparationRecord): Promise<PreparationContext>;
  /** May recover only an already-persisted immutable draft, never regenerate it. */
  recover(preparation: PreparationRecord): Promise<ReadyCoverLetter | null>;
  /** Called only by the winner of the write-ahead claim. Consent time is never refreshed. */
  generate(
    preparation: PreparationRecord,
  ): Promise<
    | { kind: "ready"; letter: ReadyCoverLetter }
    | { kind: "in_progress" }
    | { kind: "failed"; errorCode: PreparationFailureCode }
  >;
}
export interface PreparationActivityResult {
  preparationId: string;
  outcome: "completed" | "retryable_failure";
  /** Fixed transport code, never candidate text or a provider exception. */
  errorCode?: "generation_in_progress" | "context_unavailable" | "artifact_unavailable";
}

/**
 * I/O activity, not durable orchestration. Only opaque identity/outcome leaves this function.
 * Repeated workflow delivery can recover a saved draft or poll the original claimant; it never
 * makes a second model call. Terminal compensation is owned by the durable workflow.
 */
export function createPreparationActivity(
  store: PreparationActivityStore,
  documents: CoverLetterPreparationPort,
  vault?: Pick<VaultReader, "readCurrentReference">,
) {
  return async (eventId: string, preparationId: string): Promise<PreparationActivityResult> => {
    const completed: PreparationActivityResult = { preparationId, outcome: "completed" };
    const target = await store.getPreparationForEvent(eventId, preparationId);
    if (target.state === "succeeded" || target.state === "failed") return completed;
    async function currentContext(preparation: PreparationRecord): Promise<PreparationContext> {
      const references = await store.getPreparationVaultReferences(eventId, preparationId);
      const vaultReferences: NonNullable<PreparationContext["vaultReferences"]>[number][] = [];
      if (references.length && !vault) throw new Error("SavedAnswerContextUnavailable");
      for (const reference of references) {
        if (!vault) throw new Error("SavedAnswerContextUnavailable");
        const current = await vault.readCurrentReference(preparation.ownerUserId, reference);
        if (current) vaultReferences.push(current);
      }
      const context = await documents.context(preparation);
      return { ...context, ...(references.length ? { vaultReferences } : {}) };
    }
    let context: PreparationContext;
    try {
      context = await currentContext(target);
    } catch {
      return { preparationId, outcome: "retryable_failure", errorCode: "context_unavailable" };
    }
    const claim: GenerationClaim = await store.claimPreparationGeneration(
      eventId,
      preparationId,
      context,
    );
    if (claim.kind === "terminal") return completed;
    let letter: ReadyCoverLetter;
    try {
      if (claim.kind === "already_claimed") {
        const recovered = await documents.recover(claim.preparation);
        if (!recovered)
          return {
            preparationId,
            outcome: "retryable_failure",
            errorCode: "generation_in_progress",
          };
        letter = recovered;
      } else {
        const generated = await documents.generate(claim.preparation);
        if (generated.kind === "in_progress")
          return {
            preparationId,
            outcome: "retryable_failure",
            errorCode: "generation_in_progress",
          };
        if (generated.kind === "failed") {
          await store.failPreparation(eventId, preparationId, generated.errorCode);
          return completed;
        }
        letter = generated.letter;
      }
    } catch {
      if (claim.kind === "already_claimed")
        return { preparationId, outcome: "retryable_failure", errorCode: "artifact_unavailable" };
      // Even an ambiguous provider error is terminal. A fresh explicit request, not replay, is
      // the only way to ask for a new draft after this operation fails.
      await store.failPreparation(eventId, preparationId, "generation_unavailable");
      return completed;
    }
    letter = {
      contentSha256: letter.contentSha256,
      confidence: letter.confidence,
      sourceFactIds: [...letter.sourceFactIds],
    };
    try {
      context = await currentContext(claim.preparation);
    } catch {
      return { preparationId, outcome: "retryable_failure", errorCode: "context_unavailable" };
    }
    await store.completePreparation(eventId, preparationId, context, letter);
    return completed;
  };
}
