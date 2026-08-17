export type CandidateProblemSurface = "operation" | "preferences" | "profile_facts" | "resume";

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
  profile_facts: {
    conflict: "This profile fact changed. Refresh and review it again.",
    invalid: "Check the profile fact and try again.",
    missing: "This profile fact is no longer available. Refresh and try again.",
    unavailable: "Profile facts are temporarily unavailable.",
  },
  resume: {
    conflict: "The resume request changed. Refresh and try again.",
    invalid: "Check the resume request and try again.",
    missing: "This resume is no longer available. Refresh and try again.",
    unavailable: "Resume processing is temporarily unavailable.",
  },
};

const authenticationCodes = new Set(["authentication_required", "session_expired"]);
const conflictCodes = new Set([
  "idempotency_conflict",
  "profile_fact_transition_conflict",
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
