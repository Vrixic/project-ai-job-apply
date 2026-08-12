import { getAuth0Client } from "../../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

const factIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ factId: string }> },
): Promise<Response> {
  const { factId } = await context.params;
  if (!factIdPattern.test(factId)) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid profile fact identifier",
        status: 400,
        code: "invalid_request",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  return forwardPlatformRequest(
    `/v1/profile/facts/${encodeURIComponent(factId)}`,
    {
      method: "PATCH",
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
