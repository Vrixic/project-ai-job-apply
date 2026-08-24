import { describe, expect, it, vi } from "vitest";
import { LeverPostingsAdapter } from "./lever.js";

const context = () => ({
  observedAt: new Date("2026-08-23T00:00:00.000Z"),
  signal: new AbortController().signal,
});

function posting(overrides: Record<string, unknown> = {}) {
  return {
    id: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
    text: "Platform Engineer",
    categories: {
      location: "Remote",
      allLocations: ["Remote", "New York, NY"],
      department: "Engineering",
    },
    descriptionPlain: "Build and maintain systems.",
    hostedUrl:
      "https://jobs.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902?lever-source=tracking",
    workplaceType: "remote",
    ...overrides,
  };
}

function adapter(fetch: typeof globalThis.fetch, region: "global" | "eu" = "global") {
  return new LeverPostingsAdapter({
    sourceId: "lever-reviewed-site",
    site: "reviewed-site",
    companyName: "Reviewed Company",
    verifiedCompanyDomain: "company.example",
    region,
    fetch,
  });
}

describe("LeverPostingsAdapter", () => {
  it("uses only the fixed published-postings GET and maps reviewed fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify([posting()]), {
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
          sourceUrl: "https://jobs.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
          atsTenant: "reviewed-site",
          externalJobId: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
          verifiedCompanyDomain: "company.example",
          department: "Engineering",
          workMode: "remote",
        },
      ],
      withdrawals: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/reviewed-site?mode=json&skip=0&limit=100",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("keeps the EU acquisition and hosted-job boundaries paired", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify([
            posting({
              hostedUrl:
                "https://jobs.eu.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
            }),
          ]),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(fetch, "eu").poll(context())).resolves.toMatchObject({
      kind: "success",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.eu.lever.co/v0/postings/reviewed-site?mode=json&skip=0&limit=100",
    );
  });

  it.each([
    [429, "rate_limited"],
    [503, "source_unavailable"],
  ] as const)("maps HTTP %s to a redacted retry", async (status, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    await expect(adapter(fetch).poll(context())).resolves.toEqual({ kind: "retry", reason });
  });

  it("rejects foreign identities, oversized bodies, and a page beyond the bounded batch", async () => {
    const foreign = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify([posting({ hostedUrl: "https://evil.example/job" })]), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(foreign).poll(context())).rejects.toThrow("approved site");

    const oversized = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response("[]", {
          headers: { "content-type": "application/json", "content-length": "1000001" },
        }),
    );
    await expect(adapter(oversized).poll(context())).rejects.toThrow("byte limit");

    let request = 0;
    const overflow = vi.fn<typeof globalThis.fetch>(async () => {
      request += 1;
      const jobs =
        request === 1
          ? Array.from({ length: 100 }, (_, index) =>
              posting({
                id: `posting-${index.toString().padStart(8, "0")}`,
                hostedUrl: `https://jobs.lever.co/reviewed-site/posting-${index.toString().padStart(8, "0")}`,
              }),
            )
          : [posting()];
      return new Response(JSON.stringify(jobs), {
        headers: { "content-type": "application/json" },
      });
    });
    await expect(adapter(overflow).poll(context())).rejects.toThrow("bounded size");
    expect(overflow.mock.calls[1]?.[0]).toContain("skip=100&limit=1");
  });
});
