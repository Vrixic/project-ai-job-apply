import type { ParsedResumeSource } from "./parsed-resume-source.js";
export {
  type ParsedResumeRecord,
  type ParsedResumeSource,
  PostgresParsedResumeSource,
} from "./parsed-resume-source.js";
import { createHash } from "node:crypto";
import type { NormalizedDocumentReader } from "./normalized-document-reader.js";
import { RenderError, renderDocx, renderPdf } from "./render/render.js";
import { verifyRenderedResume } from "./render/verify.js";
import { buildResumeAst } from "./resume-ast/build.js";
import type { AstNode, ResumeAst } from "./resume-ast/types.js";
import {
  parseResumeTailoringRequest,
  RESUME_TAILORING_RESULT_SCHEMA,
  type ResumeArtifactFormat,
  type ResumeTailoringReady,
  type ResumeTailoringResult,
  type ResumeTailoringUnavailableReason,
  type TailoredBulletView,
  type TailoredSectionView,
} from "./resume-tailoring-contract.js";
import {
  materializeTailoredResume,
  type RenderBlock,
  TAILORING_VERSION,
  type TailoredResume,
  tailorResume,
  verifyTailoredFactuality,
} from "./tailoring/tailor.js";

/**
 * Hash over the ordered, materialized blocks and the base identity. It is independent of node
 * identifiers and of the file format, so DOCX and PDF renderings share one approval binding, and
 * any change to the resume, the job text, or the tailoring version changes it.
 */
