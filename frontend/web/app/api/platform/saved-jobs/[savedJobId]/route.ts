import { getAuth0Client } from "../../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";
import { savedJobIdentifier } from "../../../../../lib/saved-jobs-bff";

export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json(
    {
      type: "urn:ai-job-apply:problem:platform_unavailable",
      title: "The platform API is unavailable",
      status: 503,
      code: "platform_unavailable",
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A hostile or already-locked body must not replace the fixed boundary response.
  }
}

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
  const response = await forwardPlatformRequest(
    `/v1/saved-jobs/${savedJobId}`,
    { method: "DELETE", signal: request.signal },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  if (!response.ok) return response;
  if (response.status !== 204) {
    cancelBody(response);
    return unavailable();
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
