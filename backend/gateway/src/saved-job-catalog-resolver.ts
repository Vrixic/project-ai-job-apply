import type { CanonicalJobSummary } from "@ai-job-apply/api-contracts";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import type { SavedJobCatalogResolver } from "@ai-job-apply/matching-service";

export class JobCatalogSavedJobResolver implements SavedJobCatalogResolver {
  constructor(private readonly catalog: JobCatalogReader) {}

  async getActiveJobSummary(jobId: string, activeAt: Date): Promise<CanonicalJobSummary | null> {
    const job = await this.catalog.getActiveJob(jobId, activeAt);
    if (!job) return null;
    return {
      id: job.id,
      company: job.company,
      title: job.title,
      locations: job.locations,
      ...(job.department ? { department: job.department } : {}),
      status: "active",
      firstObservedAt: job.firstObservedAt.toISOString(),
      lastVerifiedAt: job.lastVerifiedAt.toISOString(),
      expiresAt: job.expiresAt.toISOString(),
    };
  }

  getCatalogRevision(): Promise<string> {
    return this.catalog.getCatalogRevision();
  }

  async resolveActiveJobSummaries(jobIds: readonly string[], activeAt: Date) {
    const resolved = await this.catalog.resolveActiveJobSummaries(jobIds, activeAt);
    return {
      catalogRevision: resolved.catalogRevision,
      items: resolved.items.map(({ requestedJobId, job }) => ({
        requestedJobId,
        job: {
          ...job,
          firstObservedAt: job.firstObservedAt.toISOString(),
          lastVerifiedAt: job.lastVerifiedAt.toISOString(),
          expiresAt: job.expiresAt.toISOString(),
        },
      })),
    };
  }
}
