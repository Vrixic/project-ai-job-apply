import type {
  CreateJobReportRequest,
  JobReport,
  ProblemDetails,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const PROBLEM_CONTENT_TYPE_PATTERN = /^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i;
const MAXIMUM_REQUEST_BYTES = 1024;
const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const validateCreateJobReportRequest = compileComponentValidator("CreateJobReportRequest");
const validateJobReport = compileComponentValidator("JobReport");
const validateProblemDetails = compileComponentValidator("ProblemDetails");

const JOB_REPORT_PROBLEMS = new Map<string, Readonly<{ code: string; title: string }>>([
  ["400:invalid_request", { code: "invalid_request", title: "Invalid request" }],
  [
    "401:authentication_required",
    { code: "authentication_required", title: "Authentication required" },
  ],
  ["401:session_expired", { code: "session_expired", title: "The session has expired" }],
  ["403:forbidden", { code: "forbidden", title: "Forbidden" }],
  [
    "404:job_report_target_unavailable",
    { code: "job_report_target_unavailable", title: "Job is unavailable" },
  ],
  ["409:idempotency_conflict", { code: "idempotency_conflict", title: "Request conflict" }],
  ["409:job_already_reported", { code: "job_already_reported", title: "Job already reported" }],
  [
    "409:job_report_limit_reached",
    { code: "job_report_limit_reached", title: "Job-report limit reached" },
  ],
  ["413:payload_too_large", { code: "payload_too_large", title: "Payload too large" }],
  [
    "415:unsupported_media_type",
    { code: "unsupported_media_type", title: "Unsupported media type" },
  ],
  [
    "503:job_reporting_unavailable",
    { code: "job_reporting_unavailable", title: "Job reporting unavailable" },
  ],
  [
    "503:platform_unavailable",
    { code: "platform_unavailable", title: "The platform API is unavailable" },
  ],
]);

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

function cancelBestEffort(cancellable: { cancel(): Promise<void> } | null): void {
  if (!cancellable) return;
  try {
    void cancellable.cancel().catch(() => undefined);
  } catch {
    return;
  }
}

export function jobReportJobId(value: string): string | undefined {
  return UUID_V7_PATTERN.test(value) ? value : undefined;
}

export function jobReportIdempotencyKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key");
  return value && value.length >= 16 && value.length <= 128 ? value : undefined;
}

class JobReportRequestTooLargeError extends Error {}

async function boundedRequestBody(
  request: Request,
  timeoutMilliseconds: number,
): Promise<Uint8Array> {
  if (!request.body) throw new Error("The request body is unavailable");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  let rejectInterruption: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const interrupt = () => {
    rejectInterruption(new Error("The request body was interrupted"));
    void reader.cancel().catch(() => undefined);
  };
  const timer = setTimeout(interrupt, timeoutMilliseconds);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) {
        complete = true;
        break;
      }
      total += part.value.byteLength;
      if (total > MAXIMUM_REQUEST_BYTES) {
        throw new JobReportRequestTooLargeError();
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", interrupt);
    if (!complete) void reader.cancel().catch(() => undefined);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function readJobReportRequest(
  request: Request,
  timeoutMilliseconds = 2_000,
): Promise<{ body: string; report: CreateJobReportRequest } | { failure: Response }> {
  if (new URL(request.url).search.length > 0) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(request.headers.get("content-type") ?? "")) {
    return { failure: problem(415, "unsupported_media_type", "Unsupported media type") };
  }
  if (request.headers.get("transfer-encoding") !== null) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_REQUEST_BYTES)
  ) {
    return { failure: problem(413, "payload_too_large", "Payload too large") };
  }
  try {
    const bytes = await boundedRequestBody(request, timeoutMilliseconds);
    if (bytes.byteLength === 0) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(body);
    if (!validateCreateJobReportRequest(value)) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    return { body, report: value as CreateJobReportRequest };
  } catch (error) {
    if (error instanceof JobReportRequestTooLargeError) {
      return { failure: problem(413, "payload_too_large", "Payload too large") };
    }
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
}

function exactDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

async function boundedBody(response: Response, timeoutMilliseconds: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("The response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    cancelBestEffort(reader);
  }, timeoutMilliseconds);
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) throw new Error("The response body timed out");
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        cancelBestEffort(reader);
        throw new Error("The response body is too large");
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function exactReport(
  value: unknown,
  requestedJobId: string,
  requestedReason: CreateJobReportRequest["reason"],
): value is JobReport {
  if (!validateJobReport(value)) return false;
  const report = value as JobReport;
  return (
    report.requestedJobId === requestedJobId &&
    report.reason === requestedReason &&
    exactDateTime(report.createdAt)
  );
}

export async function validateJobReportResponse(
  response: Response,
  requestedJobId: string,
  requestedReason: CreateJobReportRequest["reason"],
  timeoutMilliseconds = 10_000,
): Promise<Response> {
  const success = response.status === 201;
  const contentType = response.headers.get("content-type") ?? "";
  const declaredLength = response.headers.get("content-length");
  if (
    (success
      ? !JSON_CONTENT_TYPE_PATTERN.test(contentType)
      : !PROBLEM_CONTENT_TYPE_PATTERN.test(contentType)) ||
    (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES))
  ) {
    cancelBestEffort(response.body);
    return problem(503, "job_reporting_unavailable", "Job reporting unavailable");
  }

  try {
    const bytes = await boundedBody(response, timeoutMilliseconds);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    let projected: unknown;
    if (success) {
      if (!exactReport(value, requestedJobId, requestedReason)) {
        throw new Error("The job report response is invalid");
      }
      projected = value;
    } else {
      if (!validateProblemDetails(value)) {
        throw new Error("The job report problem is invalid");
      }
      const upstreamProblem = value as ProblemDetails;
      const declaredProblem = JOB_REPORT_PROBLEMS.get(`${response.status}:${upstreamProblem.code}`);
      if (
        upstreamProblem.status !== response.status ||
        declaredProblem === undefined ||
        upstreamProblem.type !== `urn:ai-job-apply:problem:${declaredProblem.code}`
      ) {
        throw new Error("The job report problem is undeclared");
      }
      projected = {
        type: `urn:ai-job-apply:problem:${declaredProblem.code}`,
        title: declaredProblem.title,
        status: response.status,
        code: declaredProblem.code,
        traceId: upstreamProblem.traceId,
      };
    }
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": success
        ? "application/json; charset=utf-8"
        : "application/problem+json; charset=utf-8",
    });
    const correlationId = response.headers.get("x-correlation-id");
    if (correlationId) headers.set("x-correlation-id", correlationId);
    return new Response(JSON.stringify(projected), { status: response.status, headers });
  } catch {
    return problem(503, "job_reporting_unavailable", "Job reporting unavailable");
  }
}
