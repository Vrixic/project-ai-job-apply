import { JobsPageClient } from "./jobs-page-client";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const application =
    typeof query.application === "string" &&
    uuid.test(query.application) &&
    typeof query.job === "string" &&
    uuid.test(query.job) &&
    Object.keys(query).every((key) => ["application", "job"].includes(key))
      ? { id: query.application, jobId: query.job }
      : undefined;
  return (
    <JobsPageClient authenticated {...(application ? { initialApplication: application } : {})} />
  );
}
