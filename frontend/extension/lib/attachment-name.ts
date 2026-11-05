/** One filename segment: words kept, accents folded, everything else collapsed to one underscore. */
function segment(value: string | undefined, maximum: number): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, maximum)
    .replace(/_+$/u, "");
}

/**
 * The name an employer sees for an attached file: `First_Last_Job_Title.pdf`, and
 * `First_Last_Cover_Letter.pdf` for a cover letter. Built here from the approved first and last name
 * and the job title the extension itself read, never from anything the page or the website supplies.
 * The result always matches the command's file name pattern.
 */
export function attachmentName(parts: {
  kind: "tailored_resume" | "uploaded_resume" | "cover_letter";
  firstName?: string | undefined;
  lastName?: string | undefined;
  jobTitle?: string | undefined;
  format: "pdf" | "docx";
}): string {
  const who =
    [segment(parts.firstName, 30), segment(parts.lastName, 30)].filter(Boolean).join("_") ||
    "Candidate";
  const rest =
    parts.kind === "cover_letter" ? "Cover_Letter" : segment(parts.jobTitle, 100 - who.length - 6);
  const base = [who, rest].filter(Boolean).join("_").slice(0, 90).replace(/_+$/u, "");
  return `${base}.${parts.format}`;
}
