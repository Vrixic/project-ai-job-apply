import { cookies } from "next/headers";
import { isLocalAuth0ConformanceEnabled } from "../../../lib/auth0-conformance";
import {
  CROSS_USER_PROBE_COOKIE_NAME,
  isCrossUserIsolationConformanceEnabled,
} from "../../../lib/cross-user-isolation-conformance";
import { isPhase0WorkloadConformanceEnabled } from "../../../lib/phase0-workload-conformance";
import { SettingsPageClient } from "./settings-page-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const isolationConformanceEnabled = isCrossUserIsolationConformanceEnabled();
  const cookieStore = isolationConformanceEnabled ? await cookies() : undefined;

  return (
    <SettingsPageClient
      authenticated
      authConformanceEnabled={isLocalAuth0ConformanceEnabled()}
      crossUserProbeArmed={Boolean(cookieStore?.get(CROSS_USER_PROBE_COOKIE_NAME))}
      workloadConformanceEnabled={isPhase0WorkloadConformanceEnabled()}
    />
  );
}
