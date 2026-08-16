import { getAuth0Client } from "../../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";
import { savedJobIdentifier } from "../../../../../lib/saved-jobs-bff";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ savedJobId: string }> },
): Promise<Response> {
  if (new URL(request.url).search.length > 0) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const savedJobId = savedJobIdentifier((await context.params).savedJobId);
  if (!savedJobId) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  return forwardPlatformRequest(
    `/v1/saved-jobs/${savedJobId}`,
    { method: "DELETE", signal: request.signal },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}
