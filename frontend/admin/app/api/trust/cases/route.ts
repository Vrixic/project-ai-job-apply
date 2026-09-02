import { forwardTrust } from "../../../../lib/trust-bff";
import { trustDependencies } from "../../../../lib/trust-route";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return forwardTrust(
    request,
    { path: "/v1/admin/trust/cases", method: "POST", requestKind: "open" },
    trustDependencies(),
  );
}
