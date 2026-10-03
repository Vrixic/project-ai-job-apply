import type { ModelGateway } from "@ai-job-apply/ai-sdk";
import {
  type CoverLetterProviderInput,
  type CoverLetterProviderOutput,
  type CoverLetterProviderReference,
  type CoverLetterProviderSlot,
  CoverLetterProviderTransportError,
  coverLetterProviderSha256,
  coverLetterProviderTimestamp,
  decodeCoverLetterProviderObject,
  encodeCoverLetterProviderObject,
  validateCoverLetterProviderInput,
  validateCoverLetterProviderModel,
  validateCoverLetterProviderReference,
} from "./cover-letter-provider-contract.js";
import type { CoverLetterProviderTransitionObjects } from "./cover-letter-provider-objects.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new CoverLetterProviderTransportError());
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Source-only isolated provider factory. No database, renderer, client bootstrap or credentials.
 * It cannot create objects. Runtime/IAM and bounded privacy quiescence must precede composition.
 */
export function createCoverLetterIsolatedProviderHandler(options: {
  objects: CoverLetterProviderTransitionObjects;
  gateway: ModelGateway;
  enabled?: () => boolean;
  clock?: () => Date;
  /** Total local handling bound; cancellation is NOT proof of remote/provider quiescence. */
  timeoutMs?: number;
  /** Private control RPC capability only. Never compose database access in this isolated actor. */
  work?: Pick<PostgresCoverLetterWorkStore, "claimProviderDispatch" | "settleProviderDispatch"> &
    Partial<
      Pick<
        PostgresCoverLetterWorkStore,
        "settleRejectedProviderDispatch" | "settleUndispatchedProviderDispatch"
      >
    >;
}): (input: unknown) => Promise<CoverLetterProviderOutput> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new CoverLetterProviderTransportError();
  const clock = options.clock ?? (() => new Date());
  const enabled = options.enabled ?? (() => false);
  const objects = options.objects;
  return async (raw) => {
    let input: CoverLetterProviderInput;
    try {
      if (!validateCoverLetterProviderInput(raw)) throw new CoverLetterProviderTransportError();
      input = { schemaVersion: 1, documentId: raw.documentId, request: { ...raw.request } };
    } catch {
      throw new CoverLetterProviderTransportError();
    }
    const failed: CoverLetterProviderOutput = {
      schemaVersion: 1,
      documentId: input.documentId,
      outcome: "failed",
    };
    const inProgress: CoverLetterProviderOutput = { ...failed, outcome: "in_progress" };
    let claimAttempted = false;
    try {
      if (
        !enabled() ||
        !options.work ||
        !validateCoverLetterProviderModel(options.gateway.identity)
      )
        return failed;
      const work = options.work;
      const deadline = AbortSignal.timeout(timeoutMs);
      const read = async (
        slot: CoverLetterProviderSlot,
        reference: CoverLetterProviderReference,
      ) => {
        if (!validateCoverLetterProviderReference(reference, slot))
          throw new CoverLetterProviderTransportError();
        const pinned = { ...reference };
        deadline.throwIfAborted();
        const bytes = await bounded(
          objects.read(input.documentId, slot, pinned, deadline),
          deadline,
        );
        if (bytes.length !== pinned.sizeBytes || coverLetterProviderSha256(bytes) !== pinned.sha256)
          throw new CoverLetterProviderTransportError();
        const value = decodeCoverLetterProviderObject(slot, bytes);
        if (value.documentId !== input.documentId) throw new CoverLetterProviderTransportError();
        return value;
      };
      const request = await read("request", input.request);
      if (!("system" in request)) return failed;
      const approved = coverLetterProviderTimestamp(request.approvedAt);
      const expires = coverLetterProviderTimestamp(request.expiresAt);
      if (approved === undefined || expires === undefined) return failed;
      const fresh = (time: Date = clock()) => {
        const now = time.getTime();
        return Number.isFinite(now) && now >= approved && now <= expires;
      };
      const loadSlots = async () => {
        deadline.throwIfAborted();
        const [dispatchRef, resultRef] = await bounded(
          Promise.all([
            objects.find(input.documentId, "dispatch", deadline),
            objects.find(input.documentId, "result", deadline),
          ]),
          deadline,
        );
        if (!dispatchRef || !resultRef) return undefined;
        const dispatchReference = { ...dispatchRef };
        const resultReference = { ...resultRef };
        const [dispatch, result] = await Promise.all([
          read("dispatch", dispatchReference),
          read("result", resultReference),
        ]);
        if (
          !("state" in dispatch) ||
          !("state" in result) ||
          (dispatch.state !== "issued" && dispatch.state !== "claimed") ||
          (result.state !== "pending" && result.state !== "ready") ||
          dispatch.requestSha256 !== input.request.sha256 ||
          result.requestSha256 !== input.request.sha256
        )
          throw new CoverLetterProviderTransportError();
        return {
          dispatch,
          result,
          dispatchReference,
          resultReference,
        };
      };
      const recovered = (
        slots: NonNullable<Awaited<ReturnType<typeof loadSlots>>>,
      ): CoverLetterProviderOutput => {
        if (slots.result.state !== "ready") return inProgress;
        if (slots.dispatch.state !== "claimed") return inProgress;
        const dispatched = coverLetterProviderTimestamp(slots.dispatch.dispatchedAt);
        const now = clock().getTime();
        if (
          dispatched === undefined ||
          !Number.isFinite(now) ||
          dispatched > now ||
          dispatched < approved ||
          dispatched > expires ||
          slots.result.dispatchedAt !== slots.dispatch.dispatchedAt ||
          slots.result.outputCharacters > request.maxOutputChars ||
          slots.result.text.length > request.maxOutputChars
        )
          return failed;
        return {
          schemaVersion: 1,
          documentId: input.documentId,
          outcome: "ready",
          result: slots.resultReference,
        };
      };
      const initial = await loadSlots();
      if (!initial) return failed;
      if (initial.result.state === "ready") return recovered(initial);
      if (initial.dispatch.state === "claimed") return inProgress;
      const dispatchTime = clock();
      if (!enabled() || !fresh(dispatchTime)) return failed;
      const dispatchedAt = dispatchTime.toISOString();
      const claimBytes = encodeCoverLetterProviderObject("dispatch", {
        schemaVersion: 1,
        documentId: input.documentId,
        requestSha256: input.request.sha256,
        state: "claimed",
        dispatchedAt,
      });
      deadline.throwIfAborted();
      claimAttempted = true;
      // Await the original committed control response, not a raced local timeout. The fixed
      // purpose consumes previously issued authority; duplicates can never renew or steal it.
      const authorization = await work.claimProviderDispatch({
        documentId: input.documentId,
        requestSha256: input.request.sha256,
        consentExpiresAt: new Date(request.expiresAt),
      });
      if (authorization.kind !== "claimed") return inProgress;
      const reference = { ...authorization.reference };
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
          reference.id,
        ) ||
        reference.documentId !== input.documentId ||
        reference.purpose !== "provider_dispatch" ||
        reference.requestSha256 !== input.request.sha256
      )
        return inProgress;
      deadline.throwIfAborted();
      if (!enabled() || !fresh()) return inProgress;
      const claim = await bounded(
        objects.transitionIfMatch(
          input.documentId,
          "dispatch",
          initial.dispatchReference,
          claimBytes,
          deadline,
        ),
        deadline,
      );
      if (!claim.changed) {
        const existing = await loadSlots();
        return existing ? recovered(existing) : failed;
      }
      if (
        !validateCoverLetterProviderReference(claim.reference, "dispatch") ||
        claim.reference.sha256 !== coverLetterProviderSha256(claimBytes) ||
        claim.reference.sizeBytes !== claimBytes.length
      )
        return failed;
      // Claim acknowledgement must precede the ONLY model call. No ambiguous claim is retried.
      if (!enabled() || !fresh() || !validateCoverLetterProviderModel(options.gateway.identity))
        return failed;
      deadline.throwIfAborted();
      let completion: Awaited<ReturnType<ModelGateway["generateWithCompletion"]>>;
      try {
        completion = await bounded(
          options.gateway.generateWithCompletion(
            {
              promptId: "cover_letter",
              promptVersion: request.promptVersion,
              purpose: "cover_letter",
              categories: ["profile_facts", "job_posting"],
              system: request.system,
              user: request.user,
            },
            {
              purpose: "cover_letter",
              categories: ["profile_facts", "job_posting"],
              approvedAt: new Date(request.approvedAt),
            },
          ),
          deadline,
        );
      } catch {
        // A local deadline does not establish remote quiescence. A definitive gateway
        // refusal may fail the preparation, but it still never grants another dispatch.
        return deadline.aborted ? inProgress : failed;
      }
      const closeRejectedCompletion = async () => {
        if (!work.settleRejectedProviderDispatch || !enabled()) return inProgress;
        deadline.throwIfAborted();
        await work.settleRejectedProviderDispatch(reference);
        return failed;
      };
      if (completion.kind === "not_dispatched") {
        // Original gateway-local receipt, not a provider-thrown error or replay. The
        // dispatch-slot replacement was positively acknowledged; no result write follows.
        if (
          !validateCoverLetterProviderModel(completion.model) ||
          completion.promptId !== "cover_letter" ||
          completion.promptVersion !== request.promptVersion ||
          ![
            "MODEL_DISABLED",
            "DISCLOSURE_MISSING",
            "DISCLOSURE_PURPOSE_MISMATCH",
            "DISCLOSURE_CATEGORY_MISSING",
            "DISCLOSURE_STALE",
            "INPUT_TOO_LARGE",
          ].includes(completion.code) ||
          !work.settleUndispatchedProviderDispatch ||
          !enabled()
        )
          return inProgress;
        deadline.throwIfAborted();
        await work.settleUndispatchedProviderDispatch(reference);
        return failed;
      }
      if (completion.kind === "completed_rejected") {
        // This branch follows original positive model completion, not a caught error. The
        // original dispatch write was acknowledged and no result write has been attempted.
        if (
          !validateCoverLetterProviderModel(completion.model) ||
          completion.promptId !== "cover_letter" ||
          completion.promptVersion !== request.promptVersion ||
          !Number.isSafeInteger(completion.outputCharacters) ||
          completion.outputCharacters < 0 ||
          !["OUTPUT_TOO_LARGE", "OUTPUT_NOT_JSON"].includes(completion.code)
        )
          return inProgress;
        return await closeRejectedCompletion();
      }
      const output = completion.result;
      const text = JSON.stringify(output.value);
      if (
        !validateCoverLetterProviderModel(output.model) ||
        output.promptId !== "cover_letter" ||
        output.promptVersion !== request.promptVersion ||
        !Number.isSafeInteger(output.outputCharacters) ||
        output.outputCharacters < 0
      )
        return inProgress;
      if (
        typeof text !== "string" ||
        output.outputCharacters > request.maxOutputChars ||
        text.length > request.maxOutputChars
      )
        return await closeRejectedCompletion();
      const resultBytes = encodeCoverLetterProviderObject("result", {
        schemaVersion: 1,
        documentId: input.documentId,
        requestSha256: input.request.sha256,
        state: "ready",
        dispatchedAt,
        text,
        model: output.model,
        outputCharacters: output.outputCharacters,
      });
      deadline.throwIfAborted();
      const saved = await bounded(
        objects.transitionIfMatch(
          input.documentId,
          "result",
          initial.resultReference,
          resultBytes,
          deadline,
        ),
        deadline,
      );
      if (!saved.changed) {
        const existing = await loadSlots();
        return existing ? recovered(existing) : failed;
      }
      if (
        !validateCoverLetterProviderReference(saved.reference, "result") ||
        saved.reference.sha256 !== coverLetterProviderSha256(resultBytes) ||
        saved.reference.sizeBytes !== resultBytes.length
      )
        return failed;
      // Only this original actor observed positive single-attempt dispatch/result write receipts
      // and a completed model response. It will issue no more effects. Replay/object presence,
      // a local deadline, SDK/RPC rejection or late model response never records settlement.
      await work.settleProviderDispatch(reference);
      return {
        schemaVersion: 1,
        documentId: input.documentId,
        outcome: "ready",
        result: { ...saved.reference },
      };
    } catch {
      // Never turn an unacknowledged external write into terminal product truth.
      // Recovery can inspect the original slots; it cannot repeat a model call.
      return claimAttempted ? inProgress : failed;
    }
  };
}
