import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

const factIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ factId: string }> },
): Promise<Response> {
  const { factId } = await context.params;
  if (!factIdPattern.test(factId)) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid profile fact identifier",
        status: 400,
        code: "invalid_request",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const decoded = await readFoundationWriteRequest(request, "UpdateProfileFactRequest");
  if ("failure" in decoded) return decoded.failure;

  const response = await forwardPlatformRequest(
    `/v1/profile/facts/${encodeURIComponent(factId)}`,
    {
      method: "PATCH",
      body: decoded.body,
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": decoded.idempotencyKey,
      },
    },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "ProfileFact", request.signal);
}
