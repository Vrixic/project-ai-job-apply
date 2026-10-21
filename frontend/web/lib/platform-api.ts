interface PlatformAuthSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface PlatformRequestDependencies {
  auth0: PlatformAuthSession;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  random?: () => number;
  retryDelaysMilliseconds?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMilliseconds?: number;
  includeReauthenticationProof?: boolean;
}

const defaultReadRetryDelaysMilliseconds = [250, 750, 1_500] as const;
const transientReadStatuses = new Set([429, 500, 502, 503, 504]);
const maximumProblemBytes = 16 * 1024;
const problemContentTypePattern = /^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i;
const jobReadAuthorizationProbePath = "/v1/jobs/00000000-0000-7000-8000-000000000000";
const reauthenticationHeader = "x-ai-job-apply-reauthentication";
const maximumReauthenticationTokenBytes = 16 * 1024;
const compactJwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

interface DeclaredProblem {
  code: string;
  title: string;
}

const declaredProblems = new Map<string, Readonly<DeclaredProblem>>([
  ["400:invalid_request", { code: "invalid_request", title: "Invalid request" }],
  ["400:invalid_job_search", { code: "invalid_job_search", title: "Invalid job search" }],
  [
    "400:invalid_saved_job_cursor",
    { code: "invalid_saved_job_cursor", title: "Invalid saved-job cursor" },
  ],
  [
    "401:authentication_required",
    { code: "authentication_required", title: "Authentication required" },
  ],
  ["403:forbidden", { code: "forbidden", title: "Forbidden" }],
  [
    "403:account_quarantined",
    { code: "account_quarantined", title: "Account deletion is in progress" },
  ],
  ["404:not_found", { code: "not_found", title: "Not found" }],
  [
    "404:saved_job_target_unavailable",
    { code: "saved_job_target_unavailable", title: "Job is unavailable" },
  ],
  [
    "404:job_report_target_unavailable",
    { code: "job_report_target_unavailable", title: "Job is unavailable" },
  ],
  ["404:match_job_unavailable", { code: "match_job_unavailable", title: "Job is unavailable" }],
  ["409:idempotency_conflict", { code: "idempotency_conflict", title: "Idempotency key conflict" }],
  [
    "409:candidate_rights_state_conflict",
    { code: "candidate_rights_state_conflict", title: "Candidate rights state changed" },
  ],
  ["409:version_conflict", { code: "version_conflict", title: "Profile fact changed" }],
  [
    "409:profile_fact_transition_conflict",
    { code: "profile_fact_transition_conflict", title: "Profile fact transition conflict" },
  ],
  ["409:resume_document_limit", { code: "resume_document_limit", title: "Resume limit reached" }],
  [
    "409:resume_upload_in_progress",
    { code: "resume_upload_in_progress", title: "A resume is still being processed" },
  ],
  [
    "409:resume_not_deletable",
    { code: "resume_not_deletable", title: "A resume is still being processed" },
  ],
  [
    "409:job_search_catalog_changed",
    { code: "job_search_catalog_changed", title: "Job catalog changed" },
  ],
  ["409:job_already_reported", { code: "job_already_reported", title: "Job already reported" }],
  [
    "409:job_report_limit_reached",
    { code: "job_report_limit_reached", title: "Job-report limit reached" },
  ],
  [
    "409:match_preferences_required",
    { code: "match_preferences_required", title: "Job preferences are required" },
  ],
  [
    "409:match_preferences_require_review",
    { code: "match_preferences_require_review", title: "Job preferences require review" },
  ],
  [
    "409:saved_job_limit_reached",
    { code: "saved_job_limit_reached", title: "Saved-job limit reached" },
  ],
  [
    "409:saved_job_command_limit_reached",
    { code: "saved_job_command_limit_reached", title: "Saved-job command limit reached" },
  ],
  ["409:saved_jobs_changed", { code: "saved_jobs_changed", title: "Saved jobs changed" }],
  [
    "400:invalid_application_cursor",
    { code: "invalid_application_cursor", title: "Invalid application cursor" },
  ],
  [
    "400:invalid_application_packet",
    { code: "invalid_application_packet", title: "Invalid application packet" },
  ],
  ["404:application_not_found", { code: "application_not_found", title: "Application not found" }],
  [
    "404:application_job_unavailable",
    { code: "application_job_unavailable", title: "Job is unavailable" },
  ],
  [
    "409:application_revision_conflict",
    { code: "application_revision_conflict", title: "Application changed" },
  ],
  [
    "409:application_already_exists",
    { code: "application_already_exists", title: "Application already exists" },
  ],
  [
    "409:application_limit_reached",
    { code: "application_limit_reached", title: "Application limit reached" },
  ],
  ["409:application_packet_stale", { code: "application_packet_stale", title: "Packet is stale" }],
  [
    "409:application_resume_too_large",
    { code: "application_resume_too_large", title: "Uploaded resume is too large" },
  ],
  [
    "409:application_approval_refused",
    { code: "application_approval_refused", title: "Approval refused" },
  ],
  [
    "409:application_state_conflict",
    { code: "application_state_conflict", title: "Application state conflict" },
  ],
  [
    "409:application_attempt_refused",
    { code: "application_attempt_refused", title: "Attempt refused" },
  ],
  [
    "503:application_integrity_failure",
    { code: "application_integrity_failure", title: "Application unavailable" },
  ],
  [
    "503:applications_unavailable",
    { code: "applications_unavailable", title: "Applications are unavailable" },
  ],
  ["413:payload_too_large", { code: "payload_too_large", title: "Payload too large" }],
  [
    "415:unsupported_media_type",
    { code: "unsupported_media_type", title: "Unsupported media type" },
  ],
  [
    "503:document_intake_unavailable",
    { code: "document_intake_unavailable", title: "Resume intake is unavailable" },
  ],
  [
    "503:job_search_unavailable",
    { code: "job_search_unavailable", title: "Job search is unavailable" },
  ],
  [
    "503:job_reporting_unavailable",
    { code: "job_reporting_unavailable", title: "Job reporting unavailable" },
  ],
  [
    "503:match_assessment_unavailable",
    { code: "match_assessment_unavailable", title: "Match assessment unavailable" },
  ],
  [
    "503:entitlement_unavailable",
    { code: "entitlement_unavailable", title: "Entitlement status unavailable" },
  ],
  [
    "503:candidate_rights_unavailable",
    { code: "candidate_rights_unavailable", title: "Candidate rights service unavailable" },
  ],
]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canRetry(method: string | undefined): boolean {
  return method === undefined || method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
}

function sessionReauthenticationProof(session: unknown): string | undefined {
  if (!session || typeof session !== "object" || Array.isArray(session)) return undefined;
  const tokenSet = (session as Record<string, unknown>).tokenSet;
  if (!tokenSet || typeof tokenSet !== "object" || Array.isArray(tokenSet)) return undefined;
  const idToken = (tokenSet as Record<string, unknown>).idToken;
  return typeof idToken === "string" &&
    idToken.length >= 32 &&
    idToken.length <= maximumReauthenticationTokenBytes &&
    compactJwtPattern.test(idToken)
    ? idToken
    : undefined;
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup only.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup only.
  }
}

