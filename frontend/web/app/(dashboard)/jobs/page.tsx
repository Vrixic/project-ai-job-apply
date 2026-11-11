import { linkedJob } from "../../../lib/linked-job";
import { JobsPageClient } from "./jobs-page-client";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const job = linkedJob(await searchParams);
  return <JobsPageClient authenticated {...(job ? { initialJob: job } : {})} />;
}
