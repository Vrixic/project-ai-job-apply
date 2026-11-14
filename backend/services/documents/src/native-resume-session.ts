import { createHash } from "node:crypto";
import { claimNativeMaterialProcess } from "./native-material-process.js";
import type { KernelMemoryDeadline } from "./native-memory-session.js";
import { decodeOriginalPdf } from "./original-pdf.js";
import type { PageGeometry } from "./parsing/layout.js";
import {
  type NormalizedResumeDocument,
  parseNormalizedResumeDocument,
} from "./parsing/normalize.js";
import { sourceLinesOf } from "./render/original/index.js";
import { type RenderedDocument, renderTailoredPdf } from "./render/render.js";
import { verifyRenderedResume } from "./render/verify.js";
import { buildResumeAst } from "./resume-ast/build.js";
import type { AstLine } from "./resume-ast/types.js";
import { buildTailoredView, tailoredContentSha256 } from "./resume-tailoring.js";
import type { TailoredSectionView } from "./resume-tailoring-contract.js";
import type { LiveTailor } from "./tailoring/live-tailor.js";
import {
  materializeTailoredResume,
  type RenderBlock,
  type TailoredResume,
  tailorResume,
  verifyTailoredFactuality,
} from "./tailoring/tailor.js";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialCompletionAuthority,
  type TemporaryMaterialReference,
  TemporaryMaterialStore,
  TemporaryMaterialUnavailable,
  validateTemporaryMaterialReference,
} from "./temporary-materials.js";

export interface NativeResumeIdentity {
  generationId: string;
  ownerUserId: string;
  applicationId: string;
  version: number;
  baseDocumentId: string;
  baseVersion: number;
  baseSha256: string;
  jobContextSha256: string;
}
export function nativeResumeJobHash(job: { title: string; description: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: job.title, description: job.description }))
    .digest("hex");
}
/** The most a generated resume file may weigh: the API contract's ceiling for a resume file. */
const MAXIMUM_ARTIFACT_BYTES = 300_000;
interface HeldResume {
  blocks: RenderBlock[];
  /** Page size of the source resume, when its layout is known. */
  page?: PageGeometry;
  /** The candidate's own PDF, base64, when it can be edited in place (already bound to the base hash). */
  original?: string;
  /** Where every source line sits, with its words removed: all the in-place edit needs. */
  sourceLines?: AstLine[];
  sections: TailoredSectionView[];
  matchedTerms: string[];
}
export interface NativeResumeSessionOptions {
  identity: NativeResumeIdentity;
  source: {
    load(identity: Readonly<NativeResumeIdentity>): Promise<{
      document: NormalizedResumeDocument;
      job: { title: string; description: string };
      originalPdfBase64?: string;
    }>;
  };
  /** Authenticated owner admission must cover current packet/base/job and original generation. */
  checkAdmission(identity: Readonly<NativeResumeIdentity>): Promise<void>;
  completion: TemporaryMaterialCompletionAuthority;
  kernel: KernelMemoryDeadline;
  /** ADR-059: a model chooses which of the candidate's own bullets to keep and in what order. It writes no text and its
   * answer passes the same factuality gate; any refusal or failure falls back to the deterministic tailor. */
  liveTailor?: LiveTailor;
  enabled?: () => boolean;
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
}
const unavailable = () => new TemporaryMaterialUnavailable();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
const identityKeys = [
  "generationId",
  "ownerUserId",
  "applicationId",
  "version",
  "baseDocumentId",
  "baseVersion",
  "baseSha256",
  "jobContextSha256",
] as const;
function captureIdentity(input: NativeResumeIdentity): Readonly<NativeResumeIdentity> {
  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== identityKeys.length
  )
    throw unavailable();
  for (const key of identityKeys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !("value" in d)) throw unavailable();
  }
  const fixed = Object.freeze({ ...input });
  if (
    ![fixed.generationId, fixed.ownerUserId, fixed.applicationId, fixed.baseDocumentId].every(
      (id) => typeof id === "string" && uuid.test(id),
    ) ||
    ![fixed.version, fixed.baseVersion].every(
      (v) => Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647,
    ) ||
    ![fixed.baseSha256, fixed.jobContextSha256].every(
      (v) => typeof v === "string" && digest.test(v),
    )
  )
    throw unavailable();
  return fixed;
}
/** Renders what is held: the candidate's own PDF edited in place when it is held, else the redraw. */
async function renderHeld(value: HeldResume): Promise<RenderedDocument> {
  const original = value.original
    ? Uint8Array.from(Buffer.from(value.original, "base64"))
    : undefined;
  try {
    return await renderTailoredPdf(
      value.blocks,
      value.page,
      original && value.sourceLines
        ? {
            bytes: original,
            sourceLines: value.sourceLines,
            maximumBytes: MAXIMUM_ARTIFACT_BYTES,
          }
        : undefined,
    );
  } finally {
    original?.fill(0);
  }
}
function clear(value: HeldResume): void {
  delete value.original;
  for (const line of value.sourceLines ?? []) for (const run of line.runs) run.text = "";
  value.sourceLines?.splice(0);
  delete value.sourceLines;
  for (const block of value.blocks) {
    block.text = "";
    // The source lines carry the same words, run by run.
    for (const line of block.lines ?? []) for (const run of line.runs) run.text = "";
    delete block.lines;
  }
  value.blocks.length = 0;
  for (const section of value.sections) {
    delete section.heading;
    for (const entry of section.entries) {
      entry.lines.fill("");
      for (const bullet of entry.bullets) {
        bullet.text = "";
        bullet.matchedTerms?.fill("");
      }
      entry.lines.length = 0;
      entry.bullets.length = 0;
    }
    section.entries.length = 0;
  }
  value.sections.length = 0;
  value.matchedTerms.fill("");
  value.matchedTerms.length = 0;
}

