import { getAuth0Client } from "../../../../lib/auth0";
import { isLocalAuth0ConformanceEnabled } from "../../../../lib/auth0-conformance";
import { verifyJobReadAuthorization } from "../../../../lib/job-read-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return verifyJobReadAuthorization(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getAuth0Client(),
    enabled: isLocalAuth0ConformanceEnabled(),
    fetch: globalThis.fetch,
    platformBaseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
  });
}
