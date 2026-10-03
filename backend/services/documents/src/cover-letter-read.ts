import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
} from "@ai-job-apply/api-contracts";
import {
  type CoverLetterDocument,
  CoverLetterIntegrityError,
  coverLetterFile,
  coverLetterPreview,
} from "./cover-letter.js";
import type { CoverLetterEvidenceSource } from "./cover-letter-generation.js";

/** Transaction-bound, owner-fixed read capability. No reservation, recovery or write methods. */
export interface CoverLetterOwnedReader {
  read(applicationId: string, contentSha256: string): Promise<CoverLetterDocument | null>;
}
export interface CoverLetterReadStore {
  withReadLease<T>(
    ownerUserId: string,
    run: (reader: CoverLetterOwnedReader) => Promise<T>,
  ): Promise<T>;
}

/** Private saved-document reads. No ModelGateway, Invoke, control ledger or mutation port. */
export class CoverLetterReadService {
  constructor(
    private readonly store: CoverLetterReadStore,
    private readonly source: CoverLetterEvidenceSource,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async context(identity: { ownerUserId: string; applicationId: string }) {
    const { ownerUserId, applicationId } = identity;
    return this.store.withReadLease(ownerUserId, () =>
      this.ownedContext(ownerUserId, applicationId),
    );
  }

  async binding(ownerUserId: string, applicationId: string, packetHash: string | undefined) {
    return this.store.withReadLease(ownerUserId, async (reader) => {
      if (!packetHash) return undefined;
      const document = await reader.read(applicationId, packetHash);
      if (!document) return undefined;
      return this.matches(document, await this.ownedContext(ownerUserId, applicationId))
        ? document.contentSha256
        : undefined;
    });
  }

  async preview(
    ownerUserId: string,
    applicationId: string,
    packetHash: string | undefined,
  ): Promise<ApplicationCoverLetterPreview> {
    return this.store.withReadLease(ownerUserId, async (reader) => {
      const document = packetHash ? await reader.read(applicationId, packetHash) : null;
      if (!document) return { status: "no_cover_letter", matchesPacket: false };
      const current = this.matches(document, await this.ownedContext(ownerUserId, applicationId));
      return coverLetterPreview(
        document,
        ownerUserId,
        applicationId,
        current ? packetHash : undefined,
      );
    });
  }

  async file(
    ownerUserId: string,
    applicationId: string,
    packetHash: string,
    format: "pdf" | "docx",
  ): Promise<ApplicationCoverLetterFile> {
    return this.store.withReadLease(ownerUserId, async (reader) => {
      const document = await reader.read(applicationId, packetHash);
      if (!document || !this.matches(document, await this.ownedContext(ownerUserId, applicationId)))
        throw new CoverLetterIntegrityError();
      return coverLetterFile(document, ownerUserId, applicationId, packetHash, format);
    });
  }

  private async ownedContext(ownerUserId: string, applicationId: string) {
    const evidence = await this.source.load(ownerUserId, applicationId);
    return coverLetterContext({ ...evidence, now: this.clock() });
  }

  private matches(
    document: CoverLetterDocument,
    context: { jobContextHash: string; confirmedFactsHash: string },
  ) {
    return (
      document.jobRevision === context.jobContextHash &&
      document.confirmedFactsHash === context.confirmedFactsHash
    );
  }
}
