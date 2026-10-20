import type {
  Application,
  ApplicationResumeFile,
  ApplicationResumePreview,
  ApplicationSubmissionStart,
  StartManualApplicationSubmissionRequest,
} from "@ai-job-apply/api-contracts";

/**
 * Browser-side calls to the Applications BFF. Every command carries an idempotency key that is
 * stable for one user action at one application revision, so a double click replays instead of
 * repeating. Failures collapse to fixed, candidate-safe copy; no upstream text is displayed.
 */

export type ApplicationsCallResult =
  | { ok: true; application: Application }
  | { ok: false; status: number; code: string; message: string };

export const APPLICATIONS_CHANGED_EVENT = "applications-changed";

const COPY: Readonly<Record<string, string>> = {
  authentication_required: "Sign in again to continue.",
  session_expired: "Your session expired. Sign in again to continue.",
  forbidden: "Applications are not enabled for your account yet.",
  application_not_found: "We could not find that application.",
  application_job_unavailable: "This job is no longer available to apply to.",
  application_revision_conflict: "This application changed. Reloading the latest version.",
  application_already_exists: "You already have a live application for this job.",
  application_limit_reached: "You have reached the application limit.",
  application_packet_stale:
    "The job, form, or documents changed. Prepare the application again to review the new version.",
  application_resume_too_large:
    "Your uploaded resume is larger than 2 MB, which is too large to attach automatically. Upload a smaller copy in your profile, or generate a resume for this job.",
  application_approval_refused: "That approval was not accepted. Review the highlighted answers.",
  application_state_conflict: "That action is not available in the current state.",
  application_attempt_refused: "That submission step is not allowed right now.",
  invalid_application_packet: "One of your answers is not valid. Check it and try again.",
  applications_unavailable: "Applications are temporarily unavailable. Try again shortly.",
  application_integrity_failure: "This application cannot be shown safely. Try again later.",
};

export function applicationsProblemCopy(code: string): string {
  return COPY[code] ?? "That did not go through. Try again.";
}

export function applicationsProblemCode(code: unknown): string {
  return typeof code === "string" && Object.hasOwn(COPY, code) ? code : "applications_unavailable";
}

export interface ApplicationsCallOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export async function applicationsCall(
  method: "GET" | "POST",
  path: string,
  options: ApplicationsCallOptions & { body?: unknown; idempotencyKey?: string } = {},
): Promise<ApplicationsCallResult> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const value: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      response.status !== 202 &&
      value &&
      typeof value === "object" &&
      "id" in value
    ) {
      return { ok: true, application: value as Application };
    }
    const code =
      value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string"
        ? (value as { code: string }).code
        : "applications_unavailable";
    return { ok: false, status: response.status, code, message: applicationsProblemCopy(code) };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "applications_unavailable",
      message: applicationsProblemCopy("applications_unavailable"),
    };
  }
}

/**
 * Starts the candidate-attested manual path. The server returns a submission-start envelope, but
 * the workspace needs only its owner-scoped application state to expose the existing reconciliation
 * controls. The BFF validates the full envelope before this browser-side identity check.
 */
export async function startManualApplicationSubmission(
  applicationId: string,
  expectedRevision: number,
  options: ApplicationsCallOptions = {},
  observedForm?: StartManualApplicationSubmissionRequest["observedForm"],
): Promise<ApplicationsCallResult> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(`/api/platform/applications/${applicationId}/manual-submissions`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        "content-type": "application/json",
        "idempotency-key": commandKey("manual-submission", applicationId, expectedRevision),
      },
      body: JSON.stringify({ expectedRevision, ...(observedForm ? { observedForm } : {}) }),
    });
    const value: unknown = await response.json().catch(() => undefined);
    if (response.ok && value && typeof value === "object") {
      const result = value as Partial<ApplicationSubmissionStart>;
      if (
        (result.outcome === "started" || result.outcome === "approval_invalidated") &&
        result.application?.id === applicationId
      ) {
        return { ok: true, application: result.application };
      }
    }
    const code =
      value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string"
        ? (value as { code: string }).code
        : "applications_unavailable";
    return { ok: false, status: response.status, code, message: applicationsProblemCopy(code) };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "applications_unavailable",
      message: applicationsProblemCopy("applications_unavailable"),
    };
  }
}

