import { getAuth0Client } from "../../../../lib/auth0";
import { validateFoundationResponse } from "../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const decoded = await readFoundationWriteRequest(request, "CreateCandidateDataExportRequest");
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    "/v1/me/data-exports",
    {
      method: "POST",
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
      includeReauthenticationProof: true,
    },
  );
  return validateFoundationResponse(response, 202, "CandidateDataExport", request.signal);
}