function statusOnlyProbeResponse(response: Response): Response {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // The local conformance probe uses only the status and must never wait for or expose this body.
  }
  return new Response(null, {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    cancelReader(reader);
    throw new Error("The platform problem read was aborted");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = <Value>(callback: (value: Value) => void, value: Value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      cancelReader(reader);
      settle(reject, new Error("The platform problem read was aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (value) => settle(resolve, value),
      (error: unknown) => settle(reject, error),
    );
  });
}

async function readBoundedProblem(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!problemContentTypePattern.test(contentType)) {
    cancelBody(response);
    throw new Error("The platform problem content type is invalid");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumProblemBytes
    ) {
      cancelBody(response);
      throw new Error("The platform problem content length is invalid");
    }
  }

  if (!response.body) {
    throw new Error("The platform problem body is missing");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await readChunk(reader, signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumProblemBytes) {
        cancelReader(reader);
        throw new Error("The platform problem body is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // An aborted hostile stream may retain a pending read; cancellation remains best-effort.
    }
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  return JSON.parse(text) as unknown;
}

async function projectPlatformProblem(response: Response, signal: AbortSignal): Promise<Response> {
  try {
    const value = await readBoundedProblem(response, signal);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The platform problem is invalid");
    }
    const upstream = value as Record<string, unknown>;
    if (
      typeof upstream.code !== "string" ||
      typeof upstream.type !== "string" ||
      typeof upstream.title !== "string" ||
      typeof upstream.traceId !== "string" ||
      upstream.status !== response.status
    ) {
      throw new Error("The platform problem is invalid");
    }
    const declared = declaredProblems.get(`${response.status}:${upstream.code}`);
    if (!declared || upstream.type !== `urn:ai-job-apply:problem:${declared.code}`) {
      throw new Error("The platform problem is undeclared");
    }
    return problem(response.status, declared.code, declared.title);
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
}

function platformBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  ) {
    throw new Error("PLATFORM_API_BASE_URL must use HTTPS except on localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PLATFORM_API_BASE_URL cannot contain credentials, a query, or a fragment");
  }
  return url;
}

