import { forwardModeration, moderationId } from "../../../../../../lib/moderation-bff";
import { moderationDependencies } from "../../../../../../lib/moderation-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const caseId = moderationId((await context.params).caseId);
  if (!caseId) {
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
      path: `/v1/admin/moderation/cases/${caseId}/resolve`,
      method: "POST",
      requestKind: "resolve",
      responseKind: "case",
    },
    moderationDependencies(),
  );
}
