import { coverLetterContext, type GenerationResult } from "@ai-job-apply/ai-sdk";
import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
} from "@ai-job-apply/api-contracts";
import {
  type CoverLetterDocument,
  coverLetterFile,
  coverLetterPreview,
  createCoverLetterDocument,
  decodeCoverLetterDocument,
  encodeCoverLetterDocument,
} from "./cover-letter.js";
import { coverLetterReadyBinding } from "./cover-letter-finalize.js";
import type {
  CoverLetterEvidenceSource,
  CoverLetterReadyBinding,
} from "./cover-letter-generation.js";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialCompletionAuthority,
  type TemporaryMaterialReference,
  type TemporaryMaterialStore,
  TemporaryMaterialUnavailable,
  validateTemporaryMaterialReference,
} from "./temporary-materials.js";

type Identity = Pick<
  CoverLetterDocument,
  "id" | "ownerUserId" | "applicationId" | "version" | "jobRevision" | "confirmedFactsHash"
>;
export interface TemporaryCoverLetterResponse<T> {
  reference: Readonly<TemporaryMaterialReference>;
  value: T;
  /** Process-local active memory lease check; never serialize this callback. */
  isCurrent(): boolean;
}
type Renderer = (
  document: CoverLetterDocument,
  ownerUserId: string,
  applicationId: string,
  contentSha256: string,
  format: "pdf" | "docx",
  signal: AbortSignal,
) => Promise<ApplicationCoverLetterFile>;

/**
 * Documents' no-persistence replacement for generated draft finalization and reads. Only the
 * original actor may supply its generation-completion timestamp. This service cannot generate,
 * read objects, export saved content, recover a missing draft, issue grants or settle writers.
 * Native/private transport, durable completion metadata, packet admission and approved provider
 * retention still must be composed before activation; content responses require no-store.
 */
export class TemporaryCoverLetterService {
  constructor(
    private readonly materials: TemporaryMaterialStore,
    private readonly source: CoverLetterEvidenceSource,
    private readonly completion: TemporaryMaterialCompletionAuthority | undefined = undefined,
    private readonly enabled: () => boolean = () => false,
    private readonly clock: () => Date = () => new Date(),
    private readonly render: Renderer = coverLetterFile,
  ) {}

  /** Narrow, process-local owner adapter. The Gateway receives no completion/model/persistence
   * capability. Native session transport and its all-copy cleanup remain activation gates. */
  reader() {
    const scoped = (
      ownerUserId: string,
      applicationId: string,
      reference: Readonly<TemporaryMaterialReference>,
    ): TemporaryMaterialReference => {
      if (
        !validateTemporaryMaterialReference(reference) ||
        reference.ownerUserId !== ownerUserId ||
        reference.applicationId !== applicationId ||
        reference.kind !== "cover_letter"
      )
        throw new TemporaryMaterialUnavailable();
      return { ...reference };
    };
    return Object.freeze({
      current: async (
        owner: string,
        application: string,
        reference: Readonly<TemporaryMaterialReference>,
      ) => {
        const fixed = scoped(owner, application, reference);
        this.requireEnabled();
        if (!this.materials.has(fixed)) return null;
        return { ...(await this.binding(fixed)) };
      },
      coverLetterPreview: (
        owner: string,
        application: string,
        reference: Readonly<TemporaryMaterialReference>,
      ) => this.preview(scoped(owner, application, reference)),
      coverLetterFile: (
        owner: string,
        application: string,
        reference: Readonly<TemporaryMaterialReference>,
        format: "pdf" | "docx",
      ) => this.file(scoped(owner, application, reference), format),
    });
  }

  async complete(
    identity: Identity,
    generated: GenerationResult,
    completedAtMs: number,
  ): Promise<{ reference: Readonly<TemporaryMaterialReference>; letter: CoverLetterReadyBinding }> {
    try {
      return await this.completeDraft(identity, generated, completedAtMs);
    } catch {
      throw new TemporaryMaterialUnavailable();
    }
  }

