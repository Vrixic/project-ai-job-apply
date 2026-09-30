import { cookies } from "next/headers";
import { getAuth0Client, isAuth0Configured } from "../lib/auth0";
import { isLocalAuth0ConformanceEnabled } from "../lib/auth0-conformance";
import {
  CROSS_USER_PROBE_COOKIE_NAME,
  isCrossUserIsolationConformanceEnabled,
} from "../lib/cross-user-isolation-conformance";
import { isPhase0WorkloadConformanceEnabled } from "../lib/phase0-workload-conformance";
import { isRestrictedAnswerVaultUiEnabled } from "../lib/restricted-answer-fields";
import { FoundationForm } from "./foundation-form";
import { LandingPage } from "./landing-page";

export const dynamic = "force-dynamic";

export default async function FoundationPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const authConfigured = isAuth0Configured();
  const session = authConfigured ? await getAuth0Client().getSession() : null;
  const authenticationFailed = parameters.auth_error === "authentication_failed";

  if (authConfigured && !session) {
    return <LandingPage authenticationFailed={authenticationFailed} />;
  }

  const isolationConformanceEnabled = isCrossUserIsolationConformanceEnabled();
  const cookieStore = isolationConformanceEnabled ? await cookies() : undefined;
  const displayName =
    typeof session?.user.name === "string" ? { displayName: session.user.name } : {};

  return (
    <FoundationForm
      authConfigured={authConfigured}
      authenticated={Boolean(session)}
      authConformanceEnabled={isLocalAuth0ConformanceEnabled()}
      authenticationFailed={authenticationFailed}
      crossUserProbeArmed={Boolean(cookieStore?.get(CROSS_USER_PROBE_COOKIE_NAME))}
      restrictedAnswerVaultUiEnabled={isRestrictedAnswerVaultUiEnabled()}
      workloadConformanceEnabled={isPhase0WorkloadConformanceEnabled()}
      {...displayName}
    />
  );
}
