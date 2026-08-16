import { getAuth0Client } from "../../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";
import { readSavedJobBody } from "../../../../../lib/saved-jobs-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const decoded = await readSavedJobBody(request);
  if ("failure" in decoded) return decoded.failure;
  return forwardPlatformRequest(
    "/v1/saved-jobs/search",
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: { "content-type": "application/json" },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}
