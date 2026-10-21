/**
 * Wire contract for tailoring (ADR-031). It carries no heavy dependency, so the Gateway can import
 * the request and result shapes without bundling the PDF/DOCX render and parse code.
 */

/** The one synchronous request kind the Documents runtime serves for tailoring (ADR-031). */
export const RESUME_TAILORING_REQUEST_KIND = "resume-tailoring-v1" as const;
export const RESUME_TAILORING_RESULT_SCHEMA = "resume-tailoring-result.v1" as const;

const MAXIMUM_TITLE_CHARACTERS = 300;
const MAXIMUM_DESCRIPTION_CHARACTERS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * - `hash` returns only the base document identity and the format-independent content hash.
 * - `preview` adds the reviewable, section-grouped view of what changed.
 * - `artifact` adds one verified rendering of the requested format.
 */
export type ResumeTailoringMode = "hash" | "preview" | "artifact";
/** Generated resumes are delivered only as PDF. */
export type ResumeArtifactFormat = "pdf";

export interface ResumeTailoringRequest {
  kind: typeof RESUME_TAILORING_REQUEST_KIND;
  mode: ResumeTailoringMode;
  ownerUserId: string;
  documentId?: string;
  job: { title: string; description: string };
  format?: ResumeArtifactFormat;
}

export interface TailoredBulletView {
  text: string;
  change: "kept" | "moved_up" | "omitted";
  matchedTerms?: string[];
}

export interface TailoredEntryView {
  lines: string[];
  bullets: TailoredBulletView[];
}

export interface TailoredSectionView {
  kind: string;
  heading?: string;
  entries: TailoredEntryView[];
}

export interface ResumeTailoringReady {
  schema: typeof RESUME_TAILORING_RESULT_SCHEMA;
  status: "ready";
  baseDocument: { id: string; fileName: string; version: number; sha256: string };
  tailoringVersion: string;
  contentSha256: string;
  matchedTerms?: string[];
  sections?: TailoredSectionView[];
  artifact?: {
    format: ResumeArtifactFormat;
    mediaType: "application/pdf";
    sha256: string;
    sizeBytes: number;
    contentBase64: string;
  };
}

export type ResumeTailoringUnavailableReason =
  | "invalid_request"
  | "document_unreadable"
  | "factuality_failed"
  | "render_failed";

export type ResumeTailoringResult =
  | ResumeTailoringReady
  | { schema: typeof RESUME_TAILORING_RESULT_SCHEMA; status: "no_resume" }
  | {
      schema: typeof RESUME_TAILORING_RESULT_SCHEMA;
      status: "unavailable";
      reason: ResumeTailoringUnavailableReason;
    };

export function parseResumeTailoringRequest(value: unknown): ResumeTailoringRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = new Set(["kind", "mode", "ownerUserId", "documentId", "job", "format"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  if (input.kind !== RESUME_TAILORING_REQUEST_KIND) return null;
  if (input.mode !== "hash" && input.mode !== "preview" && input.mode !== "artifact") return null;
  if (typeof input.ownerUserId !== "string" || !UUID.test(input.ownerUserId)) return null;
  if (
    input.documentId !== undefined &&
    (typeof input.documentId !== "string" || !UUID.test(input.documentId))
  ) {
    return null;
  }
  const job = input.job as Record<string, unknown> | null;
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  if (Object.keys(job).some((key) => key !== "title" && key !== "description")) return null;
  if (
    typeof job.title !== "string" ||
    job.title.length < 1 ||
    job.title.length > MAXIMUM_TITLE_CHARACTERS ||
    typeof job.description !== "string" ||
    job.description.length > MAXIMUM_DESCRIPTION_CHARACTERS
  ) {
    return null;
  }
  if (input.mode === "artifact") {
    if (input.format !== "pdf") return null;
  } else if (input.format !== undefined) {
    return null;
  }
  return {
    kind: RESUME_TAILORING_REQUEST_KIND,
    mode: input.mode,
    ownerUserId: input.ownerUserId,
    ...(input.documentId ? { documentId: input.documentId as string } : {}),
    job: { title: job.title, description: job.description },
    ...(input.format ? { format: input.format as ResumeArtifactFormat } : {}),
  };
}
