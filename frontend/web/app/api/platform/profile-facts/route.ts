import { getLazyAuth0Session } from "../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

function dependencies() {
  return {
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    fetch,
  };
}

export async function GET(request?: Request): Promise<Response> {
  const response = await forwardPlatformRequest(
    "/v1/profile/facts",
    { method: "GET" },
    dependencies(),
  );
  return validateFoundationResponse(response, 200, "ProfileFactCollection", request?.signal);
}

export async function POST(request: Request): Promise<Response> {
  const decoded = await readFoundationWriteRequest(request, "CreateProfileFactRequest");
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    "/v1/profile/facts",
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": decoded.idempotencyKey,
      },
    },
    dependencies(),
  );
  return validateFoundationResponse(response, 201, "ProfileFact", request.signal);
}
