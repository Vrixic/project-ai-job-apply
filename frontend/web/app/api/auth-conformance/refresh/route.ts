import { getAuth0Client } from "../../../../lib/auth0";
import {
  forceWebSessionRenewal,
  isLocalAuth0ConformanceEnabled,
} from "../../../../lib/auth0-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const enabled = isLocalAuth0ConformanceEnabled();
  if (!enabled) {
    return Response.json(
      { state: "unavailable", message: "Not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  return forceWebSessionRenewal(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getAuth0Client(),
    enabled,
  });
}
