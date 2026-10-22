const MAXIMUM_NAME_LENGTH = 120;
const SEGMENT_FALLBACK = { candidate: "Candidate", job: "Job" } as const;

/** One filename segment: words kept, accents folded, everything else collapsed to one underscore. */
function segment(value: string | undefined, fallback: string, maximum: number): string {
  const folded = (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, maximum)
    .replace(/_+$/u, "");
  return folded || fallback;
}

/** An email address is not a name; keep only what precedes the at sign. */
function nameFrom(candidateName: string | undefined): string | undefined {
  const name = candidateName?.trim();
  if (!name) return undefined;
  return name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
}

/**
 * The download and attachment name of a generated resume: `User_Job_Name_ID.pdf`, for example
 * `Vrij_Patel_Software_Engineer_01a160f2-cd42-75b0-a7e5-4cb30d5f42be.pdf`. It is always built here
 * from the candidate's own name, the job title and the application id, never from anything the
 * generating process returns, so every download and attachment carries the same name.
 */
export function resumeFileName(parts: {
  candidateName?: string | undefined;
  jobTitle?: string | undefined;
  applicationId: string;
}): string {
  const id = parts.applicationId.replace(/[^A-Za-z0-9-]/gu, "").slice(0, 36) || "Application";
  const candidate = segment(nameFrom(parts.candidateName), SEGMENT_FALLBACK.candidate, 50);
  // The id and extension are fixed; the job title gives way when the name would run long.
  const room = MAXIMUM_NAME_LENGTH - ".pdf".length - id.length - candidate.length - 2;
  const job = segment(parts.jobTitle, SEGMENT_FALLBACK.job, Math.max(8, room));
  return `${candidate}_${job}_${id}.pdf`;
}
