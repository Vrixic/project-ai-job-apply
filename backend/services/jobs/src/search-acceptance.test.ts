import { describe, expect, it } from "vitest";
import {
  assertRecentJobSearchAcceptanceTime,
  buildJobSearchAcceptanceFixture,
  JOB_SEARCH_ACCEPTANCE_CONFIRMATION,
  parseJobSearchAcceptanceEnvironment,
} from "./search-acceptance.js";

const runId = "abcdef01-abcd-4abc-8abc-abcdef012345";
const at = new Date("2026-08-15T12:00:00.000Z");

describe("job-search synthetic acceptance contract", () => {
  it("derives three stable synthetic-only fixtures with exactly two query matches", () => {
    const first = buildJobSearchAcceptanceFixture(runId, at);
    const second = buildJobSearchAcceptanceFixture(runId, at);

    expect(second).toEqual(first);
    expect(first.queryToken).toBe("d1searchabcdef01abcd4abc8abcabcdef012345");
    expect(first.jobs).toHaveLength(3);
    expect(first.jobs.filter((job) => job.matchesQuery)).toHaveLength(2);
    expect(new Set(first.jobs.map((job) => job.sourceId)).size).toBe(3);
    expect(first.jobs.every((job) => job.observation.provenance === "authorized_fixture")).toBe(
      true,
    );
    expect(first.jobs.every((job) => !("rawSnapshot" in job.observation))).toBe(true);
    const sentinel = first.jobs.find((job) => job.slug === "sentinel");
    expect(sentinel?.observation.description).not.toContain(first.queryToken);
    expect(sentinel?.observation).not.toHaveProperty("applicationUrl");
    for (const job of first.jobs.filter((candidate) => candidate.matchesQuery)) {
      expect(job.observation).toMatchObject({
        locations: ["Synthetic City, NY, US"],
        employmentType: "full_time",
        applicationUrl: `https://jobs.example.test/d1-search-acceptance/${runId}/${job.slug}/application`,
        structuredLocations: [
          {
            address: {
              addressCountry: "US",
              addressLocality: "Synthetic City",
              addressRegion: "NY",
            },
          },
        ],
      });
      expect(job.observation.datePosted?.toISOString()).toBe("2026-08-08T12:00:00.000Z");
    }
    expect(first.jobs.find((job) => job.slug === "alpha")?.observation.workMode).toBe("on_site");
    expect(first.jobs.find((job) => job.slug === "bravo")?.observation.workMode).toBe("hybrid");
    expect(first.companyName).not.toContain(first.queryToken);
  });

  it("requires the exact confirmation, action, run ID, and action-specific timestamp", () => {
    const common = {
      JOB_SEARCH_ACCEPTANCE_CONFIRM: JOB_SEARCH_ACCEPTANCE_CONFIRMATION,
      JOB_SEARCH_ACCEPTANCE_ACTION: "prepare",
      JOB_SEARCH_ACCEPTANCE_RUN_ID: runId,
      JOB_SEARCH_ACCEPTANCE_AT: at.toISOString(),
    };
    expect(parseJobSearchAcceptanceEnvironment(common)).toEqual({
      action: "prepare",
      runId,
      at,
    });
    expect(
      parseJobSearchAcceptanceEnvironment({
        ...common,
        JOB_SEARCH_ACCEPTANCE_ACTION: "cleanup",
        JOB_SEARCH_ACCEPTANCE_AT: undefined,
      }),
    ).toEqual({ action: "cleanup", runId });

    for (const environment of [
      { ...common, JOB_SEARCH_ACCEPTANCE_CONFIRM: "true" },
      { ...common, JOB_SEARCH_ACCEPTANCE_ACTION: "inspect" },
      { ...common, JOB_SEARCH_ACCEPTANCE_RUN_ID: runId.toUpperCase() },
      { ...common, JOB_SEARCH_ACCEPTANCE_RUN_ID: "not-a-uuid" },
      { ...common, JOB_SEARCH_ACCEPTANCE_AT: undefined },
      { ...common, JOB_SEARCH_ACCEPTANCE_AT: "2026-08-15T12:00:00Z" },
      { ...common, JOB_SEARCH_ACCEPTANCE_ACTION: "cleanup" },
    ]) {
      expect(() => parseJobSearchAcceptanceEnvironment(environment)).toThrow();
    }
  });

  it("rejects stale or future execution timestamps outside the bounded window", () => {
    expect(() =>
      assertRecentJobSearchAcceptanceTime(at, new Date(at.getTime() + 14 * 60_000)),
    ).not.toThrow();
    expect(() =>
      assertRecentJobSearchAcceptanceTime(at, new Date(at.getTime() + 16 * 60_000)),
    ).toThrow("bounded clock window");
    expect(() =>
      assertRecentJobSearchAcceptanceTime(at, new Date(at.getTime() - 16 * 60_000)),
    ).toThrow("bounded clock window");
  });
});