/** One key per user action at one revision: a repeated click replays the same command. */
export function commandKey(action: string, applicationId: string, revision: number): string {
  return `web-${action}-${revision}-${applicationId}`.slice(0, 128);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The candidate's live application for a job: the newest one for that job, unless it was
 * cancelled (a cancelled application may be restarted, so it is not "live"). `ok: false` means the
 * lookup itself failed and the caller must not assume there is none.
 */
export async function findLiveApplication(
  jobId: string,
  options: ApplicationsCallOptions = {},
): Promise<{ ok: true; application: Application | undefined } | { ok: false }> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send("/api/platform/applications/search", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, limit: 1 }),
    });
    if (!response.ok) return { ok: false };
    const value: unknown = await response.json().catch(() => undefined);
    const items = (value as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) return { ok: false };
    const newest: unknown = items[0];
    if (newest === undefined) return { ok: true, application: undefined };
    if (
      !newest ||
      typeof newest !== "object" ||
      typeof (newest as { id?: unknown }).id !== "string" ||
      typeof (newest as { status?: unknown }).status !== "string" ||
      (newest as { canonicalJobId?: unknown }).canonicalJobId !== jobId
    ) {
      return { ok: false };
    }
    const application = newest as Application;
    return { ok: true, application: application.status === "cancelled" ? undefined : application };
  } catch {
    return { ok: false };
  }
}

const appliedApplicationsMaxPages = 20;
const appliedApplicationsPageSize = 50;

/**
 * Every one of the candidate's applications with a confirmed `applied` status, newest first. The
 * search contract has no status filter, so this pages through everything (bounded) and keeps only
 * the confirmed ones. `ok: false` means the lookup itself failed and the caller must not assume
 * there are none.
 */
export async function listAppliedApplications(
  options: ApplicationsCallOptions = {},
): Promise<{ ok: true; applications: Application[] } | { ok: false }> {
  const send = options.fetch ?? fetch;
  const applications: Application[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < appliedApplicationsMaxPages; page += 1) {
    let value: unknown;
    try {
      const response = await send("/api/platform/applications/search", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        ...(options.signal ? { signal: options.signal } : {}),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: appliedApplicationsPageSize,
          ...(cursor ? { cursor } : {}),
        }),
      });
      if (!response.ok) return { ok: false };
      value = await response.json().catch(() => undefined);
    } catch {
      return { ok: false };
    }
    const items = (value as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) return { ok: false };
    for (const item of items) {
      if (item && typeof item === "object" && (item as { status?: unknown }).status === "applied") {
        applications.push(item as Application);
      }
    }
    const nextCursor = (value as { nextCursor?: unknown } | undefined)?.nextCursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) break;
    if (seenCursors.has(nextCursor) || page === appliedApplicationsMaxPages - 1)
      return { ok: false };
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return { ok: true, applications };
}

/**
 * Reads the tailored-resume preview for one application. Returns nothing on any failure so the
 * caller shows fixed copy; the preview is display-only and never feeds a command.
 */
export async function fetchResumePreview(
  applicationId: string,
  options: ApplicationsCallOptions = {},
): Promise<ApplicationResumePreview | undefined> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(`/api/platform/applications/${applicationId}/resume`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json().catch(() => undefined);
    if (
      value &&
      typeof value === "object" &&
      ["ready", "no_resume", "unavailable"].includes((value as { status?: string }).status ?? "") &&
      typeof (value as { matchesPacket?: unknown }).matchesPacket === "boolean"
    ) {
      return value as ApplicationResumePreview;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ResumeFileResult =
  | { ok: true; file: ApplicationResumeFile }
  | { ok: false; message: string };

/** Fetches the tailored resume file the current packet carries; failures collapse to fixed copy. */
export async function fetchResumeFile(
  applicationId: string,
  format: "docx" | "pdf",
  options: ApplicationsCallOptions = {},
): Promise<ResumeFileResult> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(
      `/api/platform/applications/${applicationId}/resume/file?format=${format}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    const value: unknown = await response.json().catch(() => undefined);
    if (response.ok && value && typeof value === "object") {
      const file = value as Partial<ApplicationResumeFile>;
      if (
        (file.format === "pdf" || file.format === "docx") &&
        typeof file.contentBase64 === "string" &&
        typeof file.sha256 === "string" &&
        typeof file.fileName === "string" &&
        typeof file.mediaType === "string" &&
        typeof file.sizeBytes === "number"
      ) {
        return { ok: true, file: file as ApplicationResumeFile };
      }
      return { ok: false, message: "That did not go through. Try again." };
    }
    const code =
      value && typeof value === "object" ? String((value as { code?: unknown }).code ?? "") : "";
    return { ok: false, message: applicationsProblemCopy(code) };
  } catch {
    return { ok: false, message: "That did not go through. Try again." };
  }
}
