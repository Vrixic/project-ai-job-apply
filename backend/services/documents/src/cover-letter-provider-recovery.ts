import {
  type CoverLetterGroundingContext,
  coverLetterContext,
  type GenerationResult,
  groundCoverLetterOutput,
  prepareCoverLetterPrompt,
} from "@ai-job-apply/ai-sdk";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import type { CoverLetterPreparationIdentity } from "./cover-letter-generation.js";
import {
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  validateCoverLetterProviderReference,
} from "./cover-letter-provider-contract.js";
import type { CoverLetterProviderObjects } from "./cover-letter-provider-objects.js";
import type { CoverLetterMetadata } from "./cover-letter-store.js";

export type CoverLetterProviderReadObjects = Pick<CoverLetterProviderObjects, "find" | "read">;

/**
 * Private Documents recovery only. Metadata must come from an active-candidate, owner-scoped SQL
 * reservation/read, never an invocation or client. This reader grants no dispatch or write rights.
 */
export class CoverLetterProviderRecovery {
  constructor(private readonly objects: CoverLetterProviderReadObjects) {}

  async recover(
    metadata: CoverLetterMetadata,
    input: CoverLetterPreparationIdentity,
    evidence: CoverLetterGroundingContext,
  ): Promise<GenerationResult | null> {
    // Snapshot trusted inputs across asynchronous reads; callers cannot renew original consent.
    const row = structuredClone(metadata);
    const identity = structuredClone(input);
    const context = structuredClone(evidence);
    try {
      if (
        row.status !== "pending" ||
        row.id !== identity.id ||
        row.ownerUserId !== identity.ownerUserId ||
        row.applicationId !== identity.applicationId ||
        row.jobRevision !== identity.jobContextHash ||
        row.confirmedFactsHash !== identity.confirmedFactsHash ||
        row.objectKey !== `normalized/${row.id}/cover-letter.v1.json`
      )
        throw new CoverLetterIntegrityError();
      const current = coverLetterContext(context);
      if (
        current.jobContextHash !== row.jobRevision ||
        current.confirmedFactsHash !== row.confirmedFactsHash
      )
        throw new CoverLetterIntegrityError();
      const request = await this.read(row.id, "request");
      if (!request) return null;
      if (!("system" in request.value)) throw new CoverLetterIntegrityError();
      const prompt = prepareCoverLetterPrompt(context);
      const approved = identity.approvedAt.getTime();
      const expires = identity.expiresAt.getTime();
      const now = context.now.getTime();
      if (
        !prompt ||
        !Number.isFinite(approved) ||
        !Number.isFinite(expires) ||
        !Number.isFinite(now) ||
        expires !== approved + 15 * 60_000 ||
        request.value.documentId !== row.id ||
        request.value.noticeVersion !== identity.noticeVersion ||
        request.value.approvedAt !== identity.approvedAt.toISOString() ||
        request.value.expiresAt !== identity.expiresAt.toISOString() ||
        request.value.jobContextHash !== row.jobRevision ||
        request.value.confirmedFactsHash !== row.confirmedFactsHash ||
        request.value.system !== prompt.system ||
        request.value.user !== prompt.user
      )
        throw new CoverLetterIntegrityError();
      const dispatch = await this.read(row.id, "dispatch");
      const result = await this.read(row.id, "result");
      if (!dispatch || !result) return null;
      if (
        !("state" in dispatch.value) ||
        !("state" in result.value) ||
        dispatch.value.documentId !== row.id ||
        result.value.documentId !== row.id ||
        dispatch.value.requestSha256 !== request.sha256 ||
        result.value.requestSha256 !== request.sha256
      )
        throw new CoverLetterIntegrityError();
      if (result.value.state === "pending") {
        if (dispatch.value.state !== "issued" && dispatch.value.state !== "claimed")
          throw new CoverLetterIntegrityError();
        return null;
      }
      if (dispatch.value.state !== "claimed" || result.value.state !== "ready")
        throw new CoverLetterIntegrityError();
      const dispatched = Date.parse(dispatch.value.dispatchedAt);
      if (
        dispatched < approved ||
        dispatched > expires ||
        dispatched > now ||
        result.value.dispatchedAt !== dispatch.value.dispatchedAt ||
        result.value.outputCharacters > request.value.maxOutputChars ||
        result.value.text.length > request.value.maxOutputChars
      )
        throw new CoverLetterIntegrityError();
      return groundCoverLetterOutput(context, {
        value: JSON.parse(result.value.text),
        model: result.value.model,
      });
    } catch {
      // No stored text, raw transport/provider errors, or candidate identity in diagnostics.
      throw new CoverLetterIntegrityError();
    }
  }

  private async read(documentId: string, slot: CoverLetterProviderSlot) {
    const reference = await this.objects.find(documentId, slot);
    if (!reference) return null;
    if (!validateCoverLetterProviderReference(reference, slot))
      throw new CoverLetterIntegrityError();
    const bytes = await this.objects.read(documentId, slot, reference);
    const sha256 = coverLetterProviderSha256(bytes);
    if (bytes.byteLength !== reference.sizeBytes || sha256 !== reference.sha256)
      throw new CoverLetterIntegrityError();
    return { value: decodeCoverLetterProviderObject(slot, bytes), sha256 };
  }
}
