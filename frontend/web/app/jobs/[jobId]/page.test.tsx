import type { PublicJobDetailResponse } from "@ai-job-apply/api-contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicJobDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("../../../lib/public-job-read", () => ({
  getPublicJobDetail: mocks.getPublicJobDetail,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

import PublicJobPage, {
  buildJobPostingStructuredData,
  buildPublicJobMetadata,
  generateMetadata,
} from "./page.js";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const requestedId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
const canonicalId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2";
const detail: PublicJobDetailResponse = {
  requestedJobId: requestedId,
  canonicalJobId: canonicalId,
  isAlias: true,
  job: {
    id: canonicalId,
    companyName: "Synthetic <Company>",
    title: "Software Engineer & Builder",
    locations: ["Remote - US"],
    description: "Use <script>alert('plain text')</script> exactly as text.",
    firstObservedAt: "2026-08-10T12:00:00.000Z",
    lastVerifiedAt: "2026-08-16T11:00:00.000Z",
    expiresAt: "2026-08-20T12:00:00.000Z",
  },
};

beforeEach(() => vi.clearAllMocks());

describe("public job page", () => {
  it("redirects an alias to only the exact canonical path", async () => {
    mocks.getPublicJobDetail.mockResolvedValue({ kind: "available", detail });
    await expect(
      PublicJobPage({ params: Promise.resolve({ jobId: requestedId }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:/jobs/${canonicalId}`);
    expect(mocks.redirect).toHaveBeenCalledWith(`/jobs/${canonicalId}`);
  });

  it("renders canonical source text as text and never emits JSON-LD", async () => {
    const canonical = {
      ...detail,
      requestedJobId: canonicalId,
      isAlias: false,
    };
    mocks.getPublicJobDetail.mockResolvedValue({ kind: "available", detail: canonical });
    const markup = renderToStaticMarkup(
      await PublicJobPage({ params: Promise.resolve({ jobId: canonicalId }) }),
    );
    expect(markup).toContain("Synthetic &lt;Company&gt;");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("emits JobPosting only for complete non-remote provider truth", async () => {
    const canonical: PublicJobDetailResponse = {
      ...detail,
      requestedJobId: canonicalId,
      isAlias: false,
      job: {
        ...detail.job,
        workMode: "on_site",
        employmentType: "full_time",
        datePosted: "2026-08-01T12:00:00.000Z",
        applicationUrl:
          "https://jobs.ashbyhq.com/reviewed-board/12345678-abcd-4abc-8abc-1234567890ab/application",
        structuredLocations: [
          {
            address: {
              addressLocality: "New York",
              addressRegion: "New York",
              addressCountry: "USA",
            },
          },
        ],
      },
    };
    expect(buildJobPostingStructuredData(canonical)).toMatchObject({
      "@type": "JobPosting",
      datePosted: "2026-08-01T12:00:00.000Z",
      employmentType: "FULL_TIME",
    });
    mocks.getPublicJobDetail.mockResolvedValue({ kind: "available", detail: canonical });
    const markup = renderToStaticMarkup(
      await PublicJobPage({ params: Promise.resolve({ jobId: canonicalId }) }),
    );
    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain("Apply on the employer&#x27;s site");
    expect(markup).toContain("\\u003cCompany>");
    expect(
      buildJobPostingStructuredData({
        ...canonical,
        job: { ...canonical.job, workMode: "remote" },
      }),
    ).toBeUndefined();
  });

  it("uses generic not-found only for typed absence", async () => {
    mocks.getPublicJobDetail.mockResolvedValue({ kind: "absent" });
    await expect(
      PublicJobPage({ params: Promise.resolve({ jobId: requestedId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      generateMetadata({ params: Promise.resolve({ jobId: requestedId }) }),
    ).resolves.toMatchObject({ robots: { index: false, follow: false } });
  });

  it("propagates upstream outage instead of converting it to absence", async () => {
    const outage = new Error("generic outage");
    mocks.getPublicJobDetail.mockRejectedValue(outage);
    await expect(PublicJobPage({ params: Promise.resolve({ jobId: requestedId }) })).rejects.toBe(
      outage,
    );
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("uses only the trusted canonical origin and defaults noindex", () => {
    const metadata = buildPublicJobMetadata(detail, new URL("https://jobs.example.com"), false);
    expect(metadata.alternates?.canonical?.toString()).toBe(
      `https://jobs.example.com/jobs/${canonicalId}`,
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(JSON.stringify(metadata)).not.toContain(requestedId);
    expect(JSON.stringify(metadata)).not.toContain("JobPosting");
  });

  it("bounds metadata without splitting Unicode code points", () => {
    const longDetail = {
      ...detail,
      job: { ...detail.job, title: "🧭".repeat(240), companyName: "C".repeat(200) },
    };
    const metadata = buildPublicJobMetadata(
      longDetail,
      new URL("https://jobs.acme-careers.com"),
      false,
    );
    expect(Array.from(String(metadata.title))).toHaveLength(160);
    expect(Array.from(String(metadata.description))).toHaveLength(200);
    expect(String(metadata.title)).not.toContain("�");
  });
});
