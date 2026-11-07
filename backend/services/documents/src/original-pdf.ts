import { createHash } from "node:crypto";

/**
 * The most the candidate's own PDF may weigh for it to be edited in place. Anything larger is not
 * read at all: the resume is then drawn from its recorded layout instead.
 */
export const MAXIMUM_ORIGINAL_PDF_BYTES = 600_000;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * The decoded original, or nothing when the field is absent, malformed, too large, not a PDF, or not
 * exactly the file the base document was parsed from (its SHA-256 must be the document's source hash).
 * Pure: it carries no object-store capability, so the isolated generation process can use it.
 */
export function decodeOriginalPdf(
  originalPdfBase64: unknown,
  sourceSha256: string,
): Uint8Array | undefined {
  if (
    typeof originalPdfBase64 !== "string" ||
    originalPdfBase64.length < 8 ||
    originalPdfBase64.length > Math.ceil((MAXIMUM_ORIGINAL_PDF_BYTES * 4) / 3) + 4 ||
    !BASE64.test(originalPdfBase64)
  )
    return undefined;
  const bytes = Uint8Array.from(Buffer.from(originalPdfBase64, "base64"));
  const header = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (
    bytes.byteLength > MAXIMUM_ORIGINAL_PDF_BYTES ||
    header !== "%PDF-" ||
    createHash("sha256").update(bytes).digest("hex") !== sourceSha256
  ) {
    bytes.fill(0);
    return undefined;
  }
  return bytes;
}
