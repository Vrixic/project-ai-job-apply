import { resolveProductBrand } from "@ai-job-apply/config/brand";
import { redirect } from "next/navigation";
import { getAuth0Client, isAuth0Configured } from "../lib/auth0";
import { CandidateRightsPanel } from "./candidate-rights-panel";
import { EntitlementStatus } from "./entitlement-status";
import { JobSearchForm } from "./job-search-form";
import { LandingPage } from "./landing-page";
import { SavedJobsPanel } from "./saved-jobs-panel";

export const dynamic = "force-dynamic";

const productBrand = resolveProductBrand({
  name: process.env.NEXT_PUBLIC_PRODUCT_BRAND_NAME,
  candidateDomain: process.env.NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN,
});

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

  if (session) {
    redirect("/jobs");
  }

  // Only reachable when Auth0 is not configured (local/test): a minimal, unauthenticated fallback.
  return (
    <main>
      <section className="eyebrow">{productBrand.name}</section>
      <h1>Tell us what work fits you.</h1>
      <p className="lede">
        These preferences will eventually drive fresh job discovery and rapid, tailored
        applications. Application history stops at confirmed submission.
      </p>

      {authenticationFailed && (
        <aside>
          <strong>Sign-in was not completed.</strong>
          <p>
            The account may be unavailable or blocked. Try again after confirming the account is
            active.
          </p>
        </aside>
      )}

      <JobSearchForm authenticated={false} />
      <SavedJobsPanel authenticated={false} />
      <EntitlementStatus authenticated={false} />
      <CandidateRightsPanel authenticated={false} />

      <aside>
        Auth0 client credentials are not configured. The application fails closed; browser
        development tokens are not supported.
      </aside>
    </main>
  );
}
