import type { GenerationResult } from "@ai-job-apply/ai-sdk";
import { FactGraph, type GraphFact } from "@ai-job-apply/domain";
import {
  type CoverLetterDocument,
  coverLetterFile,
  createCoverLetterDocument,
} from "./cover-letter.js";
import type {
  CoverLetterGenerationOutcome,
  CoverLetterReadyBinding,
} from "./cover-letter-generation.js";
import type { CoverLetterMetadata, PostgresCoverLetterStore } from "./cover-letter-store.js";

export function coverLetterReadyBinding(
  document: CoverLetterDocument,
  facts: readonly GraphFact[],
  now: Date,
): CoverLetterReadyBinding {
  const ids = [...new Set(document.paragraphs.flatMap((paragraph) => paragraph.factIds))].sort();
  const graph = FactGraph.build(facts, now);
  const confidence = ids.reduce((minimum, id) => {
    const usability = graph.usability(id);
    return usability?.usable ? Math.min(minimum, usability.confidence) : 0;
  }, 1);
  return { contentSha256: document.contentSha256, sourceFactIds: ids, confidence };
}

/** Ordinary generation and saved-result recovery share both production parser checks. */
export async function finalizeCoverLetterDraft(
  store: Pick<PostgresCoverLetterStore, "complete">,
  metadata: CoverLetterMetadata,
  generated: GenerationResult,
  facts: readonly GraphFact[],
  clock: () => Date,
): Promise<CoverLetterGenerationOutcome> {
  if (generated.status !== "needs_review") {
    return {
      kind: "failed",
      errorCode:
        generated.status === "refused"
          ? "no_confirmed_evidence"
          : generated.status === "rejected"
            ? "grounding_failed"
            : "generation_unavailable",
    };
  }
  const document = createCoverLetterDocument(metadata, generated, metadata.createdAt);
  try {
    for (const format of ["pdf", "docx"] as const) {
      await coverLetterFile(
        document,
        metadata.ownerUserId,
        metadata.applicationId,
        document.contentSha256,
        format,
      );
    }
  } catch {
    return { kind: "failed", errorCode: "render_failed" };
  }
  // The store independently reacquires the active-candidate lease before any immutable write.
  await store.complete(document);
  return { kind: "ready", letter: coverLetterReadyBinding(document, facts, clock()) };
}
