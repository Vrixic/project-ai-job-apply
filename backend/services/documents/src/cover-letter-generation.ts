import {
  coverLetterContext,
  type GenerationResult,
  generateCoverLetter,
  type JobPromptFacts,
  type ModelGateway,
} from "@ai-job-apply/ai-sdk";
import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
  ApplicationPacketPreparation,
} from "@ai-job-apply/api-contracts";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import { FactGraph, type GraphFact } from "@ai-job-apply/domain";
import {
  type CoverLetterDocument,
  CoverLetterIntegrityError,
  coverLetterFile,
  coverLetterPreview,
  createCoverLetterDocument,
} from "./cover-letter.js";
import type { PostgresCoverLetterStore } from "./cover-letter-store.js";

type FailureCode = NonNullable<ApplicationPacketPreparation["errorCode"]>;
export type CoverLetterGenerationStore = Pick<
  PostgresCoverLetterStore,
  "reserveGeneration" | "complete" | "recover" | "read"
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

  async context(identity: { ownerUserId: string; applicationId: string }) {
    const evidence = await this.source.load(identity.ownerUserId, identity.applicationId);
    return coverLetterContext({ ...evidence, now: this.clock() });
  }

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
    if (generated.status !== "needs_review") {
      const errorCode: FailureCode =
        generated.status === "refused"
          ? "no_confirmed_evidence"
          : generated.status === "rejected"
            ? "grounding_failed"
            : "generation_unavailable";
      return { kind: "failed", errorCode };
    }
    const document = createCoverLetterDocument(
      reservation.metadata,
      generated,
      reservation.metadata.createdAt,
    );
    try {
      // Neither format can be offered unless both production parsers reproduce the saved text.
      await coverLetterFile(
        document,
        identity.ownerUserId,
        identity.applicationId,
        document.contentSha256,
        "pdf",
      );
      await coverLetterFile(
        document,
        identity.ownerUserId,
        identity.applicationId,
        document.contentSha256,
        "docx",
      );
    } catch {
      return { kind: "failed", errorCode: "render_failed" };
    }
    await this.store.complete(document);
    return { kind: "ready", letter: this.ready(document, evidence.facts) };
  }

  async recover(identity: CoverLetterPreparationIdentity): Promise<CoverLetterReadyBinding | null> {
    const document = await this.store.recover(this.storageIdentity(identity));
    if (!document) return null;
    const evidence = await this.source.load(identity.ownerUserId, identity.applicationId);
    return this.ready(document, evidence.facts);
  }

  async binding(
    ownerUserId: string,
    applicationId: string,
    packetHash: string | undefined,
  ): Promise<string | undefined> {
    if (!packetHash) return undefined;
    const document = await this.store.read(ownerUserId, applicationId, packetHash);
    if (!document) return undefined;
    return this.matchesDocument(document, await this.context({ ownerUserId, applicationId }))
      ? document.contentSha256
      : undefined;
  }

  async preview(
    ownerUserId: string,
    applicationId: string,
    packetHash: string | undefined,
  ): Promise<ApplicationCoverLetterPreview> {
    const document = packetHash
      ? await this.store.read(ownerUserId, applicationId, packetHash)
      : null;
    if (!document) return { status: "no_cover_letter", matchesPacket: false };
    const current = this.matchesDocument(
      document,
      await this.context({ ownerUserId, applicationId }),
    );
    return coverLetterPreview(
      document,
      ownerUserId,
      applicationId,
      current ? packetHash : undefined,
    );
  }

  async file(
    ownerUserId: string,
    applicationId: string,
    packetHash: string,
    format: "pdf" | "docx",
  ): Promise<ApplicationCoverLetterFile> {
    const document = await this.store.read(ownerUserId, applicationId, packetHash);
    if (
      !document ||
      !this.matchesDocument(document, await this.context({ ownerUserId, applicationId }))
    )
      throw new CoverLetterIntegrityError();
    return coverLetterFile(document, ownerUserId, applicationId, packetHash, format);
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
  private matchesDocument(
    document: CoverLetterDocument,
    context: { jobContextHash: string; confirmedFactsHash: string },
  ): boolean {
    return this.matches(
      { jobContextHash: document.jobRevision, confirmedFactsHash: document.confirmedFactsHash },
      context,
    );
  }
  private ready(
    document: CoverLetterDocument,
    facts: readonly GraphFact[],
  ): CoverLetterReadyBinding {
    const ids = [...new Set(document.paragraphs.flatMap((paragraph) => paragraph.factIds))].sort();
    const graph = FactGraph.build(facts, this.clock());
    const confidence = ids.reduce((minimum, id) => {
      const usability = graph.usability(id);
      return usability?.usable ? Math.min(minimum, usability.confidence) : 0;
    }, 1);
    return { contentSha256: document.contentSha256, sourceFactIds: ids, confidence };
  }
}
