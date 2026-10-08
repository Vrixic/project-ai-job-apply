import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PostgresNativeResumeGenerationStore } from "./native-resume-generation-store.js";
import { nativeOwnerClosed, nativeOwnerJson } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeBootstrap,
  validateNativeResumeBootstrap,
} from "./native-resume-owner-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import type { NormalizedDocumentReader } from "./normalized-document-reader.js";
import type { ParsedResumeSource } from "./parsed-resume-source.js";
import {
  type NormalizedResumeDocument,
  parseNormalizedResumeDocument,
} from "./parsing/normalize.js";

export const nativeResumeSourceUnavailable = () => Error("NativeResumeSourceUnavailable");
export interface NativeResumeSourceValue {
  document: NormalizedResumeDocument;
  job: { title: string; description: string };
}

/** Retained original source only. This validator has no tailoring or rendering capability. */
export function validateNativeResumeSource(
  value: unknown,
  expected: NativeResumeBootstrap,
): value is NativeResumeSourceValue {
  try {
    if (
      !nativeOwnerClosed(value, ["document", "job"]) ||
      !nativeOwnerClosed(value.job, ["title", "description"]) ||
      typeof value.job.title !== "string" ||
      value.job.title.length < 1 ||
      value.job.title.length > 300 ||
      typeof value.job.description !== "string" ||
      value.job.description.length > 60_000 ||
      !nativeOwnerClosed(value.document, [
        "documentId",
        "version",
        "parserVersion",
        "mediaType",
        "sourceSha256",
        "blocks",
        "createdAt",
      ]) ||
      Buffer.byteLength(nativeOwnerJson(value)) > 2_000_000
    )
      return false;
    const document = parseNormalizedResumeDocument(value.document);
    if (
      !document.blocks.every((b) =>
        nativeOwnerClosed(b, [
          "index",
          "text",
          "startOffset",
          "endOffset",
          ...(b.page === undefined ? [] : ["page"]),
        ]),
      )
    )
      return false;
    return (
      document.documentId === expected.identity.baseDocumentId &&
      document.version === expected.identity.baseVersion &&
      document.sourceSha256 === expected.identity.baseSha256 &&
      createHash("sha256")
        .update(JSON.stringify({ title: value.job.title, description: value.job.description }))
        .digest("hex") === expected.identity.jobContextSha256
    );
  } catch {
    return false;
  }
}

/** Owning source read, to be invoked only behind original-task authentication. Ordinary ledger,
 * Applications and Jobs locks finish before object I/O. The separate candidate lease covers the
 * retained-source read; final admission refuses source holds, changed packets/jobs or sealing.
 * No generated content, rendering, authority issuance or object location escapes this adapter. */
export function createNativeResumeSource(options: {
  store: Pick<PostgresNativeResumeGenerationStore, "checkTaskAdmission" | "readLaunch">;
  parsed: ParsedResumeSource;
  reader: NormalizedDocumentReader;
  job(scope: {
    canonicalJobId: string;
    jobRevision: string;
    jobContextSha256: string;
  }): Promise<{ title: string; description: string }>;
  candidateLease: { withGenerationLease<T>(owner: string, run: () => Promise<T>): Promise<T> };
  enabled?: () => boolean;
}) {
  const enabled = options.enabled ?? (() => false),
    check = options.store.checkTaskAdmission.bind(options.store),
    launch = options.store.readLaunch.bind(options.store),
    parsed = options.parsed.findParsedResume.bind(options.parsed),
    read = options.reader.read.bind(options.reader),
    job = options.job,
    lease = options.candidateLease.withGenerationLease.bind(options.candidateLease);
  return Object.freeze({
    async load(
      raw: NativeResumeTaskBinding,
      expected: NativeResumeBootstrap,
    ): Promise<NativeResumeSourceValue> {
      try {
        if (!enabled()) throw nativeResumeSourceUnavailable();
        const binding = nativeResumeTaskBinding(raw);
        if (!validateNativeResumeBootstrap(expected, binding))
          throw nativeResumeSourceUnavailable();
        const fixed: NativeResumeBootstrap = JSON.parse(nativeOwnerJson(expected));
        const admit = async () => {
          if (!enabled()) throw nativeResumeSourceUnavailable();
          await check(binding.scope, binding.allocation, binding.configurationSha256);
          if (!enabled()) throw nativeResumeSourceUnavailable();
          const original = await launch(binding.scope, binding.configurationSha256);
          if (
            !enabled() ||
            original.state !== "bound" ||
            original.ready ||
            original.reference !== null ||
            !isDeepStrictEqual(original.allocation, binding.allocation) ||
            !isDeepStrictEqual(
              {
                identity: original.reservation.identity,
                normalizedSha256: original.reservation.normalizedSha256,
                canonicalJobId: original.reservation.application.canonicalJobId,
              },
              fixed,
            )
          )
            throw nativeResumeSourceUnavailable();
          return original;
        };
        const original = await admit();
        const result = await lease(binding.scope.ownerUserId, async () => {
          await admit();
          const base = await parsed(binding.scope.ownerUserId, fixed.identity.baseDocumentId);
          if (
            !enabled() ||
            !base ||
            base.id !== fixed.identity.baseDocumentId ||
            base.version !== fixed.identity.baseVersion ||
            base.sha256 !== fixed.identity.baseSha256 ||
            base.normalizedSha256 !== fixed.normalizedSha256
          )
            throw nativeResumeSourceUnavailable();
          const source = structuredClone(base);
          const context = structuredClone(
            await job({
              canonicalJobId: fixed.canonicalJobId,
              jobRevision: original.reservation.application.jobRevision,
              jobContextSha256: fixed.identity.jobContextSha256,
            }),
          );
          await admit();
          const document = structuredClone(
            await read(
              {
                userId: binding.scope.ownerUserId,
                documentId: source.id,
                documentVersion: source.version,
                sourceObjectKey: source.sourceObjectKey,
                sourceObjectVersion: source.sourceObjectVersion ?? "",
                mediaType: source.mediaType,
                sizeBytes: source.sizeBytes,
                sha256: source.sha256,
                createdAt: new Date(source.createdAt).toISOString(),
                traceId: "native-resume-source",
              },
              {
                ok: true,
                normalizedObjectKey: source.normalizedObjectKey,
                normalizedObjectVersion: source.normalizedObjectVersion,
                normalizedSha256: source.normalizedSha256,
                parserVersion: source.parserVersion,
                pageCount: source.pageCount,
                characterCount: source.characterCount,
              },
            ),
          );
          await admit();
          const value = { document, job: context };
          if (
            document.parserVersion !== source.parserVersion ||
            document.mediaType !== source.mediaType ||
            !validateNativeResumeSource(value, fixed)
          )
            throw nativeResumeSourceUnavailable();
          return value;
        });
        if (!enabled()) throw nativeResumeSourceUnavailable();
        return result;
      } catch {
        throw nativeResumeSourceUnavailable();
      }
    },
  });
}
