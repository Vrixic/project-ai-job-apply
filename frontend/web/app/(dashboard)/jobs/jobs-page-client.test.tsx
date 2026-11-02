import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../job-detail-panel", () => ({
  JobDetailPanel: ({
    applicationId,
    jobId,
    standalone,
  }: {
    applicationId?: string;
    jobId: string;
    standalone?: boolean;
  }) =>
    React.createElement(
      "div",
      {
        "data-application": applicationId,
        "data-job": jobId,
        "data-standalone": String(standalone),
      },
      "Job page",
    ),
}));
vi.mock("../../job-search-form", () => ({
  JobSearchForm: () => React.createElement("div", { "data-search": "true" }, "Search"),
}));
vi.mock("../../saved-jobs-panel", () => ({ SavedJobsPanel: () => null }));
vi.mock("../../applied-jobs-panel", () => ({ AppliedJobsPanel: () => null }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("opens a linked job and its application on their own page, apart from the search", async () => {
  vi.stubGlobal("React", React);
  const { JobsPageClient } = await import("./jobs-page-client");
  const html = renderToStaticMarkup(
    React.createElement(JobsPageClient, {
      authenticated: true,
      initialApplication: { id: "synthetic-application", jobId: "synthetic-job" },
    }),
  );
  expect(html).toContain('data-application="synthetic-application"');
  expect(html).toContain('data-job="synthetic-job"');
  expect(html).toContain('data-standalone="true"');
  expect(html).toContain('href="/jobs"');
  expect(html).not.toContain("data-search");
});

it("shows the search when no job is linked", async () => {
  vi.stubGlobal("React", React);
  const { JobsPageClient } = await import("./jobs-page-client");
  const html = renderToStaticMarkup(React.createElement(JobsPageClient, { authenticated: true }));
  expect(html).toContain("data-search");
  expect(html).not.toContain("data-standalone");
});
