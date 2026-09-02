import { describe, expect, it } from "vitest";
import { d2CommunityEmf } from "./d2-community-observability.js";

describe("D2 community aggregate EMF", () => {
  it("creates dimensionless count metrics without identifier or artifact fields", () => {
    const value = d2CommunityEmf({ JobsClaimed: 2, JobsCompleted: 1 }, new Date("2026-09-02T16:00:00.000Z"));
    expect(value).toMatchObject({ JobsClaimed: 2, JobsCompleted: 1, _aws: { Timestamp: 1788364800000, CloudWatchMetrics: [{ Namespace: "AIJobApply/D2Community", Dimensions: [] }] } });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(/(?:id|url|payload|artifact|email|user|source)/iu);
  });

  it.each([{ JobsClaimed: -1 }, { JobsClaimed: 1.5 }, { job_id: 1 }, {}])("rejects unsafe metric input", (metrics) => {
    expect(() => d2CommunityEmf(metrics, new Date())).toThrow("aggregate metrics");
  });
});
