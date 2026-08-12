import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresJobCatalog } from "./catalog.js";

describe("PostgresJobCatalog active read parameters", () => {
  it("binds the freshness boundary as an ISO string for the bundled PostgreSQL client", async () => {
    const parameters: unknown[][] = [];
    const client = ((_: TemplateStringsArray, ...values: unknown[]) => {
      parameters.push(values);
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client);
    const jobId = "00000000-0000-7000-8000-000000000000";
    const activeAt = new Date("2026-08-11T20:00:00.000Z");

    await expect(catalog.getActiveJob(jobId, activeAt)).resolves.toBeNull();
    expect(parameters).toEqual([
      [jobId, jobId],
      [jobId, jobId, activeAt.toISOString()],
    ]);
  });

  it("rejects an invalid internal freshness boundary before opening a query", async () => {
    let queryCount = 0;
    const client = (() => {
      queryCount += 1;
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client);

    await expect(
      catalog.getActiveJob("00000000-0000-7000-8000-000000000000", new Date(Number.NaN)),
    ).rejects.toThrow(RangeError);
    expect(queryCount).toBe(0);
  });
});
