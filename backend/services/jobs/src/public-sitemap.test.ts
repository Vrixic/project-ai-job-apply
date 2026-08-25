import { describe, expect, it, vi } from "vitest";
import {
  PostgresPublicJobSitemapReader,
  PublicJobSitemapProjector,
  type PublicJobSitemapReader,
  PublicJobSitemapUnavailableError,
} from "./public-sitemap.js";

const firstJobId = "018f6f6e-7b2a-7c00-8000-000000000001";
const secondJobId = "018f6f6e-7b2a-7c00-8000-000000000002";
const now = new Date("2026-08-16T12:00:00.000Z");

describe("PostgresPublicJobSitemapReader", () => {
  it("queries only the fixed public sitemap projection", async () => {
    let query = "";
    const sql = vi.fn((parts: TemplateStringsArray) => {
      query = parts.join("?");
      return Promise.resolve([]);
    });
    const reader = new PostgresPublicJobSitemapReader(sql as never);

    await expect(reader.listActiveJobs(undefined, 101)).resolves.toEqual([]);
    expect(query).toContain("FROM jobs_public.read_public_job_sitemap(");
    expect(query).not.toMatch(/jobs\.(?:canonical_jobs|companies|job_sources)|raw_snapshot/i);
  });
});

describe("PublicJobSitemapProjector", () => {
  function reader(rows: Awaited<ReturnType<PublicJobSitemapReader["listActiveJobs"]>>) {
    return {
      listActiveJobs: vi.fn<PublicJobSitemapReader["listActiveJobs"]>().mockResolvedValue(rows),
    };
  }

  it("returns an immutable bounded page and preserves keyset inputs", async () => {
    const catalog = reader([
      { jobId: firstJobId, lastModifiedAt: new Date("2026-08-16T11:00:00.000Z") },
      { jobId: secondJobId, lastModifiedAt: new Date("2026-08-16T10:00:00.000Z") },
    ]);
    const projector = new PublicJobSitemapProjector(catalog, () => now);

    await expect(projector.list()).resolves.toEqual({
      kind: "page",
      items: [
        { jobId: firstJobId, lastModifiedAt: "2026-08-16T11:00:00.000Z" },
        { jobId: secondJobId, lastModifiedAt: "2026-08-16T10:00:00.000Z" },
      ],
      hasMore: false,
    });
    expect(catalog.listActiveJobs).toHaveBeenCalledWith(undefined, 101);
  });

  it("caps a page at one hundred and reports the lookahead", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      jobId: `018f6f6e-7b2a-7c00-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      lastModifiedAt: new Date(now.getTime() - index * 1_000),
    }));
    const result = await new PublicJobSitemapProjector(reader(rows), () => now).list();
    expect(result.items).toHaveLength(100);
    expect(result.hasMore).toBe(true);
  });

  it.each([
    { rows: [{ jobId: firstJobId, lastModifiedAt: new Date(now.getTime() + 1) }] },
    {
      rows: [
        { jobId: firstJobId, lastModifiedAt: new Date("2026-08-16T10:00:00.000Z") },
        { jobId: secondJobId, lastModifiedAt: new Date("2026-08-16T11:00:00.000Z") },
      ],
    },
    {
      rows: [
        { jobId: firstJobId, lastModifiedAt: new Date("2026-08-16T11:00:00.000Z") },
        { jobId: firstJobId, lastModifiedAt: new Date("2026-08-16T10:00:00.000Z") },
      ],
    },
  ])("maps malformed projection rows to availability failure", async ({ rows }) => {
    const projector = new PublicJobSitemapProjector(reader(rows), () => now);
    await expect(projector.list()).rejects.toBeInstanceOf(PublicJobSitemapUnavailableError);
  });

  it("maps reader failures to availability failure instead of an empty page", async () => {
    const catalog = {
      listActiveJobs: vi
        .fn<PublicJobSitemapReader["listActiveJobs"]>()
        .mockRejectedValue(new Error("database unavailable")),
    };
    await expect(new PublicJobSitemapProjector(catalog, () => now).list()).rejects.toBeInstanceOf(
      PublicJobSitemapUnavailableError,
    );
  });

  it("rejects a future cursor before touching the database", async () => {
    const catalog = reader([]);
    await expect(
      new PublicJobSitemapProjector(catalog, () => now).list({
        jobId: firstJobId,
        lastModifiedAt: "2026-08-16T12:00:00.001Z",
      }),
    ).rejects.toBeInstanceOf(PublicJobSitemapUnavailableError);
    expect(catalog.listActiveJobs).not.toHaveBeenCalled();
  });
});
