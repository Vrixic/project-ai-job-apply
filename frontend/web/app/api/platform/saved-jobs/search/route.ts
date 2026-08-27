import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";
import { readSavedJobBody } from "../../../../../lib/saved-jobs-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const decoded = await readSavedJobBody(request);
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    "/v1/saved-jobs/search",
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: { "content-type": "application/json" },
    },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "SavedJobPage", request.signal);
}
