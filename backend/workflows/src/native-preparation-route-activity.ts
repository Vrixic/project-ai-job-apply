import { isDeepStrictEqual } from "node:util";
import {
  type CoverLetterPreparationPort,
  createPreparationActivity,
  type PreparationActivityStore,
  type VaultReader,
} from "@ai-job-apply/applications-service";
import type { PostgresNativeMaterialLocationStore } from "@ai-job-apply/documents-service/native-material-location-store";
import {
  type NativePreparationRouteInput,
  type NativePreparationRouteOriginal,
  type NativePreparationRouteOutput,
  nativePreparationRouteUnavailable,
  validateNativePreparationRouteInput,
  validateNativePreparationRouteOriginal,
} from "./native-preparation-route-contract.js";

/** Two phases on the original generation claim. Stage never writes a packet; attach recovers
 * the same ready material and reloads current context before the existing atomic completion. */
export function createNativePreparationRouteActivity(options: {
  store: PreparationActivityStore;
  documents: CoverLetterPreparationPort;
  ready: Pick<PostgresNativeMaterialLocationStore, "readBinding">;
  vault?: Pick<VaultReader, "readCurrentReference">;
  enabled?: () => boolean;
}) {
  const enabled = options.enabled ?? (() => false);
  const store = options.store;
  return async (raw: NativePreparationRouteInput): Promise<NativePreparationRouteOutput> => {
    if (!enabled() || !validateNativePreparationRouteInput(raw))
      throw nativePreparationRouteUnavailable();
    const request = structuredClone(raw);
    const output = (
      outcome: NativePreparationRouteOutput["outcome"],
      original: NativePreparationRouteOriginal | null = null,
    ): NativePreparationRouteOutput => ({ schemaVersion: 1, request, outcome, original });
    const check = () => {
      if (!enabled()) throw nativePreparationRouteUnavailable();
    };
    if (request.action === "fail") {
      await store.failPreparation(request.eventId, request.preparationId, "generation_unavailable");
      check();
      return output("terminal");
    }
    let staged: NativePreparationRouteOriginal | null = null;
    let attached = false;
    const deferred: PreparationActivityStore = {
      getPreparationForEvent: store.getPreparationForEvent.bind(store),
      getPreparationVaultReferences: store.getPreparationVaultReferences.bind(store),
      claimPreparationGeneration: store.claimPreparationGeneration.bind(store),
      failPreparation: store.failPreparation.bind(store),
      async completePreparation(eventId, preparationId, context, letter) {
        check();
        const reference = letter.temporaryMaterial;
        if (!reference || reference.generationId !== preparationId)
          throw nativePreparationRouteUnavailable();
        const binding = await options.ready.readBinding(reference);
        check();
        const original = { binding, reference };
        if (!validateNativePreparationRouteOriginal(original))
          throw nativePreparationRouteUnavailable();
        if (request.action === "stage") {
          staged = structuredClone(original);
          return store.getPreparationForEvent(eventId, preparationId);
        }
        if (request.action !== "attach" || !isDeepStrictEqual(original, request.original))
          throw nativePreparationRouteUnavailable();
        const result = await store.completePreparation(eventId, preparationId, context, letter);
        check();
        attached = result.state === "succeeded";
        return result;
      },
    };
    if (request.action === "attach") {
      const target = await store.getPreparationForEvent(request.eventId, request.preparationId);
      check();
      // A lost attachment ACK remains unresolved in the durable lifecycle; no reattachment.
      if (target.state !== "running" || !target.generationClaimedAt) return output("terminal");
    }
    const documents =
      request.action === "attach"
        ? {
            context: options.documents.context.bind(options.documents),
            recover: options.documents.recover.bind(options.documents),
            generate: async () => {
              throw nativePreparationRouteUnavailable();
            },
          }
        : options.documents;
    const result = await createPreparationActivity(
      deferred,
      documents,
      options.vault,
    )(request.eventId, request.preparationId);
    check();
    if (staged) return output("ready", staged);
    if (attached) return output("attached");
    return output(result.outcome === "completed" ? "terminal" : "pending");
  };
}
