import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { rejectJobDetailInput, validateJobDetailResponse } from "../../../../../lib/job-detail-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const rejected = rejectJobDetailInput(request, jobId);
  if (rejected) return rejected;
  const response = await forwardPlatformRequest(
    `/v1/jobs/${jobId}`,
    { method: "GET", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateJobDetailResponse(response, request.signal);
}
