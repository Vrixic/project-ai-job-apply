/**
 * Wire contract for reading the candidate's own original uploaded resume. Like tailoring, it
 * carries no heavy dependency so the Gateway can import the shapes without bundling parsing code.
 * The file is the owner's own bytes in their original format; nothing is rewritten or generated.
 */

export const ORIGINAL_RESUME_REQUEST_KIND = "original-resume-v1" as const;
export const ORIGINAL_RESUME_RESULT_SCHEMA = "original-resume-result.v1" as const;

/** Largest original file returned inline. Larger files are refused rather than truncated. */
export const ORIGINAL_RESUME_MAXIMUM_BYTES = 2 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `descriptor` returns identity and hash only; `file` also returns the exact original bytes. */
export type OriginalResumeMode = "descriptor" | "file";

export interface OriginalResumeRequest {
  kind: typeof ORIGINAL_RESUME_REQUEST_KIND;
  mode: OriginalResumeMode;
  ownerUserId: string;
  documentId?: string;
}

export interface OriginalResumeDocument {
  id: string;
  fileName: string;
  format: "pdf" | "docx";
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  /** SHA-256 of the original file bytes. */
  sha256: string;
}

export type OriginalResumeUnavailableReason =
  | "invalid_request"
  | "too_large"
  | "document_unreadable";

export type OriginalResumeResult =
  | {
      schema: typeof ORIGINAL_RESUME_RESULT_SCHEMA;
      status: "ready";
      document: OriginalResumeDocument;
      contentBase64?: string;
    }
  | { schema: typeof ORIGINAL_RESUME_RESULT_SCHEMA; status: "no_resume" }
  | {
      schema: typeof ORIGINAL_RESUME_RESULT_SCHEMA;
      status: "unavailable";
      reason: OriginalResumeUnavailableReason;
    };

export function parseOriginalResumeRequest(value: unknown): OriginalResumeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = new Set(["kind", "mode", "ownerUserId", "documentId"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  if (input.kind !== ORIGINAL_RESUME_REQUEST_KIND) return null;
  if (input.mode !== "descriptor" && input.mode !== "file") return null;
  if (typeof input.ownerUserId !== "string" || !UUID.test(input.ownerUserId)) return null;
  if (
    input.documentId !== undefined &&
    (typeof input.documentId !== "string" || !UUID.test(input.documentId))
  )
    return null;
  return {
    kind: ORIGINAL_RESUME_REQUEST_KIND,
    mode: input.mode,
    ownerUserId: input.ownerUserId,
    ...(input.documentId ? { documentId: input.documentId as string } : {}),
  };
}
