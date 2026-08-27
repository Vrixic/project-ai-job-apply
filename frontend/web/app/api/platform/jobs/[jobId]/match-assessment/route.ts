import { getLazyAuth0Session } from "../../../../../../lib/auth0";
import {
  matchAssessmentJobId,
  rejectMatchAssessmentInput,
  validateMatchAssessmentResponse,
} from "../../../../../../lib/match-assessment-bff";
import { forwardPlatformRequest } from "../../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const rejected = rejectMatchAssessmentInput(request);
  if (rejected) return rejected;
  const jobId = matchAssessmentJobId((await context.params).jobId);
  if (!jobId) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        traceId: crypto.randomUUID(),
      },
      {
        status: 400,
        headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      },
    );
  }
  const response = await forwardPlatformRequest(
    `/v1/jobs/${jobId}/match-assessment`,
    { method: "GET", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateMatchAssessmentResponse(response, jobId);
}
