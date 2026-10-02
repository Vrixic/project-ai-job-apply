import { coverLetterContext, prepareCoverLetterPrompt } from "@ai-job-apply/ai-sdk";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import type {
  CoverLetterEvidenceSource,
  CoverLetterGenerationOutcome,
  CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import {
  type CoverLetterProviderInput,
  type CoverLetterProviderReference,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  encodeCoverLetterProviderObject,
  validateCoverLetterProviderReference,
} from "./cover-letter-provider-contract.js";
import type { CoverLetterProviderObjects } from "./cover-letter-provider-objects.js";
import type { PostgresCoverLetterStore } from "./cover-letter-store.js";

export type CoverLetterInitializationOutcome =
  | { kind: "initialized"; input: CoverLetterProviderInput }
  | Extract<CoverLetterGenerationOutcome, { kind: "in_progress" | "failed" }>;
export type CoverLetterInitializationObjects = Pick<
  CoverLetterProviderObjects,
  "putIfAbsent" | "find" | "read"
>;

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new CoverLetterIntegrityError());
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Source-only private initializer. No ModelGateway or Invoke capability. Replays never create
 * missing slots, including after partial initialization, retention or deletion. This local bound
 * is not remote-write quiescence; privacy/runtime/IAM prerequisites still block composition.
 */
export class CoverLetterProviderInitializer {
  constructor(
    private readonly store: Pick<
      PostgresCoverLetterStore,
      "reserveGeneration" | "withGenerationLease"
    >,
    private readonly source: CoverLetterEvidenceSource,
    private readonly objects: CoverLetterInitializationObjects,
    private readonly enabled: () => boolean = () => false,
    private readonly clock: () => Date = () => new Date(),
    private readonly timeoutMs = 60_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new CoverLetterIntegrityError();
  }

