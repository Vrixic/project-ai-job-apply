import {
  ApplicationAlreadyExistsError,
  ApplicationIdempotencyConflictError,
  ApplicationIntegrityError,
  ApplicationJobUnavailableError,
  ApplicationLimitError,
  ApplicationNotFoundError,
  ApplicationRevisionConflictError,
  ApplicationsUnavailableError,
  ApprovalRefusedError,
  AttemptNotFoundError,
  AttemptRefusedError,
  IllegalTransitionError,
  InvalidApplicationCursorError,
  PacketInvariantError,
  PreparationNotFoundError,
  StalePacketError,
} from "@ai-job-apply/applications-service";
import { HttpStatus } from "@nestjs/common";

export interface ApplicationsFailure {
  status: number;
  code: string;
  title: string;
  detail: string;
}

/**
 * Projects Applications failures to stable, value-free problem details. Detail text is fixed so a
 * failure can never echo a candidate value, packet field, or provider response.
 */
export function projectApplicationsFailure(exception: unknown): ApplicationsFailure | null {
  if (
    exception instanceof ApplicationNotFoundError ||
    exception instanceof AttemptNotFoundError ||
    exception instanceof PreparationNotFoundError
  ) {
    return {
      status: HttpStatus.NOT_FOUND,
      code: "application_not_found",
      title: "Application not found",
      detail: "The application was not found",
    };
  }
  if (exception instanceof ApplicationJobUnavailableError) {
    return {
      status: HttpStatus.NOT_FOUND,
      code: "application_job_unavailable",
      title: "Job is unavailable",
      detail: "The job is not available to apply to",
    };
  }
  if (exception instanceof InvalidApplicationCursorError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: "invalid_application_cursor",
      title: "Invalid application cursor",
      detail: "The application cursor is invalid",
    };
  }
  if (exception instanceof PacketInvariantError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: "invalid_application_packet",
      title: "Invalid application packet",
      detail: "The application packet input is invalid",
    };
  }
  if (exception instanceof ApplicationRevisionConflictError) {
    return conflict(
      "application_revision_conflict",
      "Application changed",
      "The application changed since it was last read",
    );
  }
  if (exception instanceof ApplicationIdempotencyConflictError) {
    return conflict(
      "idempotency_conflict",
      "Idempotency key conflict",
      "The idempotency key was used for a different request",
    );
  }
  if (exception instanceof ApplicationAlreadyExistsError) {
    return conflict(
      "application_already_exists",
      "Application already exists",
      "A live application already exists for this job",
    );
  }
  if (exception instanceof ApplicationLimitError) {
    return conflict(
      "application_limit_reached",
      "Application limit reached",
      "The application limit has been reached",
    );
  }
  if (exception instanceof StalePacketError) {
    return conflict(
      "application_packet_stale",
      "Packet is stale",
      "The job, form, or documents changed; prepare a new packet",
    );
  }
  if (exception instanceof ApprovalRefusedError) {
    return conflict(
      "application_approval_refused",
      "Approval refused",
      `Approval was refused: ${exception.code}`,
    );
  }
  if (exception instanceof IllegalTransitionError) {
    return conflict(
      "application_state_conflict",
      "Application state conflict",
      "That action is not allowed in the current application state",
    );
  }
  if (exception instanceof AttemptRefusedError) {
    return conflict(
      "application_attempt_refused",
      "Attempt refused",
      `The attempt was refused: ${exception.code}`,
    );
  }
  if (exception instanceof ApplicationIntegrityError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: "application_integrity_failure",
      title: "Application unavailable",
      detail: "The application cannot be served safely",
    };
  }
  if (exception instanceof ApplicationsUnavailableError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: "applications_unavailable",
      title: "Applications are unavailable",
      detail: "Applications are temporarily unavailable",
    };
  }
  return null;
}

function conflict(code: string, title: string, detail: string): ApplicationsFailure {
  return { status: HttpStatus.CONFLICT, code, title, detail };
}

export interface HistoryQuery {
  afterSeq?: number;
  limit?: number;
}

/** The resume file route takes exactly one `format` parameter, `docx` or `pdf`, and nothing else. */
export function parseResumeFormatQuery(query: unknown): "docx" | "pdf" | null {
  if (typeof query !== "object" || query === null || Array.isArray(query)) return null;
  const entries = Object.entries(query as Record<string, unknown>);
  const only = entries[0];
  if (entries.length !== 1 || !only || only[0] !== "format") return null;
  return only[1] === "docx" || only[1] === "pdf" ? only[1] : null;
}

/** Strict bounded query parsing: unknown, repeated, or non-integer parameters are invalid. */
export function parseHistoryQuery(query: unknown): HistoryQuery | null {
  if (query === undefined || query === null) return {};
  if (typeof query !== "object" || Array.isArray(query)) return null;
  const result: HistoryQuery = {};
  for (const [name, value] of Object.entries(query as Record<string, unknown>)) {
    if (name !== "afterSeq" && name !== "limit") return null;
    if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) return null;
    const parsed = Number(value);
    if (name === "afterSeq") result.afterSeq = parsed;
    else if (parsed >= 1 && parsed <= 200) result.limit = parsed;
    else return null;
  }
  return result;
}
