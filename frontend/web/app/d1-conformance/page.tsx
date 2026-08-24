import { notFound } from "next/navigation";
import { getAuth0Client, isAuth0Configured } from "../../lib/auth0";
import { isD1WorkloadConformanceEnabled } from "../../lib/d1-workload-conformance";
import { D1WorkloadPanel } from "./d1-workload-panel";

export const dynamic = "force-dynamic";

export default async function D1ConformancePage() {
  if (!isD1WorkloadConformanceEnabled()) notFound();
  const authConfigured = isAuth0Configured();
  const session = authConfigured ? await getAuth0Client().getSession() : null;
  return <D1WorkloadPanel authenticated={Boolean(session)} />;
}
