import { forwardBillingSession } from "../../../../../lib/billing-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return forwardBillingSession(request, "portal-sessions");
}