  async initialize(
    input: CoverLetterPreparationIdentity,
  ): Promise<CoverLetterInitializationOutcome> {
    if (!this.enabled()) return { kind: "failed", errorCode: "generation_unavailable" };
    const identity = structuredClone(input);
    const fresh = () => {
      const approved = identity.approvedAt.getTime();
      const expires = identity.expiresAt.getTime();
      const now = this.clock().getTime();
      return (
        identity.noticeVersion === COVER_LETTER_DISCLOSURE_VERSION &&
        Number.isFinite(approved) &&
        Number.isFinite(expires) &&
        Number.isFinite(now) &&
        expires === approved + 15 * 60_000 &&
        now >= approved &&
        now <= expires
      );
    };
    if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" };
    const deadline = AbortSignal.timeout(this.timeoutMs);
    try {
      const evidence = structuredClone(
        await bounded(this.source.load(identity.ownerUserId, identity.applicationId), deadline),
      );
      const context = coverLetterContext({ ...evidence, now: this.clock() });
      if (
        context.jobContextHash !== identity.jobContextHash ||
        context.confirmedFactsHash !== identity.confirmedFactsHash
      )
        return { kind: "failed", errorCode: "bindings_changed" };
      const prompt = prepareCoverLetterPrompt({ ...evidence, now: this.clock() });
      if (!prompt) return { kind: "failed", errorCode: "no_confirmed_evidence" };
      const requestBytes = encodeCoverLetterProviderObject("request", {
        schemaVersion: 1,
        documentId: identity.id,
        noticeVersion: COVER_LETTER_DISCLOSURE_VERSION,
        promptVersion: "1.0.0",
        ...context,
        approvedAt: identity.approvedAt.toISOString(),
        expiresAt: identity.expiresAt.toISOString(),
        ...prompt,
        maxOutputChars: 8_000,
      });
      if (!this.enabled()) return { kind: "failed", errorCode: "generation_unavailable" };
      if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" };
      deadline.throwIfAborted();
      // Never race/abort this transaction: its committed first-writer result controls creation.
      const reservation = await this.store.reserveGeneration({
        id: identity.id,
        ownerUserId: identity.ownerUserId,
        applicationId: identity.applicationId,
        jobRevision: identity.jobContextHash,
        confirmedFactsHash: identity.confirmedFactsHash,
      });
      if (
        reservation.metadata.id !== identity.id ||
        reservation.metadata.ownerUserId !== identity.ownerUserId ||
        reservation.metadata.applicationId !== identity.applicationId ||
        reservation.metadata.jobRevision !== identity.jobContextHash ||
        reservation.metadata.confirmedFactsHash !== identity.confirmedFactsHash ||
        reservation.metadata.objectKey !== `normalized/${identity.id}/cover-letter.v1.json`
      )
        throw new CoverLetterIntegrityError();
      return await this.store.withGenerationLease(identity.ownerUserId, async () => {
        const hash = coverLetterProviderSha256(requestBytes);
        const read = async (
          slot: CoverLetterProviderSlot,
          reference: CoverLetterProviderReference,
        ) => {
          if (!validateCoverLetterProviderReference(reference, slot))
            throw new CoverLetterIntegrityError();
          const bytes = await bounded(
            this.objects.read(identity.id, slot, { ...reference }, deadline),
            deadline,
          );
          if (
            bytes.length !== reference.sizeBytes ||
            coverLetterProviderSha256(bytes) !== reference.sha256
          )
            throw new CoverLetterIntegrityError();
          return { value: decodeCoverLetterProviderObject(slot, bytes), bytes };
        };
        if (reservation.kind === "claimed") {
          if (reservation.metadata.status !== "pending") throw new CoverLetterIntegrityError();
          // Dispatch is created last, only after positively acknowledged request/result placeholders.
          for (const [slot, bytes] of [
            ["request", requestBytes],
            [
              "result",
              encodeCoverLetterProviderObject("result", {
                schemaVersion: 1,
                documentId: identity.id,
                requestSha256: hash,
                state: "pending",
              }),
            ],
            [
              "dispatch",
              encodeCoverLetterProviderObject("dispatch", {
                schemaVersion: 1,
                documentId: identity.id,
                requestSha256: hash,
                state: "issued",
              }),
            ],
          ] as const) {
            deadline.throwIfAborted();
            if (!this.enabled())
              return { kind: "failed", errorCode: "generation_unavailable" } as const;
            if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" } as const;
            const stored = await bounded(
              this.objects.putIfAbsent(identity.id, slot, bytes, deadline),
              deadline,
            );
            if (!stored.created) return { kind: "in_progress" } as const;
            const pinned = await read(slot, stored.reference);
            if (!Buffer.from(pinned.bytes).equals(Buffer.from(bytes)))
              throw new CoverLetterIntegrityError();
          }
        }
        deadline.throwIfAborted();
        const reference = await bounded(
          this.objects.find(identity.id, "request", deadline),
          deadline,
        );
        if (!reference) return { kind: "in_progress" } as const;
        const request = await read("request", reference);
        if (!Buffer.from(request.bytes).equals(Buffer.from(requestBytes)))
          throw new CoverLetterIntegrityError();
        const dispatchRef = await bounded(
          this.objects.find(identity.id, "dispatch", deadline),
          deadline,
        );
        const resultRef = await bounded(
          this.objects.find(identity.id, "result", deadline),
          deadline,
        );
        if (!dispatchRef || !resultRef) return { kind: "in_progress" } as const;
        const dispatch = (await read("dispatch", dispatchRef)).value;
        const result = (await read("result", resultRef)).value;
        if (
          !("state" in dispatch) ||
          !("state" in result) ||
          dispatch.documentId !== identity.id ||
          result.documentId !== identity.id ||
          dispatch.requestSha256 !== hash ||
          result.requestSha256 !== hash ||
          !["issued", "claimed"].includes(dispatch.state) ||
          !["pending", "ready"].includes(result.state)
        )
          throw new CoverLetterIntegrityError();
        if (dispatch.state === "claimed") {
          const time = Date.parse(dispatch.dispatchedAt);
          if (
            time < identity.approvedAt.getTime() ||
            time > identity.expiresAt.getTime() ||
            time > this.clock().getTime()
          )
            throw new CoverLetterIntegrityError();
        }
        if (
          result.state === "ready" &&
          (dispatch.state !== "claimed" || result.dispatchedAt !== dispatch.dispatchedAt)
        )
          throw new CoverLetterIntegrityError();
        if (!this.enabled())
          return { kind: "failed", errorCode: "generation_unavailable" } as const;
        if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" } as const;
        return {
          kind: "initialized",
          input: { schemaVersion: 1, documentId: identity.id, request: { ...reference } },
        } as const;
      });
    } catch {
      // Committed or ambiguous reservations/writes stay inventoried; replay cannot create again.
      return { kind: "in_progress" };
    }
  }
}
