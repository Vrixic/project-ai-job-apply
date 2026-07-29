import { getAuth0Client } from "../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return forwardPlatformRequest(
    "/v1/me/job-preferences",
    { method: "GET" },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}

export async function PUT(request: Request): Promise<Response> {
  return forwardPlatformRequest(
    "/v1/me/job-preferences",
    {
      method: "PUT",
      body: await request.text(),
      headers: {
        "content-type": "application/json",
        ...(request.headers.get("idempotency-key")
          ? { "idempotency-key": request.headers.get("idempotency-key") as string }
          : {}),
      },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}
