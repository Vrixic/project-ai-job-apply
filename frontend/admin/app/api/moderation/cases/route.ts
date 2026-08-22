import { forwardModeration } from "../../../../lib/moderation-bff";
import { moderationDependencies } from "../../../../lib/moderation-route";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return forwardModeration(
    request,
    {
      path: "/v1/admin/moderation/cases",
      method: "POST",
      requestKind: "open",
      responseKind: "case",
    },
    moderationDependencies(),
  );
}
