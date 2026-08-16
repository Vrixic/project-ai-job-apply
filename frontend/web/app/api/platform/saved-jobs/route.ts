import { getAuth0Client } from "../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../lib/platform-api";
import { forwardIdempotencyKey, readSavedJobBody } from "../../../../lib/saved-jobs-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const decoded = await readSavedJobBody(request);
  if ("failure" in decoded) return decoded.failure;
  const idempotencyKey = forwardIdempotencyKey(request);
  if (!idempotencyKey) {
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
    "/v1/saved-jobs",
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}
