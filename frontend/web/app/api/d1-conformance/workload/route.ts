import { getLazyAuth0Session } from "../../../../lib/auth0";
import {
  d1WorkloadConcurrency,
  isD1WorkloadConformanceEnabled,
  runD1ReadWorkload,
} from "../../../../lib/d1-workload-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const enabled = isD1WorkloadConformanceEnabled();
  return runD1ReadWorkload(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    concurrency: d1WorkloadConcurrency(process.env.D1_WORKLOAD_ENVIRONMENT),
    enabled,
    fetch,
  });
}
