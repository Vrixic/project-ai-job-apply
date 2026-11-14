import type { GenerationResult } from "@ai-job-apply/ai-sdk";
import { coverLetterContext } from "@ai-job-apply/ai-sdk/context";
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
  /** Release after the immediate consumer/transport has finished; clears controlled output. */
  release(): void;
  readonly signal: AbortSignal;
  revalidate(): Promise<boolean>;
}
const OUTGOING_CONTENT_BUDGET_BYTES = 512 * 1024;

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
      discardApplication: async (owner: string, application: string) => {
        this.materials.sealApplication(owner, application);
        return "discarded" as const;
      },
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
        signal?: AbortSignal,
      ) => this.preview(scoped(owner, application, reference), signal),
      coverLetterFile: (
        owner: string,
        application: string,
        reference: Readonly<TemporaryMaterialReference>,
        format: "pdf" | "docx",
        signal?: AbortSignal,
      ) => this.file(scoped(owner, application, reference), format, signal),
    });
  }

  async complete(
    identity: Identity,
    generated: GenerationResult,
    completedAtMs: number,
    signal?: AbortSignal,
  ): Promise<{ reference: Readonly<TemporaryMaterialReference>; letter: CoverLetterReadyBinding }> {
    try {
      return await this.completeDraft(identity, generated, completedAtMs, signal);
    } catch {
      throw new TemporaryMaterialUnavailable();
    }
  }

  /** Original actor's cancellation cleanup after a just-published completion. No renewal,
   * terminal application fence or remote-settlement authority. */
  discardCompletion(reference: Readonly<TemporaryMaterialReference>): void {
    this.materials.discard({ ...reference });
  }

  private async completeDraft(
    identity: Identity,
    generated: GenerationResult,
    completedAtMs: number,
    requestSignal?: AbortSignal,
  ): Promise<{ reference: Readonly<TemporaryMaterialReference>; letter: CoverLetterReadyBinding }> {
    this.requireEnabled();
    requestSignal?.throwIfAborted();
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
      const discard = () => admission.discard();
      requestSignal?.addEventListener("abort", discard, { once: true });
      try {
        requestSignal?.throwIfAborted();
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
        requestSignal?.throwIfAborted();
        admission.publish();
        return { reference: admission.reference, letter };
      } catch {
        admission.discard();
        throw new TemporaryMaterialUnavailable();
      } finally {
        requestSignal?.removeEventListener("abort", discard);
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
    requestSignal?: AbortSignal,
  ): Promise<TemporaryCoverLetterResponse<ApplicationCoverLetterPreview>> {
    return this.readResponse(
      reference,
      async (document, signal, fixed) => {
        this.requireContext(
          document,
          await this.source.load(fixed.ownerUserId, fixed.applicationId),
        );
        signal.throwIfAborted();
        return coverLetterPreview(
          document,
          fixed.ownerUserId,
          fixed.applicationId,
          fixed.contentSha256,
        );
      },
      requestSignal,
    );
  }

  async file(
    reference: TemporaryMaterialReference,
    format: "pdf" | "docx",
    requestSignal?: AbortSignal,
  ): Promise<TemporaryCoverLetterResponse<ApplicationCoverLetterFile>> {
    let artifact: ApplicationCoverLetterFile | undefined;
    try {
      return await this.readResponse(
        reference,
        async (document, signal, fixed) => {
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
            return value;
          } finally {
            signal.removeEventListener("abort", discard);
          }
        },
        requestSignal,
      );
    } catch {
      if (artifact) artifact.contentBase64 = "";
      throw new TemporaryMaterialUnavailable();
    }
  }

  private async readResponse<T extends ApplicationCoverLetterPreview | ApplicationCoverLetterFile>(
    reference: TemporaryMaterialReference,
    run: (
      document: CoverLetterDocument,
      signal: AbortSignal,
      fixed: Readonly<TemporaryMaterialReference>,
    ) => Promise<T>,
    requestSignal?: AbortSignal,
  ): Promise<TemporaryCoverLetterResponse<T>> {
    this.requireEnabled();
    if (!validateTemporaryMaterialReference(reference) || reference.kind !== "cover_letter")
      throw new TemporaryMaterialUnavailable();
    const fixed = Object.freeze({ ...reference });
    const lease = this.materials.leaseMaterial(fixed, OUTGOING_CONTENT_BUDGET_BYTES);
    let value: T | undefined;
    let context: Pick<CoverLetterDocument, "jobRevision" | "confirmedFactsHash"> | undefined;
    let released = false;
    const cancel = () => lease.cancel();
    requestSignal?.addEventListener("abort", cancel, { once: true });
    if (requestSignal?.aborted) cancel();
    const release = () => {
      if (released) return;
      released = true;
      lease.signal.removeEventListener("abort", release);
      requestSignal?.removeEventListener("abort", cancel);
      if (value && "contentBase64" in value) value.contentBase64 = "";
      if (value && "paragraphs" in value) {
        for (const paragraph of value.paragraphs) {
          paragraph.text = "";
          paragraph.factIds.length = 0;
        }
        value.paragraphs.length = 0;
      }
      lease.release();
    };
    try {
      value = await this.withDocument(lease.bytes, fixed, lease.signal, (document) => {
        context = {
          jobRevision: document.jobRevision,
          confirmedFactsHash: document.confirmedFactsHash,
        };
        return run(document, lease.signal, fixed);
      });
      this.requireEnabled();
      if (
        !lease.isCurrent() ||
        Buffer.byteLength(JSON.stringify(value), "utf8") + 1024 > OUTGOING_CONTENT_BUDGET_BYTES
      )
        throw new TemporaryMaterialUnavailable();
      lease.signal.addEventListener("abort", release, { once: true });
      if (lease.signal.aborted) {
        release();
        throw new TemporaryMaterialUnavailable();
      }
      const isCurrent = () =>
        !released && this.enabled() && Boolean(this.completion) && lease.isCurrent();
      return {
        reference: fixed,
        value,
        isCurrent,
        signal: lease.signal,
        release,
        revalidate: async () => {
          if (!context || !isCurrent()) return false;
          let evidence: Awaited<ReturnType<CoverLetterEvidenceSource["load"]>>;
          try {
            evidence = await this.source.load(fixed.ownerUserId, fixed.applicationId);
          } catch {
            throw new TemporaryMaterialUnavailable();
          }
          try {
            this.requireContext(context, evidence);
          } catch {
            return false;
          }
          return isCurrent();
        },
      };
    } catch {
      release();
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
    document: Pick<CoverLetterDocument, "jobRevision" | "confirmedFactsHash">,
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