  private async completeDraft(
    identity: Identity,
    generated: GenerationResult,
    completedAtMs: number,
  ): Promise<{ reference: Readonly<TemporaryMaterialReference>; letter: CoverLetterReadyBinding }> {
    this.requireEnabled();
    // No asynchronous evidence read or rendering may move completion time or reset the window.
    const document = createCoverLetterDocument(
      structuredClone(identity),
      structuredClone(generated),
      new Date(completedAtMs),
    );
    const bytes = encodeCoverLetterDocument(document);
    this.clearDocument(document);
    const reference: TemporaryMaterialReference = {
      schemaVersion: 1,
      kind: "cover_letter",
      generationId: identity.id,
      ownerUserId: identity.ownerUserId,
      applicationId: identity.applicationId,
      version: identity.version,
      contentSha256: document.contentSha256,
      completedAtMs,
      expiresAtMs: completedAtMs + GENERATED_MATERIAL_LIFETIME_MS,
    };
    try {
      const admission = this.materials.stage(reference, bytes);
      bytes.fill(0);
      try {
        if ((await this.completion?.claimOriginalCompletion(admission.reference)) !== "claimed")
          throw new TemporaryMaterialUnavailable();
        this.requireEnabled();
        const letter = await admission.verify((borrowed, signal) =>
          this.withDocument(borrowed, reference, signal, async (draft) => {
            const evidence = await this.source.load(reference.ownerUserId, reference.applicationId);
            this.requireEnabled();
            signal.throwIfAborted();
            this.requireContext(draft, evidence);
            const binding = coverLetterReadyBinding(draft, evidence.facts, this.clock());
            if (!binding.sourceFactIds.length || binding.confidence <= 0)
              throw new TemporaryMaterialUnavailable();
            for (const format of ["pdf", "docx"] as const) {
              const artifact = await this.render(
                draft,
                reference.ownerUserId,
                reference.applicationId,
                reference.contentSha256,
                format,
                signal,
              );
              // Validation files are transient and never cached or returned from completion.
              artifact.contentBase64 = "";
              this.requireEnabled();
              signal.throwIfAborted();
            }
            const current = await this.source.load(reference.ownerUserId, reference.applicationId);
            this.requireEnabled();
            signal.throwIfAborted();
            this.requireContext(draft, current);
            return coverLetterReadyBinding(draft, current.facts, this.clock());
          }),
        );
        this.requireEnabled();
        admission.publish();
        return { reference: admission.reference, letter };
      } catch {
        admission.discard();
        throw new TemporaryMaterialUnavailable();
      }
    } catch {
      throw new TemporaryMaterialUnavailable();
    } finally {
      bytes.fill(0);
    }
  }

  async binding(
    reference: TemporaryMaterialReference,
  ): Promise<Readonly<TemporaryMaterialReference>> {
    return this.read(reference, async (document, signal, fixed) => {
      this.requireContext(document, await this.source.load(fixed.ownerUserId, fixed.applicationId));
      signal.throwIfAborted();
      return fixed;
    });
  }

  async preview(
    reference: TemporaryMaterialReference,
  ): Promise<TemporaryCoverLetterResponse<ApplicationCoverLetterPreview>> {
    let preview: ApplicationCoverLetterPreview | undefined;
    try {
      return await this.read(reference, async (document, signal, fixed) => {
        this.requireContext(
          document,
          await this.source.load(fixed.ownerUserId, fixed.applicationId),
        );
        signal.throwIfAborted();
        preview = coverLetterPreview(
          document,
          fixed.ownerUserId,
          fixed.applicationId,
          fixed.contentSha256,
        );
        return {
          reference: fixed,
          value: preview,
          isCurrent: () => this.enabled() && Boolean(this.completion) && this.materials.has(fixed),
        };
      });
    } catch {
      if (preview?.status === "ready") {
        for (const paragraph of preview.paragraphs) {
          paragraph.text = "";
          paragraph.factIds.length = 0;
        }
        preview.paragraphs.length = 0;
      }
      throw new TemporaryMaterialUnavailable();
    }
  }

