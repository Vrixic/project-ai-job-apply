import { cookies } from "next/headers";
import { getAuth0Client, isAuth0Configured } from "../lib/auth0";
import { isLocalAuth0ConformanceEnabled } from "../lib/auth0-conformance";
import {
  CROSS_USER_PROBE_COOKIE_NAME,
  isCrossUserIsolationConformanceEnabled,
} from "../lib/cross-user-isolation-conformance";
import { isStagingWorkloadConformanceEnabled } from "../lib/staging-workload-conformance";
import { FoundationForm } from "./foundation-form";

export const dynamic = "force-dynamic";

export default async function FoundationPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const authConfigured = isAuth0Configured();
  const session = authConfigured ? await getAuth0Client().getSession() : null;
  const isolationConformanceEnabled = isCrossUserIsolationConformanceEnabled();
  const cookieStore = isolationConformanceEnabled ? await cookies() : undefined;
  const displayName =
    typeof session?.user.name === "string" ? { displayName: session.user.name } : {};

  return (
    <FoundationForm
      authConfigured={authConfigured}
      authenticated={Boolean(session)}
      authConformanceEnabled={isLocalAuth0ConformanceEnabled()}
      authenticationFailed={parameters.auth_error === "authentication_failed"}
      crossUserProbeArmed={Boolean(cookieStore?.get(CROSS_USER_PROBE_COOKIE_NAME))}
      workloadConformanceEnabled={isStagingWorkloadConformanceEnabled()}
      {...displayName}
    />
  );
}
