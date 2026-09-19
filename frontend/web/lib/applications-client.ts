import type { Application } from "@ai-job-apply/api-contracts";

/**
 * Browser-side calls to the Applications BFF. Every command carries an idempotency key that is
 * stable for one user action at one application revision, so a double click replays instead of
 * repeating. Failures collapse to fixed, candidate-safe copy; no upstream text is displayed.
 */

export type ApplicationsCallResult =
  | { ok: true; application: Application }
  | { ok: false; status: number; code: string; message: string };

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
    if (response.ok && value && typeof value === "object" && "id" in value) {
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

/** One key per user action at one revision: a repeated click replays the same command. */
export function commandKey(action: string, applicationId: string, revision: number): string {
  return `web-${action}-${revision}-${applicationId}`.slice(0, 128);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
