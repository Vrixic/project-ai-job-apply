import { describe, expect, it, vi } from "vitest";
import { GreenhouseJobBoardAdapter } from "./greenhouse.js";

const context = () => ({
  observedAt: new Date("2026-08-22T00:00:00.000Z"),
  signal: new AbortController().signal,
  attempt: 1,
});

function adapter(fetch: typeof globalThis.fetch) {
  return new GreenhouseJobBoardAdapter({
    sourceId: "greenhouse-reviewed-board",
    boardToken: "reviewed_board",
    companyName: "Reviewed Company",
    verifiedCompanyDomain: "company.example",
    fetch,
  });
}

describe("GreenhouseJobBoardAdapter", () => {
  it("uses only the fixed public GET endpoint and maps a bounded response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 123,
                title: "Platform Engineer",
                absolute_url:
                  "https://job-boards.greenhouse.io/reviewed_board/jobs/123?gh_src=tracking",
                location: { name: "Remote" },
                content: "<p>Build &amp; maintain systems.</p><script>bad()</script>",
                departments: [{ name: "Engineering" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(fetch).poll(context())).resolves.toEqual({
      kind: "success",
      observations: [
        {
          companyName: "Reviewed Company",
          title: "Platform Engineer",
          locations: ["Remote"],
          description: "Build & maintain systems.",
          sourceUrl: "https://job-boards.greenhouse.io/reviewed_board/jobs/123",
          atsTenant: "reviewed_board",
          externalJobId: "123",
          verifiedCompanyDomain: "company.example",
          department: "Engineering",
        },
      ],
      withdrawals: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/reviewed_board/jobs?content=true",
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

  it("fetches one exact job for contribution verification without downloading the whole board", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: 7774935003,
            title: "Platform Engineer",
            absolute_url: "https://job-boards.greenhouse.io/reviewed_board/jobs/7774935003",
            location: { name: "Remote" },
            content: "<p>Build reliable systems.</p>",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      adapter(fetch).pollExact?.({ ...context(), externalJobId: "7774935003" }),
    ).resolves.toMatchObject({
      kind: "success",
      observations: [{ externalJobId: "7774935003", title: "Platform Engineer" }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/reviewed_board/jobs/7774935003",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("rejects malformed or mismatched exact job identities", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: 2,
            title: "Job",
            absolute_url: "https://job-boards.greenhouse.io/reviewed_board/jobs/2",
            location: { name: "Remote" },
            content: "Text",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      adapter(fetch).pollExact?.({ ...context(), externalJobId: "../2" }),
    ).rejects.toThrow("identifier is invalid");
    await expect(adapter(fetch).pollExact?.({ ...context(), externalJobId: "1" })).rejects.toThrow(
      "exact response identity",
    );
  });

  it("rejects redirects, foreign job URLs, oversized bodies, and oversized batches", async () => {
    const foreign = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                title: "Job",
                absolute_url: "https://evil.example/job",
                location: { name: "Remote" },
                content: "Text",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(foreign).poll(context())).rejects.toThrow("approved host");

    const wrongIdentity = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                title: "Job",
                absolute_url: "https://boards.greenhouse.io/another_board/jobs/2",
                location: { name: "Remote" },
                content: "Text",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(wrongIdentity).poll(context())).rejects.toThrow(
      "approved board and job identity",
    );

    const redirected = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    );
    await expect(adapter(redirected).poll(context())).resolves.toEqual({
      kind: "retry",
      reason: "source_unavailable",
    });

    const tooLarge = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response("{}", {
          headers: { "content-type": "application/json", "content-length": "1000001" },
        }),
    );
    await expect(adapter(tooLarge).poll(context())).rejects.toThrow("byte limit");

    const tooMany = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ jobs: Array.from({ length: 101 }, () => ({})) }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(tooMany).poll(context())).rejects.toThrow("bounded size");
  });
});
