/**
 * The private message between the in-page answer icon and the extension background (ADR-057).
 * Question text goes in and a draft comes back; neither is ever stored, logged or sent anywhere
 * except to the candidate's own application route.
 */
export const NARRATIVE_ANSWER_REQUEST = "application-narrative-answer.v1";

export interface NarrativeAnswerRequest {
  schema: typeof NARRATIVE_ANSWER_REQUEST;
  question: string;
  guidance?: string;
}

export type NarrativeAnswerDeclinedReason =
  | "no_profile_evidence"
  | "sensitive_question"
  | "answered_from_profile"
  | "not_grounded";

export type NarrativeAnswerErrorReason =
  /** Not signed in to ApplyDash in the extension. */
  | "signin"
  /** Too many drafts in a short time. */
  | "limit"
  /** Drafting is switched off or the provider could not be reached. */
  | "unavailable"
  /** This page is no longer the one prepared for an application. */
  | "closed"
  | "failed";

export type NarrativeAnswerReply =
  | { status: "ready"; text: string }
  | { status: "declined"; reason: NarrativeAnswerDeclinedReason }
  | { status: "error"; reason: NarrativeAnswerErrorReason };

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 1000;
export const GUIDANCE_MAX = 1000;

export function parseNarrativeAnswerRequest(value: unknown): NarrativeAnswerRequest | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    record.schema !== NARRATIVE_ANSWER_REQUEST ||
    keys.some((key) => !["schema", "question", "guidance"].includes(key)) ||
    typeof record.question !== "string" ||
    record.question.length < QUESTION_MIN ||
    record.question.length > QUESTION_MAX ||
    (record.guidance !== undefined &&
      (typeof record.guidance !== "string" || record.guidance.length > GUIDANCE_MAX))
  )
    return undefined;
  return {
    schema: NARRATIVE_ANSWER_REQUEST,
    question: record.question,
    ...(record.guidance ? { guidance: record.guidance as string } : {}),
  };
}

/** True for any message of this family, valid or not, so the main listener can leave it alone. */
export function isNarrativeAnswerMessage(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { schema?: unknown }).schema === NARRATIVE_ANSWER_REQUEST
  );
}
