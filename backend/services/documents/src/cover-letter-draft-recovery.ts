import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import { coverLetterReadyBinding, finalizeCoverLetterDraft } from "./cover-letter-finalize.js";
import type {
  CoverLetterEvidenceSource,
  CoverLetterGenerationOutcome,
  CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import type { CoverLetterProviderRecovery } from "./cover-letter-provider-recovery.js";
import type { PostgresCoverLetterStore } from "./cover-letter-store.js";

export type CoverLetterDraftRecoveryStore = Pick<
  PostgresCoverLetterStore,
  "generationMetadata" | "recover" | "complete" | "withGenerationLease"
>;

/** Private database activity. Recovery has no model, Invoke, reservation or provider write port. */
export class CoverLetterDraftRecoveryService {
  constructor(
    private readonly store: CoverLetterDraftRecoveryStore,
    private readonly source: CoverLetterEvidenceSource,
    private readonly provider: Pick<CoverLetterProviderRecovery, "recover">,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async recover(input: CoverLetterPreparationIdentity): Promise<CoverLetterGenerationOutcome> {
    const identity = structuredClone(input);
    const approved = identity.approvedAt.getTime();
    const expires = identity.expiresAt.getTime();
    const now = this.clock().getTime();
    if (
      identity.noticeVersion !== COVER_LETTER_DISCLOSURE_VERSION ||
      !Number.isFinite(approved) ||
      !Number.isFinite(expires) ||
      !Number.isFinite(now) ||
      expires !== approved + 15 * 60_000 ||
      now < approved
    )
      return { kind: "failed", errorCode: "disclosure_expired" };
    const storedIdentity = {
      id: identity.id,
      ownerUserId: identity.ownerUserId,
      applicationId: identity.applicationId,
      jobRevision: identity.jobContextHash,
      confirmedFactsHash: identity.confirmedFactsHash,
    };
    const metadata = await this.store.generationMetadata(storedIdentity);
    if (!metadata) return { kind: "failed", errorCode: "generation_unavailable" };
    const evidence = structuredClone(
      await this.source.load(identity.ownerUserId, identity.applicationId),
    );
    const context = coverLetterContext({ ...evidence, now: this.clock() });
    if (
      context.jobContextHash !== identity.jobContextHash ||
      context.confirmedFactsHash !== identity.confirmedFactsHash
    )
      return { kind: "failed", errorCode: "bindings_changed" };
    if (metadata.status === "ready") {
      const document = await this.store.withGenerationLease(identity.ownerUserId, () =>
        this.store.recover(storedIdentity),
      );
      if (!document) throw new CoverLetterIntegrityError();
      return {
        kind: "ready",
        letter: coverLetterReadyBinding(document, evidence.facts, this.clock()),
      };
    }
    const generated = await this.store.withGenerationLease(identity.ownerUserId, () =>
      this.provider.recover(metadata, identity, { ...evidence, now: this.clock() }),
    );
    if (!generated) return { kind: "in_progress" };
    return finalizeCoverLetterDraft(this.store, metadata, generated, evidence.facts, this.clock);
  }
}
