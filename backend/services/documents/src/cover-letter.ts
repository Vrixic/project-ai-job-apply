import { createHash } from "node:crypto";
import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { renderDocx, renderPdf } from "./render/render.js";
import { verifyRenderedResume } from "./render/verify.js";
import type { RenderBlock } from "./tailoring/tailor.js";

type ReadyPreview = Extract<ApplicationCoverLetterPreview, { status: "ready" }>;
type Paragraph = ReadyPreview["paragraphs"][number];
const validatePreview = compileComponentValidator("ApplicationCoverLetterPreview");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SCHEMA_VERSION = "cover-letter.v1";

/** Internal grounded generation output, never accepted from a candidate API request. */
export interface CoverLetterGeneration {
  status: "needs_review" | "rejected" | "refused" | "unavailable";
  purpose: "cover_letter" | "narrative_answer";
  reviewRequired: true;
  paragraphs: Paragraph[];
  findings: readonly unknown[];
  sourceFactIds: string[];
  confidence: number;
  promptVersion: string;
  model?: { provider: string; model: string; version: string };
}

export interface CoverLetterDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  ownerUserId: string;
  applicationId: string;
  version: number;
  jobRevision: string;
  confirmedFactsHash: string;
  contentSha256: string;
  paragraphs: Paragraph[];
  model: ReadyPreview["model"];
  promptVersion: string;
  createdAt: string;
}

export class CoverLetterIntegrityError extends Error {
  constructor() {
    super("Cover-letter content failed integrity verification");
    this.name = "CoverLetterIntegrityError";
  }
}

export class CoverLetterRenderError extends Error {
  constructor() {
    super("Cover-letter rendering failed verification");
    this.name = "CoverLetterRenderError";
  }
}

function contentHash(document: Omit<CoverLetterDocument, "contentSha256">): string {
  // Fixed-key encoding binds text, ordered citations, generation identity, and evidence context.
  // Identity and timestamps are not content: saving the same draft never changes its hash.
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: document.schemaVersion,
        jobRevision: document.jobRevision,
        confirmedFactsHash: document.confirmedFactsHash,
        model: {
          provider: document.model.provider,
          model: document.model.model,
          version: document.model.version,
        },
        promptVersion: document.promptVersion,
        paragraphs: document.paragraphs.map(({ text, factIds }) => ({ text, factIds })),
      }),
    )
    .digest("hex");
}

function assertDocument(document: CoverLetterDocument): void {
  const preview: ReadyPreview = {
    status: "ready",
    documentId: document.id,
    version: document.version,
    contentSha256: document.contentSha256,
    matchesPacket: false,
    reviewRequired: true,
    paragraphs: document.paragraphs,
    model: document.model,
    promptVersion: document.promptVersion,
  };
  if (
    document.schemaVersion !== SCHEMA_VERSION ||
    !UUID.test(document.ownerUserId) ||
    !UUID.test(document.applicationId) ||
    !SHA256.test(document.jobRevision) ||
    !SHA256.test(document.confirmedFactsHash) ||
    !Number.isFinite(Date.parse(document.createdAt)) ||
    !validatePreview(preview) ||
    document.paragraphs.length > 6 ||
    document.paragraphs.some(
      (paragraph) => paragraph.text.length > 1_200 || !paragraph.text.trim(),
    ) ||
    contentHash(document) !== document.contentSha256
  ) {
    throw new CoverLetterIntegrityError();
  }
}

/** Bounded encrypted-object payload. No candidate text is written to SQL or events. */
export function encodeCoverLetterDocument(document: CoverLetterDocument): Uint8Array {
  assertDocument(document);
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  if (bytes.byteLength > 32_768) throw new CoverLetterIntegrityError();
  return bytes;
}

export function decodeCoverLetterDocument(bytes: Uint8Array): CoverLetterDocument {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > 32_768) throw new CoverLetterIntegrityError();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new CoverLetterIntegrityError();
    const keys = [
      "schemaVersion",
      "id",
      "ownerUserId",
      "applicationId",
      "version",
      "jobRevision",
      "confirmedFactsHash",
      "contentSha256",
      "paragraphs",
      "model",
      "promptVersion",
      "createdAt",
    ];
    if (
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      throw new CoverLetterIntegrityError();
    const document = value as CoverLetterDocument;
    assertDocument(document);
    return document;
  } catch {
    throw new CoverLetterIntegrityError();
  }
}

