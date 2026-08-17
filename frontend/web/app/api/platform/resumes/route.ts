import { getAuth0Client } from "../../../../lib/auth0";
import { readFoundationWriteRequest } from "../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

function dependencies() {
  return {
    auth0: getAuth0Client(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    fetch,
  };
}

export async function GET(): Promise<Response> {
  return forwardPlatformRequest("/v1/resumes", { method: "GET" }, dependencies());
}

export async function POST(request: Request): Promise<Response> {
  const decoded = await readFoundationWriteRequest(request, "CreateResumeUploadRequest");
  if ("failure" in decoded) return decoded.failure;
  return forwardPlatformRequest(
    "/v1/resumes/uploads",
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
}
