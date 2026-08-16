import { getAuth0Client } from "../../../../lib/auth0";
import { validateEntitlementReadRequest } from "../../../../lib/entitlement-read-bff";
import { forwardPlatformRequest } from "../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const failure = validateEntitlementReadRequest(request);
  if (failure) return failure;
  return forwardPlatformRequest(
    "/v1/entitlements",
    { method: "GET", signal: request.signal },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}
