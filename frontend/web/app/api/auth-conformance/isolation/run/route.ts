import { cookies } from "next/headers";
import { getLazyAuth0Session } from "../../../../../lib/auth0";
import {
  isCrossUserIsolationConformanceEnabled,
  runCrossUserIsolationProbe,
} from "../../../../../lib/cross-user-isolation-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  return runCrossUserIsolationProbe(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    cookieStore,
    enabled: isCrossUserIsolationConformanceEnabled(),
    fetch,
    issuer: `https://${process.env.AUTH0_DOMAIN ?? ""}/`,
    secret: process.env.AUTH0_SECRET ?? "",
  });
}
