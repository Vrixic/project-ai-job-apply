import type { ActiveJobRecord, JobCatalogReader } from "@ai-job-apply/jobs-service";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { JobCatalogSavedJobResolver } from "./saved-job-catalog-resolver.js";

describe("JobCatalogSavedJobResolver", () => {
  it("maps only the bounded public active summary and opaque revision", async () => {
    const job: ActiveJobRecord = {
      id: uuidv7(),
      company: { id: uuidv7(), name: "Synthetic Company" },
      title: "Synthetic Engineer",
      locations: ["Remote - US"],
      description: "must not cross the saved-job boundary",
      status: "active",
      firstObservedAt: new Date("2026-08-15T12:00:00.000Z"),
      lastVerifiedAt: new Date("2026-08-15T12:00:00.000Z"),
      expiresAt: new Date("2026-09-14T12:00:00.000Z"),
      sources: [],
    };
    const catalog: JobCatalogReader = {
      async ping() {},
      async getCatalogRevision() {
        return "19";
      },
      async getActiveJob(id) {
        return id === job.id ? job : null;
      },
      async getMatchableJob() {
        return null;
      },
      async resolveActiveJobSummaries(ids) {
        return {
          catalogRevision: "19",
          items: ids.includes(job.id)
            ? [
                {
                  requestedJobId: job.id,
                  job: {
                    id: job.id,
                    company: job.company,
                    title: job.title,
                    locations: job.locations,
                    status: "active",
                    firstObservedAt: job.firstObservedAt,
                    lastVerifiedAt: job.lastVerifiedAt,
                    expiresAt: job.expiresAt,
                  },
                },
              ]
            : [],
        };
      },
      async searchActiveJobs() {
        return { items: [] };
      },
    };
    const resolver = new JobCatalogSavedJobResolver(catalog);
    const summary = await resolver.getActiveJobSummary(
      job.id,
      new Date("2026-08-15T12:00:00.000Z"),
    );
    expect(summary?.id).toBe(job.id);
    expect(summary).not.toHaveProperty("description");
    expect(summary).not.toHaveProperty("sources");
    await expect(resolver.getCatalogRevision()).resolves.toBe("19");
  });
});