/** Dedicated Linux original deterministic generation, not a shared Lambda or regenerating read.
 * Trusted launcher must load the real kernel before passing source/admission/completion ports.
 * This creates no listener, work grant, provider, SQL/object capability or death acknowledgement. */
export function createNativeResumeSession(options: NativeResumeSessionOptions) {
  const enabled = options.enabled ?? (() => false);
  if (!enabled()) throw unavailable();
  const identity = captureIdentity(options.identity);
  const lifetime = options.maximumLifetimeMs ?? GENERATED_MATERIAL_LIFETIME_MS;
  const boot = options.bootBudgetMs ?? 50_000;
  if (
    !Number.isSafeInteger(lifetime) ||
    lifetime < 1 ||
    lifetime > GENERATED_MATERIAL_LIFETIME_MS ||
    !Number.isSafeInteger(boot) ||
    boot < 1 ||
    boot > 50_000
  )
    throw unavailable();
  claimNativeMaterialProcess();
  const kernel = options.kernel,
    load = options.source.load.bind(options.source),
    admit = options.checkAdmission,
    claimCompletion = options.completion.claimOriginalCompletion.bind(options.completion);
  kernel.shortenBoot(boot);
  const memory = new TemporaryMaterialStore({ maximumEntries: 1 });
  let started = false;
  let reference: Readonly<TemporaryMaterialReference> | undefined;
  const check = async (signal?: AbortSignal) => {
    try {
      if (!enabled()) throw unavailable();
      signal?.throwIfAborted();
      await admit(identity);
      if (!enabled()) throw unavailable();
      signal?.throwIfAborted();
    } catch {
      throw unavailable();
    }
  };
  const terminate = (): never => {
    memory.dispose();
    return kernel.terminate();
  };
  const requireReference = (input: TemporaryMaterialReference) => {
    // The owning store validates exact original metadata and both clocks on every lease.
    if (!reference || input.generationId !== identity.generationId) throw unavailable();
    return memory.leaseMaterial(input, 512 * 1024);
  };
  return Object.freeze({
    async generate(signal?: AbortSignal) {
      if (started || !enabled()) throw unavailable();
      started = true;
      let held: HeldResume | undefined, bytes: Uint8Array | undefined;
      try {
        await check(signal);
        const loaded = structuredClone(await load(identity));
        await check(signal);
        const document = parseNormalizedResumeDocument(loaded.document);
        if (
          document.documentId !== identity.baseDocumentId ||
          document.version !== identity.baseVersion ||
          document.sourceSha256 !== identity.baseSha256 ||
          nativeResumeJobHash(loaded.job) !== identity.jobContextSha256 ||
          loaded.job.title.length < 1 ||
          loaded.job.title.length > 300 ||
          loaded.job.description.length > 60_000
        )
          throw unavailable();
        const ast = buildResumeAst(document);
        let tailored: TailoredResume | undefined;
        if (options.liveTailor && enabled()) {
          try {
            tailored = await options.liveTailor(ast, loaded.job);
          } catch {
            tailored = undefined;
          }
          // The model call can outlast admission; losing it ends this process like any other lost check.
          await check(signal);
          if (tailored && verifyTailoredFactuality(ast, tailored).length) tailored = undefined;
        }
        tailored ??= tailorResume(ast, loaded.job);
        if (verifyTailoredFactuality(ast, tailored).length) throw unavailable();
        // The candidate's own PDF is used only when it is exactly the file the base document was
        // parsed from and the page layout is known; otherwise the resume is drawn from its layout.
        const ownPdf = ast.page
          ? decodeOriginalPdf(loaded.originalPdfBase64, document.sourceSha256)
          : undefined;
        ownPdf?.fill(0);
        held = {
          blocks: materializeTailoredResume(ast, tailored),
          ...(ast.page ? { page: ast.page } : {}),
          ...(ownPdf && loaded.originalPdfBase64
            ? {
                original: loaded.originalPdfBase64,
                sourceLines: sourceLinesOf(ast).map((line) => ({
                  ...line,
                  runs: line.runs.map((run) => ({ ...run, text: "" })),
                })),
              }
            : {}),
          sections: buildTailoredView(ast, tailored),
          matchedTerms: [...tailored.matchedTerms],
        };
        const hash = tailoredContentSha256(
          { sha256: identity.baseSha256 },
          tailored.tailoringVersion,
          held.blocks,
        );
        const completedAtMs = Date.now();
        // Bind synchronously before serialization, private acknowledgements or rendering awaits.
        kernel.bindCompletion(completedAtMs, lifetime);
        const original: TemporaryMaterialReference = {
          schemaVersion: 1,
          kind: "tailored_resume",
          generationId: identity.generationId,
          ownerUserId: identity.ownerUserId,
          applicationId: identity.applicationId,
          version: identity.version,
          contentSha256: hash,
          completedAtMs,
          expiresAtMs: completedAtMs + GENERATED_MATERIAL_LIFETIME_MS,
        };
        bytes = new TextEncoder().encode(JSON.stringify(held));
        const admission = memory.stage(original, bytes);
        bytes.fill(0);
        const discard = () => admission.discard();
        signal?.addEventListener("abort", discard, { once: true });
        try {
          if ((await claimCompletion(admission.reference)) !== "claimed") throw unavailable();
          await check(signal);
          await admission.verify(async (borrowed, leaseSignal) => {
            const value = JSON.parse(new TextDecoder().decode(borrowed)) as HeldResume;
            try {
              // Generated resumes are delivered only as PDF, so only the PDF is verified.
              const artifact = await renderHeld(value);
              try {
                if (
                  artifact.bytes.byteLength > MAXIMUM_ARTIFACT_BYTES ||
                  !(await verifyRenderedResume(artifact, value.blocks)).ok
                )
                  throw unavailable();
                await check(signal);
                leaseSignal.throwIfAborted();
              } finally {
                artifact.bytes.fill(0);
              }
            } finally {
              clear(value);
            }
          });
          await check(signal);
          admission.publish();
          reference = admission.reference;
          return {
            reference,
            baseDocumentId: identity.baseDocumentId,
            baseVersion: identity.baseVersion,
            tailoringVersion: tailored.tailoringVersion,
          };
        } finally {
          signal?.removeEventListener("abort", discard);
        }
      } catch {
        return terminate();
      } finally {
        bytes?.fill(0);
        if (held) clear(held);
      }
    },
    async read(input: TemporaryMaterialReference, format: "preview" | "pdf", signal?: AbortSignal) {
      if (!["preview", "pdf"].includes(format)) throw unavailable();
      if (!validateTemporaryMaterialReference(input)) throw unavailable();
      const fixed = { ...input };
      await check(signal);
      const lease = requireReference(fixed);
      let held: HeldResume | undefined, artifactBytes: Uint8Array | undefined;
      const release = () => {
        artifactBytes?.fill(0);
        if (held) clear(held);
        lease.release();
      };
      const cancel = () => release();
      signal?.addEventListener("abort", cancel, { once: true });
      lease.signal.addEventListener("abort", cancel, { once: true });
      try {
        const captured = JSON.parse(new TextDecoder().decode(lease.bytes)) as HeldResume;
        held = captured;
        const value =
          format === "preview"
            ? { sections: held.sections, matchedTerms: held.matchedTerms }
            : await (async () => {
                const artifact = await renderHeld(captured);
                artifactBytes = artifact.bytes;
                if (
                  artifactBytes.byteLength > MAXIMUM_ARTIFACT_BYTES ||
                  !(await verifyRenderedResume(artifact, captured.blocks)).ok
                )
                  throw unavailable();
                return {
                  bytes: artifactBytes,
                  mediaType: "application/pdf" as const,
                  sha256: artifact.sha256,
                };
              })();
        await check(signal);
        if (!lease.isCurrent()) throw unavailable();
        return Object.freeze({
          reference: lease.reference,
          value,
          signal: lease.signal,
          isCurrent: lease.isCurrent,
          release: () => {
            signal?.removeEventListener("abort", cancel);
            release();
          },
          revalidate: async () => {
            try {
              await check(signal);
              return lease.isCurrent();
            } catch {
              return false;
            }
          },
        });
      } catch {
        signal?.removeEventListener("abort", cancel);
        release();
        throw unavailable();
      }
    },
    terminate,
  });
}
