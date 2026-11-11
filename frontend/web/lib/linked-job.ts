const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * The job a jobs-page link points at: `?job=<id>` is that job's own page, and `&application=<id>` also
 * opens the candidate's application for it. Anything else, an application without its job, another
 * parameter, a repeated one or a value that is not an identifier, is no link at all.
 */
export function linkedJob(
  query: Readonly<Record<string, string | string[] | undefined>>,
): { jobId: string; applicationId?: string } | undefined {
  const { job, application } = query;
  if (!Object.keys(query).every((key) => key === "job" || key === "application")) return undefined;
  if (typeof job !== "string" || !UUID.test(job)) return undefined;
  if (application === undefined) return { jobId: job };
  return typeof application === "string" && UUID.test(application)
    ? { jobId: job, applicationId: application }
    : undefined;
}
