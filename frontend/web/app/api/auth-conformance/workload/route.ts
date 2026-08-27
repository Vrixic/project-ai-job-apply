import { getLazyAuth0Session } from "../../../../lib/auth0";
import {
  isPhase0WorkloadConformanceEnabled,
  phase0WorkloadPublicConcurrency,
  runPhase0FoundationWorkload,
} from "../../../../lib/phase0-workload-conformance";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const enabled = isPhase0WorkloadConformanceEnabled();
  return runPhase0FoundationWorkload(request, {
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    enabled,
    fetch,
    publicConcurrency: phase0WorkloadPublicConcurrency(process.env.PHASE0_WORKLOAD_ENVIRONMENT),
  });
}
