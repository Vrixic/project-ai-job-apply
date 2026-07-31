import { getAuth0Client } from "../../../../lib/auth0";
import {
  isStagingWorkloadConformanceEnabled,
  runStagingFoundationWorkload,
} from "../../../../lib/staging-workload-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const enabled = isStagingWorkloadConformanceEnabled();
  return runStagingFoundationWorkload(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getAuth0Client(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    enabled,
    fetch,
  });
}