  async file(
    reference: TemporaryMaterialReference,
    format: "pdf" | "docx",
  ): Promise<TemporaryCoverLetterResponse<ApplicationCoverLetterFile>> {
    let artifact: ApplicationCoverLetterFile | undefined;
    try {
      return await this.read(reference, async (document, signal, fixed) => {
        this.requireContext(
          document,
          await this.source.load(fixed.ownerUserId, fixed.applicationId),
        );
        signal.throwIfAborted();
        const value = await this.render(
          document,
          fixed.ownerUserId,
          fixed.applicationId,
          fixed.contentSha256,
          format,
          signal,
        );
        artifact = value;
        const discard = () => {
          value.contentBase64 = "";
        };
        signal.addEventListener("abort", discard, { once: true });
        try {
          if (signal.aborted) discard();
          signal.throwIfAborted();
          this.requireContext(
            document,
            await this.source.load(fixed.ownerUserId, fixed.applicationId),
          );
          signal.throwIfAborted();
          return {
            reference: fixed,
            value,
            isCurrent: () =>
              this.enabled() && Boolean(this.completion) && this.materials.has(fixed),
          };
        } finally {
          signal.removeEventListener("abort", discard);
        }
      });
    } catch {
      if (artifact) artifact.contentBase64 = "";
      throw new TemporaryMaterialUnavailable();
    }
  }

  private async read<T>(
    reference: TemporaryMaterialReference,
    run: (
      document: CoverLetterDocument,
      signal: AbortSignal,
      reference: Readonly<TemporaryMaterialReference>,
    ) => Promise<T>,
  ): Promise<T> {
    this.requireEnabled();
    // Copy scalar metadata before asynchronous code; a caller cannot switch the generation mid-read.
    if (!validateTemporaryMaterialReference(reference)) throw new TemporaryMaterialUnavailable();
    const fixed = Object.freeze({ ...reference });
    if (fixed.kind !== "cover_letter") throw new TemporaryMaterialUnavailable();
    return this.materials.withMaterial(fixed, (bytes, signal) =>
      this.withDocument(bytes, fixed, signal, async (document) => {
        const result = await run(document, signal, fixed);
        this.requireEnabled();
        return result;
      }),
    );
  }

  private async withDocument<T>(
    bytes: Uint8Array,
    reference: TemporaryMaterialReference,
    signal: AbortSignal,
    run: (document: CoverLetterDocument) => Promise<T>,
  ): Promise<T> {
    const document = decodeCoverLetterDocument(bytes);
    if (
      document.id !== reference.generationId ||
      document.ownerUserId !== reference.ownerUserId ||
      document.applicationId !== reference.applicationId ||
      document.version !== reference.version ||
      document.contentSha256 !== reference.contentSha256 ||
      Date.parse(document.createdAt) !== reference.completedAtMs
    ) {
      this.clearDocument(document);
      throw new TemporaryMaterialUnavailable();
    }
    const discard = () => this.clearDocument(document);
    signal.addEventListener("abort", discard, { once: true });
    try {
      signal.throwIfAborted();
      return await run(document);
    } finally {
      signal.removeEventListener("abort", discard);
      discard();
    }
  }

  private clearDocument(document: CoverLetterDocument): void {
    for (const paragraph of document.paragraphs) {
      paragraph.text = "";
      paragraph.factIds.length = 0;
    }
    document.paragraphs.length = 0;
  }

  private requireContext(
    document: CoverLetterDocument,
    evidence: Awaited<ReturnType<CoverLetterEvidenceSource["load"]>>,
  ): void {
    const context = coverLetterContext({ ...evidence, now: this.clock() });
    if (
      document.jobRevision !== context.jobContextHash ||
      document.confirmedFactsHash !== context.confirmedFactsHash
    )
      throw new TemporaryMaterialUnavailable();
  }

  private requireEnabled(): void {
    if (!this.enabled() || !this.completion) throw new TemporaryMaterialUnavailable();
  }
}
