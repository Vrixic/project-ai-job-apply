import { forwardTrust, trustId, trustProblem } from "../../../../../../lib/trust-bff";
import { trustDependencies } from "../../../../../../lib/trust-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const caseId = trustId((await context.params).caseId);
  if (!caseId) return trustProblem(400, "invalid_request", "Invalid request");
  return forwardTrust(
    request,
    {
      path: `/v1/admin/trust/cases/${caseId}/appeal-resolution`,
      method: "POST",
      requestKind: "resolveAppeal",
    },
    trustDependencies(),
  );
}
