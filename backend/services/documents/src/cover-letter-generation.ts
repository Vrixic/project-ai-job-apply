import {
  coverLetterContext,
  type GenerationResult,
  generateCoverLetter,
  type JobPromptFacts,
  type ModelGateway,
} from "@ai-job-apply/ai-sdk";
import type { ApplicationPacketPreparation } from "@ai-job-apply/api-contracts";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import type { GraphFact } from "@ai-job-apply/domain";
import type { CoverLetterDocument } from "./cover-letter.js";
import { coverLetterReadyBinding, finalizeCoverLetterDraft } from "./cover-letter-finalize.js";
import type { PostgresCoverLetterStore } from "./cover-letter-store.js";

type FailureCode = NonNullable<ApplicationPacketPreparation["errorCode"]>;
export type CoverLetterGenerationStore = Pick<
  PostgresCoverLetterStore,
  "reserveGeneration" | "complete" | "recover"
> & {
  withGenerationLease(
    ownerUserId: string,
    run: () => Promise<GenerationResult | null>,
  ): Promise<GenerationResult | null>;
};
export interface CoverLetterEvidenceSource {
  /** Private owner APIs only. No cross-owner table access or caller-supplied candidate facts. */
  load(
    ownerUserId: string,
    applicationId: string,
  ): Promise<{ facts: readonly GraphFact[]; job: JobPromptFacts }>;
}
export interface CoverLetterPreparationIdentity {
  id: string;
  ownerUserId: string;
  applicationId: string;
  jobContextHash: string;
  confirmedFactsHash: string;
  noticeVersion: string;
  approvedAt: Date;
  expiresAt: Date;
}
export interface CoverLetterReadyBinding {
  contentSha256: string;
  sourceFactIds: readonly string[];
  confidence: number;
}
export type CoverLetterGenerationOutcome =
  | { kind: "ready"; letter: CoverLetterReadyBinding }
  | { kind: "in_progress" }
  | { kind: "failed"; errorCode: FailureCode };

/** Private Documents service. Values stay within the activity; only hashes/citations leave it. */
export class CoverLetterGenerationService {
  constructor(
    private readonly store: CoverLetterGenerationStore,
    private readonly source: CoverLetterEvidenceSource,
    private readonly gateway: ModelGateway,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async generate(input: CoverLetterPreparationIdentity): Promise<CoverLetterGenerationOutcome> {
    // Snapshot server-owned consent so asynchronous work cannot renew or mutate it.
    const identity = {
      ...input,
      approvedAt: new Date(input.approvedAt),
      expiresAt: new Date(input.expiresAt),
    };
    if (!this.fresh(identity)) return { kind: "failed", errorCode: "disclosure_expired" };
    const evidence = structuredClone(
      await this.source.load(identity.ownerUserId, identity.applicationId),
    );
    const context = coverLetterContext({ ...evidence, now: this.clock() });
    if (!this.matches(identity, context)) return { kind: "failed", errorCode: "bindings_changed" };
    const reservation = await this.store.reserveGeneration(this.storageIdentity(identity));
    if (reservation.kind === "already_reserved") {
      const recovered = await this.recover(identity);
      return recovered ? { kind: "ready", letter: recovered } : { kind: "in_progress" };
    }
    const generated = await this.store.withGenerationLease(identity.ownerUserId, async () => {
      if (!this.fresh(identity)) return null;
      return generateCoverLetter({
        ...evidence,
        now: this.clock(),
        gateway: this.gateway,
        disclosure: {
          purpose: "cover_letter",
          categories: ["profile_facts", "job_posting"],
          approvedAt: identity.approvedAt,
        },
      });
    });
    if (!generated) return { kind: "failed", errorCode: "disclosure_expired" };
    return finalizeCoverLetterDraft(
      this.store,
      reservation.metadata,
      generated,
      evidence.facts,
      this.clock,
    );
  }

  async recover(identity: CoverLetterPreparationIdentity): Promise<CoverLetterReadyBinding | null> {
    const document = await this.store.recover(this.storageIdentity(identity));
    if (!document) return null;
    const evidence = await this.source.load(identity.ownerUserId, identity.applicationId);
    return this.ready(document, evidence.facts);
  }

  private fresh(identity: CoverLetterPreparationIdentity): boolean {
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
  }
  private storageIdentity(identity: CoverLetterPreparationIdentity) {
    return {
      id: identity.id,
      ownerUserId: identity.ownerUserId,
      applicationId: identity.applicationId,
      jobRevision: identity.jobContextHash,
      confirmedFactsHash: identity.confirmedFactsHash,
    };
  }
  private matches(
    identity: { jobContextHash: string; confirmedFactsHash: string },
    context: { jobContextHash: string; confirmedFactsHash: string },
  ): boolean {
    return (
      identity.jobContextHash === context.jobContextHash &&
      identity.confirmedFactsHash === context.confirmedFactsHash
    );
  }
  private ready(
    document: CoverLetterDocument,
    facts: readonly GraphFact[],
  ): CoverLetterReadyBinding {
    return coverLetterReadyBinding(document, facts, this.clock());
  }
}