/** Only grounded, review-required cover letters become immutable Documents content. */
export function createCoverLetterDocument(
  identity: Pick<
    CoverLetterDocument,
    "id" | "ownerUserId" | "applicationId" | "version" | "jobRevision" | "confirmedFactsHash"
  >,
  generation: CoverLetterGeneration,
  now: Date,
): CoverLetterDocument {
  const cited = [
    ...new Set(generation.paragraphs.flatMap((paragraph) => paragraph.factIds)),
  ].sort();
  if (
    generation.status !== "needs_review" ||
    generation.purpose !== "cover_letter" ||
    generation.reviewRequired !== true ||
    generation.findings.length !== 0 ||
    !generation.model ||
    !Number.isFinite(generation.confidence) ||
    generation.confidence < 0 ||
    generation.confidence > 1 ||
    JSON.stringify(cited) !== JSON.stringify([...generation.sourceFactIds].sort()) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new CoverLetterIntegrityError();
  }
  const content: Omit<CoverLetterDocument, "contentSha256"> = {
    id: identity.id,
    ownerUserId: identity.ownerUserId,
    applicationId: identity.applicationId,
    version: identity.version,
    jobRevision: identity.jobRevision,
    confirmedFactsHash: identity.confirmedFactsHash,
    schemaVersion: SCHEMA_VERSION,
    paragraphs: generation.paragraphs.map(({ text, factIds }) => ({ text, factIds: [...factIds] })),
    model: { ...generation.model } as ReadyPreview["model"],
    promptVersion: generation.promptVersion,
    createdAt: now.toISOString(),
  };
  const document = { ...content, contentSha256: contentHash(content) };
  assertDocument(document);
  return document;
}

export function coverLetterPreview(
  document: CoverLetterDocument,
  ownerUserId: string,
  applicationId: string,
  packetHash: string | undefined,
): ApplicationCoverLetterPreview {
  if (document.ownerUserId !== ownerUserId || document.applicationId !== applicationId) {
    throw new CoverLetterIntegrityError();
  }
  assertDocument(document);
  return {
    status: "ready",
    documentId: document.id,
    version: document.version,
    contentSha256: document.contentSha256,
    matchesPacket: packetHash === document.contentSha256,
    reviewRequired: true,
    paragraphs: document.paragraphs.map(({ text, factIds }) => ({ text, factIds: [...factIds] })),
    model: { ...document.model },
    promptVersion: document.promptVersion,
  };
}

/** Renders the saved draft, never calls generation, and refuses an unbound packet. */
export async function coverLetterFile(
  document: CoverLetterDocument,
  ownerUserId: string,
  applicationId: string,
  packetHash: string,
  format: "pdf" | "docx",
): Promise<ApplicationCoverLetterFile> {
  const preview = coverLetterPreview(document, ownerUserId, applicationId, packetHash);
  if (!preview.matchesPacket) throw new CoverLetterIntegrityError();
  const blocks: RenderBlock[] = document.paragraphs.map(({ text }, index) => ({
    kind: "line",
    nodeId: `paragraph-${index}`,
    text,
  }));
  try {
    if (format !== "pdf" && format !== "docx") throw new CoverLetterRenderError();
    const rendered = format === "docx" ? await renderDocx(blocks) : renderPdf(blocks);
    if (rendered.bytes.byteLength > 300_000 || !(await verifyRenderedResume(rendered, blocks)).ok)
      throw new CoverLetterRenderError();
    return {
      format,
      mediaType: rendered.mediaType,
      fileName: `cover-letter.${format}`,
      sha256: rendered.sha256,
      sizeBytes: rendered.bytes.byteLength,
      contentSha256: document.contentSha256,
      contentBase64: Buffer.from(rendered.bytes).toString("base64"),
    };
  } catch {
    // No candidate text, parser diagnostic, or raw exception crosses this boundary.
    throw new CoverLetterRenderError();
  }
}
