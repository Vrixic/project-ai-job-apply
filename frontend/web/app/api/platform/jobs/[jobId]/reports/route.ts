import { getLazyAuth0Session } from "../../../../../../lib/auth0";
import {
  jobReportIdempotencyKey,
  jobReportJobId,
  readJobReportRequest,
  validateJobReportResponse,
} from "../../../../../../lib/job-report-bff";
import { forwardPlatformRequest } from "../../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

function localProblem(status: number, code: string, title: string): Response {
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

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const jobId = jobReportJobId((await context.params).jobId);
  if (!jobId) return localProblem(400, "invalid_request", "Invalid request");
  const auth0 = getLazyAuth0Session();
  try {
    if (!(await auth0.getSession())) {
      return localProblem(401, "authentication_required", "Authentication required");
    }
  } catch {
    return localProblem(503, "platform_unavailable", "The platform API is unavailable");
  }
  const idempotencyKey = jobReportIdempotencyKey(request);
  if (!idempotencyKey) return localProblem(400, "invalid_request", "Invalid request");
  const decoded = await readJobReportRequest(request);
  if ("failure" in decoded) return decoded.failure;

  const response = await forwardPlatformRequest(
    `/v1/jobs/${jobId}/reports`,
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    },
    {
      auth0,
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateJobReportResponse(response, jobId, decoded.report.reason);
}
