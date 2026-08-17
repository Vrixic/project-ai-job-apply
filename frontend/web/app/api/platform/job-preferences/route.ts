import { getAuth0Client } from "../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const response = await forwardPlatformRequest(
    "/v1/me/job-preferences",
    { method: "GET" },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "JobPreferenceSet");
}

export async function PUT(request: Request): Promise<Response> {
  const decoded = await readFoundationWriteRequest(request, "PutJobPreferencesRequest");
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    "/v1/me/job-preferences",
    {
      method: "PUT",
      body: decoded.body,
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": decoded.idempotencyKey,
      },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "PutJobPreferencesResponse", request.signal);
}
