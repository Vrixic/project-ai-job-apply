import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

const RESUME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidRequest(): Response {
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

function unavailable(): Response {
  return Response.json(
    {
      type: "urn:ai-job-apply:problem:platform_unavailable",
      title: "The platform API is unavailable",
      status: 503,
      code: "platform_unavailable",
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A hostile or already-locked body must not replace the fixed boundary response.
  }
}

/** Deletes one of the caller's resumes once processing has ended (ADR-033). The success is always a bodyless 204. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  if (new URL(request.url).search.length > 0) return invalidRequest();
  const documentId = (await context.params).documentId;
  if (!RESUME_ID_PATTERN.test(documentId)) return invalidRequest();
  const response = await forwardPlatformRequest(
    `/v1/resumes/${documentId}`,
    { method: "DELETE", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  if (!response.ok) return response;
  if (response.status !== 204) {
    cancelBody(response);
    return unavailable();
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
