import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AshbyJobBoardAdapter } from "./ashby.js";

const context = () => ({
  observedAt: new Date("2026-08-23T00:00:00.000Z"),
  signal: new AbortController().signal,
  attempt: 1,
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    title: "Platform Engineer",
    location: "Remote",
    secondaryLocations: [
      {
        location: "New York, NY",
        address: {
          addressLocality: "New York",
          addressRegion: "New York",
          addressCountry: "USA",
        },
      },
    ],
    department: "Engineering",
    team: "Platform",
    isListed: true,
    workplaceType: "Remote",
    publishedAt: "2026-08-22T12:00:00.000Z",
    address: { postalAddress: { addressCountry: "USA" } },
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
  it("binds exact HTML-derived preview digests to fetched objects while retaining complete plaintext", async () => {
    const source = adapter(
      async () =>
        new Response(
          JSON.stringify({
            apiVersion: "1",
            jobs: [
              job({
                descriptionPlain: "Build reliable systems.\nSupport 12 regions.",
                descriptionHtml: "<p>Build <b>reliable</b> systems.</p><p>Support 12 regions.</p>",
              }),
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const response = await source.poll(context());
    if (response.kind !== "success" || !response.observations[0])
      throw new Error("Synthetic response missing");
    const observation = response.observations[0];
    const expected = createHash("sha256")
      .update("build reliable systems.support 12 regions.")
      .digest("hex");
    expect(observation.description).toBe("Build reliable systems.\nSupport 12 regions.");
    expect(source.pagePreviewDescriptionDigests(observation, "d2-job-page-v1")).toEqual([expected]);
    expect(source.pagePreviewDescriptionDigests({ ...observation }, "d2-job-page-v1")).toEqual([]);
    expect(source.pagePreviewDescriptionDigests(observation, "d2-job-page-v2")).toEqual([]);
    expect(JSON.stringify(response)).not.toMatch(/descriptionHtml|Digests|<p>/u);
  });

  it.each([
    undefined,
    null,
    "",
    "<p>Build and maintain other systems.</p>",
    "<p>Build and maintain systems.</p><p>Unexpected extra content.</p>",
  ])(
    "does not enable compatibility from absent or contradictory provider HTML",
    async (descriptionHtml) => {
      const source = adapter(
        async () =>
          new Response(
            JSON.stringify({
              apiVersion: "1",
              jobs: [job({ descriptionHtml })],
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );
      const response = await source.poll(context());
      if (response.kind !== "success" || !response.observations[0])
        throw new Error("Synthetic response missing");
      expect(
        source.pagePreviewDescriptionDigests(response.observations[0], "d2-job-page-v1"),
      ).toEqual([]);
      expect(response.observations[0].description).toBe("Build and maintain systems.");
    },
  );

  it.each([42, {}, "x".repeat(100_001)])(
    "rejects malformed/oversized auxiliary HTML",
    async (descriptionHtml) => {
      const source = adapter(
        async () =>
          new Response(
            JSON.stringify({
              apiVersion: "1",
              jobs: [job({ descriptionHtml })],
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );
      await expect(source.poll(context())).rejects.toThrow();
    },
  );

  it("uses only the fixed public job-board GET and emits identity-only unlisted withdrawals", async () => {
    const withdrawnId = "22345678-abcd-4abc-8abc-1234567890ab";
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            apiVersion: "1",
            jobs: [
              job(),
              {
                isListed: false,
                jobUrl: `https://jobs.ashbyhq.com/reviewed-board/${withdrawnId}`,
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
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
          applicationUrl:
            "https://jobs.ashbyhq.com/reviewed-board/12345678-abcd-4abc-8abc-1234567890ab/application",
          datePosted: new Date("2026-08-22T12:00:00.000Z"),
          structuredLocations: [
            { address: { addressCountry: "USA" } },
            {
              address: {
                addressLocality: "New York",
                addressRegion: "New York",
                addressCountry: "USA",
              },
            },
          ],
          atsTenant: "reviewed-board",
          externalJobId: "12345678-abcd-4abc-8abc-1234567890ab",
          verifiedCompanyDomain: "company.example",
          department: "Engineering",
          workMode: "remote",
          employmentType: "full_time",
        },
      ],
      withdrawals: [
        {
          sourceUrl: `https://jobs.ashbyhq.com/reviewed-board/${withdrawnId}`,
          atsTenant: "reviewed-board",
          externalJobId: withdrawnId,
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

  it("rejects application, publication, and structured-location fields outside the board contract", async () => {
    const invalidApplication = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            apiVersion: "1",
            jobs: [
              job({ applyUrl: "https://jobs.ashbyhq.com/reviewed-board/foreign/application" }),
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(invalidApplication).poll(context())).rejects.toThrow(
      "approved posting identity",
    );

    const invalidPublication = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ apiVersion: "1", jobs: [job({ publishedAt: "recent" })] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(invalidPublication).poll(context())).rejects.toThrow(
      "publication timestamp",
    );

    const invalidSecondaryLocation = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ apiVersion: "1", jobs: [job({ secondaryLocations: [null] })] }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(invalidSecondaryLocation).poll(context())).rejects.toThrow(
      "secondary location",
    );
  });
});
