import { describe, expect, it, vi } from "vitest";
import { AshbyJobBoardAdapter } from "./ashby.js";

const context = () => ({
  observedAt: new Date("2026-08-23T00:00:00.000Z"),
  signal: new AbortController().signal,
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    title: "Platform Engineer",
    location: "Remote",
    secondaryLocations: [{ location: "New York, NY" }],
    department: "Engineering",
    team: "Platform",
    isListed: true,
    workplaceType: "Remote",
    descriptionPlain: "Build and maintain systems.",
    employmentType: "FullTime",
    jobUrl: "https://jobs.ashbyhq.com/reviewed-board/12345678-abcd-4abc-8abc-1234567890ab",
    applyUrl:
      "https://jobs.ashbyhq.com/reviewed-board/12345678-abcd-4abc-8abc-1234567890ab/application",
    ...overrides,
  };
}

function adapter(fetch: typeof globalThis.fetch) {
  return new AshbyJobBoardAdapter({
    sourceId: "ashby-reviewed-board",
    jobBoardName: "reviewed-board",
    companyName: "Reviewed Company",
    verifiedCompanyDomain: "company.example",
    fetch,
  });
}

describe("AshbyJobBoardAdapter", () => {
  it("uses only the fixed public job-board GET and omits unlisted postings", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ apiVersion: "1", jobs: [job(), job({ isListed: false })] }), {
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(adapter(fetch).poll(context())).resolves.toEqual({
      kind: "success",
      observations: [
        {
          companyName: "Reviewed Company",
          title: "Platform Engineer",
          locations: ["Remote", "New York, NY"],
          description: "Build and maintain systems.",
          sourceUrl: "https://jobs.ashbyhq.com/reviewed-board/12345678-abcd-4abc-8abc-1234567890ab",
          atsTenant: "reviewed-board",
          externalJobId: "12345678-abcd-4abc-8abc-1234567890ab",
          verifiedCompanyDomain: "company.example",
          department: "Engineering",
          workMode: "remote",
          employmentType: "full_time",
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.ashbyhq.com/posting-api/job-board/reviewed-board?includeCompensation=false",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it.each([
    [429, "rate_limited"],
    [500, "source_unavailable"],
  ] as const)("maps HTTP %s to a redacted retry", async (status, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    await expect(adapter(fetch).poll(context())).resolves.toEqual({ kind: "retry", reason });
  });

  it("rejects foreign identities, unversioned responses, and oversized batches", async () => {
    const foreign = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ apiVersion: "1", jobs: [job({ jobUrl: "https://evil.example/job" })] }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(foreign).poll(context())).rejects.toThrow("approved board");

    const wrongVersion = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ apiVersion: "2", jobs: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(wrongVersion).poll(context())).rejects.toThrow("version");

    const tooMany = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ apiVersion: "1", jobs: Array.from({ length: 101 }, job) }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(tooMany).poll(context())).rejects.toThrow("bounded size");
  });
});
