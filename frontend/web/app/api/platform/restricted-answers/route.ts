import { getLazyAuth0Session } from "../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../lib/foundation-response-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";
import { isRestrictedAnswerVaultUiEnabled } from "../../../../lib/restricted-answer-fields";

export const dynamic = "force-dynamic";

function invalidRequest(): Response {
  return Response.json(
    {
      type: "urn:ai-job-apply:problem:invalid_request",
      title: "Invalid request",
      status: 400,
      code: "invalid_request",
    },
    {
      status: 400,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isRestrictedAnswerVaultUiEnabled()) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:not_found",
        title: "Not found",
        status: 404,
        code: "not_found",
      },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  if (new URL(request.url).search.length > 0) return invalidRequest();
  const response = await forwardPlatformRequest(
    "/v1/profile/restricted-answers",
    { method: "GET", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "RestrictedAnswerCollection", request.signal);
}
