import type { ApplicationPacket } from "./packet.js";

/** Largest original file attached automatically. Larger uploads are refused, never truncated. */
export const UPLOADED_RESUME_MAXIMUM_BYTES = 2 * 1024 * 1024;

/** Identity of the candidate's current uploaded resume. No file name or content. */
export interface UploadedResumeDescriptor {
  documentId: string;
  /** SHA-256 of the original file bytes. */
  sha256: string;
  sizeBytes: number;
}

export interface UploadedResumeFileBody extends UploadedResumeDescriptor {
  fileName: string;
  format: "pdf" | "docx";
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  contentBase64: string;
}

/**
 * Documents-owned read of the candidate's own original resume. The Applications service reads no
 * Documents table and no object store; an unreachable owner throws so that a missing resume is
 * never inferred from an outage.
 */
export interface UploadedResumeSource {
  /** The newest parsed resume, or undefined when the candidate has none. */
  descriptor(ownerUserId: string): Promise<UploadedResumeDescriptor | undefined>;
  /** The exact original bytes of one owned document, or undefined when it is gone. */
  file(ownerUserId: string, documentId: string): Promise<UploadedResumeFileBody | undefined>;
}

/** The candidate's uploaded resume is larger than the automatic-attachment limit. */
export class UploadedResumeTooLargeError extends Error {
  constructor() {
    super("The uploaded resume is too large to attach automatically");
    this.name = "UploadedResumeTooLargeError";
  }
}

/** A packet is bound to the uploaded resume when it carries a resume hash without a generated file. */
export function packetUsesUploadedResume(packet: ApplicationPacket | null | undefined): boolean {
  return Boolean(
    packet?.fields.some(
      (field) =>
        field.fieldKey === "documents.resume" &&
        field.origin === "confirmed_fact" &&
        field.value === packet.artifactHashes.resume,
    ),
  );
}
