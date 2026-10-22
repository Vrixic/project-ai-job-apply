export type CandidateProblemSurface =
  | "operation"
  | "preferences"
  | "profile_sections"
  | "restricted_answers"
  | "resume";

type SurfaceCopy = Readonly<{
  conflict: string;
  invalid: string;
  missing: string;
  unavailable: string;
}>;

const copyBySurface: Readonly<Record<CandidateProblemSurface, SurfaceCopy>> = {
  operation: {
    conflict: "The saved check changed. Refresh and try again.",
    invalid: "The saved check request is invalid. Start it again.",
    missing: "The saved check is no longer available. Start it again if needed.",
    unavailable: "The saved check is temporarily unavailable.",
  },
  preferences: {
    conflict: "Your saved preferences changed. Refresh and try again.",
    invalid: "Check your job preferences and try again.",
    missing: "Your saved preferences are no longer available. Refresh and try again.",
    unavailable: "Job preferences are temporarily unavailable.",
  },
  profile_sections: {
    conflict: "This profile entry changed. Refresh and review it again.",
    invalid: "Check the entry and try again.",
    missing: "This profile entry is no longer available. Refresh and try again.",
    unavailable: "Your profile is temporarily unavailable.",
  },
  restricted_answers: {
    conflict: "This saved answer changed. Refresh and review it again.",
    invalid: "Check the restricted answer and try again.",
    missing: "This saved answer is no longer available. Refresh and try again.",
    unavailable: "Restricted answers are temporarily unavailable.",
  },
  resume: {
    conflict: "The resume request changed. Refresh and try again.",
    invalid: "Check the resume request and try again.",
    missing: "This resume is no longer available. Refresh and try again.",
    unavailable: "Resume processing is temporarily unavailable.",
  },
};

// Refusals the candidate can act on get their own fixed copy (ADR-032); they are never upstream text.
const resumeCodeCopy: ReadonlyMap<string, string> = new Map([
  [
    "resume_upload_in_progress",
    "Your resume is still being processed. You can upload another when it finishes.",
  ],
  ["resume_document_limit", "Your plan's stored resume limit has been reached."],
  [
    "resume_not_deletable",
    "This resume is still being processed. You can delete it when processing finishes.",
  ],
  [
    "entitlement_unavailable",
    "Your plan details are temporarily unavailable. Try uploading again shortly.",
  ],
]);

// Fixed copy for refusals the candidate can act on while editing their profile.
const profileSectionCodeCopy: ReadonlyMap<string, string> = new Map([
  [
    "restricted_question",
    "This question is about work authorization, demographics or a legal disclosure. Answer it in Restricted answers instead.",
  ],
  ["profile_section_limit", "This section is full. Remove an entry before adding another."],
  ["profile_record_duplicate", "You already saved this. Edit the existing entry instead."],
  ["profile_order_conflict", "Your entries changed. Refresh and try the new order again."],
]);

const authenticationCodes = new Set(["authentication_required", "session_expired"]);
const conflictCodes = new Set([
  "idempotency_conflict",
  "version_conflict",
]);
const invalidCodes = new Set(["invalid_request", "payload_too_large", "unsupported_media_type"]);

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const value = (await response.json()) as { code?: unknown };
    return typeof value.code === "string" ? value.code : undefined;
  } catch {
    return undefined;
  }
}

export async function candidateSafeProblemMessage(
  response: Response,
  surface: CandidateProblemSurface,
): Promise<string> {
  const code = await problemCode(response);
  const copy = copyBySurface[surface];

  if (response.status === 401 || (code !== undefined && authenticationCodes.has(code))) {
    return "Sign in again to continue.";
  }
  if (surface === "resume" && code !== undefined) {
    const specific = resumeCodeCopy.get(code);
    if (specific) return specific;
  }
  if (surface === "profile_sections" && code !== undefined) {
    const specific = profileSectionCodeCopy.get(code);
    if (specific) return specific;
  }
  if (response.status === 403 || code === "forbidden") {
    return "Your session is not allowed to complete this request.";
  }
  if (
    [400, 413, 415, 422].includes(response.status) ||
    (code !== undefined && invalidCodes.has(code))
  ) {
    return copy.invalid;
  }
  if (response.status === 409 || (code !== undefined && conflictCodes.has(code))) {
    return copy.conflict;
  }
  if (response.status === 404 || code === "not_found") {
    return copy.missing;
  }
  return copy.unavailable;
}