export function tailoredContentSha256(
  base: { sha256: string },
  tailoringVersion: string,
  blocks: readonly RenderBlock[],
): string {
  const canonical = JSON.stringify({
    schema: "resume-content.v1",
    tailoringVersion,
    baseSha256: base.sha256,
    blocks: blocks.map((block) => [block.kind, block.text]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function nodeText(ast: ResumeAst): Map<string, AstNode> {
  const nodes = new Map<string, AstNode>();
  for (const section of ast.sections) {
    if (section.heading) nodes.set(section.heading.id, section.heading);
    for (const entry of section.entries) {
      for (const node of [...entry.lines, ...entry.bullets]) nodes.set(node.id, node);
    }
  }
  return nodes;
}

/** Section-grouped view of what changed, with fixed change labels and no rewritten text. */
export function buildTailoredView(ast: ResumeAst, tailored: TailoredResume): TailoredSectionView[] {
  const nodes = nodeText(ast);
  const moved = new Map<string, string[]>();
  const omitted = new Set<string>();
  for (const entry of tailored.diff) {
    if (entry.op === "move") moved.set(entry.nodeId, entry.matchedTerms);
    if (entry.op === "omit") omitted.add(entry.nodeId);
  }
  const astSections = new Map(ast.sections.map((section) => [section.id, section]));
  return tailored.sections.map((section) => {
    const base = astSections.get(section.sectionId);
    const baseEntries = new Map((base?.entries ?? []).map((entry) => [entry.id, entry]));
    const heading = section.headingNodeId ? nodes.get(section.headingNodeId)?.text : undefined;
    return {
      kind: section.kind,
      ...(heading ? { heading } : {}),
      entries: section.entries.map((entry) => {
        const baseEntry = baseEntries.get(entry.entryId);
        const kept: TailoredBulletView[] = entry.bulletNodeIds.map((id) => {
          const terms = moved.get(id);
          return {
            text: nodes.get(id)?.text ?? "",
            change: terms ? "moved_up" : "kept",
            ...(terms ? { matchedTerms: terms } : {}),
          } as TailoredBulletView;
        });
        const dropped: TailoredBulletView[] = (baseEntry?.bullets ?? [])
          .filter((bullet) => omitted.has(bullet.id))
          .map((bullet) => ({ text: bullet.text, change: "omitted" as const }));
        return {
          lines: entry.lineNodeIds.map((id) => nodes.get(id)?.text ?? ""),
          bullets: [...kept, ...dropped],
        };
      }),
    };
  });
}

const MAXIMUM_ARTIFACT_BYTES = 300_000;

export interface ResumeTailoringDependencies {
  source: ParsedResumeSource;
  reader: NormalizedDocumentReader;
}

function unavailable(reason: ResumeTailoringUnavailableReason): ResumeTailoringResult {
  return { schema: RESUME_TAILORING_RESULT_SCHEMA, status: "unavailable", reason };
}

/**
 * Serves one tailoring request. Candidate text leaves this function only inside the owner's own
 * response and is never logged or persisted (ADR-031). A resume the runtime cannot read, verify, or
 * render yields a fixed reason code instead of a partial result.
 */
export function createResumeTailoringService(dependencies: ResumeTailoringDependencies) {
  return async function tailor(raw: unknown): Promise<ResumeTailoringResult> {
    const request = parseResumeTailoringRequest(raw);
    if (!request) return unavailable("invalid_request");

    const record = await dependencies.source.findParsedResume(
      request.ownerUserId,
      request.documentId,
    );
    if (!record) return { schema: RESUME_TAILORING_RESULT_SCHEMA, status: "no_resume" };

    let ast: ResumeAst;
    try {
      const normalized = await dependencies.reader.read(
        {
          userId: request.ownerUserId,
          documentId: record.id,
          documentVersion: record.version,
          sourceObjectKey: record.sourceObjectKey,
          sourceObjectVersion: record.sourceObjectVersion ?? "",
          mediaType: record.mediaType,
          sizeBytes: record.sizeBytes,
          sha256: record.sha256,
          createdAt: new Date(record.createdAt).toISOString(),
          traceId: "resume-tailoring",
        },
        {
          ok: true,
          normalizedObjectKey: record.normalizedObjectKey,
          normalizedObjectVersion: record.normalizedObjectVersion,
          normalizedSha256: record.normalizedSha256,
          parserVersion: record.parserVersion,
          pageCount: record.pageCount,
          characterCount: record.characterCount,
        },
      );
      ast = buildResumeAst(normalized);
    } catch {
      return unavailable("document_unreadable");
    }

    const tailored = tailorResume(ast, request.job);
    if (verifyTailoredFactuality(ast, tailored).length > 0) return unavailable("factuality_failed");
    const blocks = materializeTailoredResume(ast, tailored);

    const ready: ResumeTailoringReady = {
      schema: RESUME_TAILORING_RESULT_SCHEMA,
      status: "ready",
      baseDocument: {
        id: record.id,
        fileName: record.fileName,
        version: record.version,
        sha256: record.sha256,
      },
      tailoringVersion: TAILORING_VERSION,
      contentSha256: tailoredContentSha256(record, TAILORING_VERSION, blocks),
    };
    if (request.mode === "hash") return ready;

    ready.matchedTerms = tailored.matchedTerms;
    ready.sections = buildTailoredView(ast, tailored);
    if (request.mode === "preview") return ready;

    try {
      const format = request.format as ResumeArtifactFormat;
      const rendered = format === "docx" ? await renderDocx(blocks) : renderPdf(blocks);
      const verification = await verifyRenderedResume(rendered, blocks);
      if (!verification.ok) return unavailable("render_failed");
      // The response carries the file inline, so it stays within the contract's size ceiling.
      if (rendered.bytes.byteLength > MAXIMUM_ARTIFACT_BYTES) return unavailable("render_failed");
      ready.artifact = {
        format,
        mediaType: rendered.mediaType,
        sha256: rendered.sha256,
        sizeBytes: rendered.bytes.byteLength,
        contentBase64: Buffer.from(rendered.bytes).toString("base64"),
      };
      return ready;
    } catch (error) {
      if (error instanceof RenderError) return unavailable("render_failed");
      return unavailable("render_failed");
    }
  };
}

export * from "./resume-tailoring-contract.js";
