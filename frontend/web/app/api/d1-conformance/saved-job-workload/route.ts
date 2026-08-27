import { getLazyAuth0Session } from "../../../../lib/auth0";
import {
  d1WorkloadConcurrency,
  isD1WorkloadConformanceEnabled,
  runD1SavedJobLifecycleWorkload,
} from "../../../../lib/d1-workload-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runD1SavedJobLifecycleWorkload(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    concurrency: d1WorkloadConcurrency(process.env.D1_WORKLOAD_ENVIRONMENT),
    enabled: isD1WorkloadConformanceEnabled(),
    fetch,
  });
}
