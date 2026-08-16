import type { MatchAssessment, ProblemDetails } from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const MAXIMUM_RESPONSE_BYTES = 32 * 1024;
const validateMatchAssessment = compileComponentValidator("MatchAssessment");
const validateProblemDetails = compileComponentValidator("ProblemDetails");
const MATCH_ASSESSMENT_PROBLEMS = new Map<string, Readonly<{ code: string; title: string }>>([
  ["400:invalid_request", { code: "invalid_request", title: "Invalid request" }],
  [
    "401:authentication_required",
    { code: "authentication_required", title: "Authentication required" },
  ],
  ["401:session_expired", { code: "session_expired", title: "The session has expired" }],
  ["403:forbidden", { code: "forbidden", title: "Forbidden" }],
  ["404:match_job_unavailable", { code: "match_job_unavailable", title: "Job is unavailable" }],
  [
    "409:match_preferences_required",
    { code: "match_preferences_required", title: "Job preferences are required" },
  ],
  [
    "409:match_preferences_require_review",
    { code: "match_preferences_require_review", title: "Job preferences require review" },
  ],
  [
    "503:match_assessment_unavailable",
    { code: "match_assessment_unavailable", title: "Match assessment unavailable" },
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

export function matchAssessmentJobId(value: string): string | undefined {
  return UUID_V7_PATTERN.test(value) ? value : undefined;
}

function exactDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function exactAssessment(value: unknown, requestedJobId: string): value is MatchAssessment {
  if (!validateMatchAssessment(value)) return false;
  const assessment = value as MatchAssessment;
  if (
    assessment.requestedJobId !== requestedJobId ||
    !exactDateTime(assessment.preferenceUpdatedAt) ||
    !exactDateTime(assessment.assessedAt) ||
    Date.parse(assessment.preferenceUpdatedAt) > Date.parse(assessment.assessedAt)
  ) {
    return false;
  }
  try {
    const revision = BigInt(assessment.catalogRevision);
    return revision >= 1n && revision <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

export function rejectMatchAssessmentInput(request: Request): Response | undefined {
  if (
    new URL(request.url).search.length > 0 ||
    request.body !== null ||
    (request.headers.get("content-length") !== null &&
      request.headers.get("content-length") !== "0") ||
    request.headers.get("transfer-encoding") !== null
  ) {
    return problem(400, "invalid_request", "Invalid request");
  }
  return undefined;
}

async function boundedBody(response: Response, timeoutMilliseconds: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("The response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, timeoutMilliseconds);
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) throw new Error("The response body timed out");
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
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

export async function validateMatchAssessmentResponse(
  response: Response,
  requestedJobId: string,
  timeoutMilliseconds = 10_000,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const declaredLength = response.headers.get("content-length");
  if (
    (response.status === 200
      ? !JSON_CONTENT_TYPE_PATTERN.test(contentType)
      : !/^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) ||
    (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES))
  ) {
    await response.body?.cancel();
    return problem(503, "match_assessment_unavailable", "Match assessment unavailable");
  }
  try {
    const bytes = await boundedBody(response, timeoutMilliseconds);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    const success = response.status === 200;
    let projected: unknown;
    if (success) {
      if (!exactAssessment(value, requestedJobId)) {
        throw new Error("The match assessment response is invalid");
      }
      projected = value;
    } else {
      if (!validateProblemDetails(value)) {
        throw new Error("The match assessment problem is invalid");
      }
      const upstreamProblem = value as ProblemDetails;
      const declaredProblem = MATCH_ASSESSMENT_PROBLEMS.get(
        `${response.status}:${upstreamProblem.code}`,
      );
      if (
        upstreamProblem.status !== response.status ||
        declaredProblem === undefined ||
        upstreamProblem.type !== `urn:ai-job-apply:problem:${declaredProblem.code}`
      ) {
        throw new Error("The match assessment problem is undeclared");
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
    return problem(503, "match_assessment_unavailable", "Match assessment unavailable");
  }
}
