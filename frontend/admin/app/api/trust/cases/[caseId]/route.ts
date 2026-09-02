import { forwardTrust, trustId, trustProblem } from "../../../../../lib/trust-bff";
import { trustDependencies } from "../../../../../lib/trust-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const caseId = trustId((await context.params).caseId);
  if (!caseId) {
    return trustProblem(400, "invalid_request", "Invalid request");
  }
  return forwardTrust(
    request,
    { path: `/v1/admin/trust/cases/${caseId}`, method: "GET" },
    trustDependencies(),
  );
}
