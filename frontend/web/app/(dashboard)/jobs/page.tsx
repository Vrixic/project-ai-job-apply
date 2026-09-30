import { JobsPageClient } from "./jobs-page-client";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  return <JobsPageClient authenticated />;
}