export async function forwardPlatformRequest(
  path: string,
  init: RequestInit,
  dependencies: PlatformRequestDependencies,
): Promise<Response> {
  let session: unknown | null;
  try {
    session = await dependencies.auth0.getSession();
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  if (!session) {
    return problem(401, "authentication_required", "Authentication required");
  }

  const reauthenticationProof = dependencies.includeReauthenticationProof
    ? sessionReauthenticationProof(session)
    : undefined;
  if (dependencies.includeReauthenticationProof && !reauthenticationProof) {
    return problem(401, "authentication_required", "Authentication required");
  }

  let token: string;
  try {
    ({ token } = await dependencies.auth0.getAccessToken());
  } catch {
    return problem(401, "session_expired", "The session has expired");
  }

  let baseUrl: URL;
  try {
    baseUrl = platformBaseUrl(dependencies.baseUrl);
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  const retryDelays = canRetry(init.method)
    ? (dependencies.retryDelaysMilliseconds ?? defaultReadRetryDelaysMilliseconds)
    : [];
  const random = dependencies.random ?? Math.random;
  const wait = dependencies.sleep ?? sleep;
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    dependencies.timeoutMilliseconds ?? 10_000,
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;
  let response: Response | undefined;

  try {
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        response = await dependencies.fetch(new URL(path, baseUrl), {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal,
          headers: {
            ...init.headers,
            authorization: `Bearer ${token}`,
            ...(reauthenticationProof ? { [reauthenticationHeader]: reauthenticationProof } : {}),
          },
        });
      } catch {
        response = undefined;
      }

      const delay = retryDelays[attempt];
      if (response && (!transientReadStatuses.has(response.status) || delay === undefined)) {
        break;
      }
      if (delay === undefined || signal.aborted) {
        return problem(503, "platform_unavailable", "The platform API is unavailable");
      }
      if (response) cancelBody(response);
      await wait(Math.round(delay / 2 + random() * (delay / 2)));
    }

    if (!response) {
      return problem(503, "platform_unavailable", "The platform API is unavailable");
    }

    if (path === jobReadAuthorizationProbePath && init.method?.toUpperCase() === "GET") {
      return statusOnlyProbeResponse(response);
    }

    if (!response.ok) {
      return await projectPlatformProblem(response, signal);
    }

    const headers = new Headers({ "cache-control": "no-store" });
    const contentType = response.headers.get("content-type");
    const correlationId = response.headers.get("x-correlation-id");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    if (correlationId) {
      headers.set("x-correlation-id", correlationId);
    }
    return new Response(response.body, { status: response.status, headers });
  } finally {
    clearTimeout(timeout);
  }
}
