import type { CanonicalJobDetail } from "./index.js";

/** Existing job-revision.v1 bytes: keys are in the owning canonical serializer's sorted order. */
export function activeJobRevisionDigestInput(
  job: Pick<CanonicalJobDetail, "id" | "company" | "title" | "locations" | "department">,
): string {
  return JSON.stringify({
    job: {
      active: true,
      company: { id: job.company.id, name: job.company.name },
      department: job.department ?? null,
      id: job.id,
      locations: job.locations,
      title: job.title,
    },
    schema: "job-revision.v1",
  });
}
