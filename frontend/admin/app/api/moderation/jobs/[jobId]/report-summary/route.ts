import { forwardModeration, moderationId } from "../../../../../../lib/moderation-bff";
import { moderationDependencies } from "../../../../../../lib/moderation-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const jobId = moderationId((await context.params).jobId);
  if (!jobId) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:invalid_request",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        traceId: crypto.randomUUID(),
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  return forwardModeration(
    request,
    {
      path: `/v1/admin/moderation/jobs/${jobId}/report-summary`,
      method: "GET",
      responseKind: "summary",
    },
    moderationDependencies(),
  );
}
