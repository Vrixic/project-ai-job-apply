import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
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
  const { operationId } = await context.params;
  if (!operationIdPattern.test(operationId)) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid operation identifier",
        status: 400,
        code: "invalid_request",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const response = await forwardPlatformRequest(
    `/v1/operations/${encodeURIComponent(operationId)}`,
    { method: "GET", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "Operation", request.signal);
}
