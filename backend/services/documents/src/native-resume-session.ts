import { createHash } from "node:crypto";
import { claimNativeMaterialProcess } from "./native-material-process.js";
import type { KernelMemoryDeadline } from "./native-memory-session.js";
import {
  type NormalizedResumeDocument,
  parseNormalizedResumeDocument,
} from "./parsing/normalize.js";
import { renderPdf } from "./render/render.js";
import { verifyRenderedResume } from "./render/verify.js";
import { buildResumeAst } from "./resume-ast/build.js";
import { buildTailoredView, tailoredContentSha256 } from "./resume-tailoring.js";
import type { TailoredSectionView } from "./resume-tailoring-contract.js";
import {
  materializeTailoredResume,
  type RenderBlock,
  TAILORING_VERSION,
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
interface HeldResume {
  blocks: RenderBlock[];
  sections: TailoredSectionView[];
  matchedTerms: string[];
}
export interface NativeResumeSessionOptions {
  identity: NativeResumeIdentity;
  source: {
    load(identity: Readonly<NativeResumeIdentity>): Promise<{
      document: NormalizedResumeDocument;
      job: { title: string; description: string };
    }>;
  };
  /** Authenticated owner admission must cover current packet/base/job and original generation. */
  checkAdmission(identity: Readonly<NativeResumeIdentity>): Promise<void>;
  completion: TemporaryMaterialCompletionAuthority;
  kernel: KernelMemoryDeadline;
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
function clear(value: HeldResume): void {
  for (const block of value.blocks) block.text = "";
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
        const ast = buildResumeAst(document),
          tailored = tailorResume(ast, loaded.job);
        if (verifyTailoredFactuality(ast, tailored).length) throw unavailable();
        held = {
          blocks: materializeTailoredResume(ast, tailored),
          sections: buildTailoredView(ast, tailored),
          matchedTerms: [...tailored.matchedTerms],
        };
        const hash = tailoredContentSha256(
          { sha256: identity.baseSha256 },
          TAILORING_VERSION,
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
              const artifact = renderPdf(value.blocks);
              try {
                if (
                  artifact.bytes.byteLength > 300_000 ||
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
            tailoringVersion: TAILORING_VERSION,
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
                const artifact = renderPdf(captured.blocks);
                artifactBytes = artifact.bytes;
                if (
                  artifactBytes.byteLength > 300_000 ||
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
