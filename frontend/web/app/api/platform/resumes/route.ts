import { getAuth0Client } from "../../../../lib/auth0";
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
  return forwardPlatformRequest(
    "/v1/resumes/uploads",
    {
      method: "POST",
      body: await request.text(),
      headers: {
        "content-type": "application/json",
        ...(request.headers.get("idempotency-key")
          ? { "idempotency-key": request.headers.get("idempotency-key") as string }
          : {}),
      },
    },
    dependencies(),
  );
}
