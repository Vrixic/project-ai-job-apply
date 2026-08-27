import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { readJobSearchBffBody } from "../../../../../lib/job-search-bff";
import { validateJobSearchResponse } from "../../../../../lib/job-search-response-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const decoded = await readJobSearchBffBody(request);
  if ("failure" in decoded) {
    return decoded.failure;
  }
  const response = await forwardPlatformRequest(
    "/v1/jobs/search",
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
  return validateJobSearchResponse(response, request.signal);
}
