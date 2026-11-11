import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../job-detail-view", () => ({
  JobDetailView: ({ applicationId, jobId }: { applicationId?: string; jobId: string }) =>
    React.createElement(
      "div",
      { "data-application": applicationId, "data-job": jobId, "data-view": "true" },
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
      initialJob: { jobId: "synthetic-job", applicationId: "synthetic-application" },
    }),
  );
  expect(html).toContain('data-application="synthetic-application"');
  expect(html).toContain('data-job="synthetic-job"');
  expect(html).toContain('data-view="true"');
  expect(html).toContain('href="/jobs"');
  expect(html).not.toContain("data-search");
});

it("opens a linked job on its own page with no application", async () => {
  vi.stubGlobal("React", React);
  const { JobsPageClient } = await import("./jobs-page-client");
  const html = renderToStaticMarkup(
    React.createElement(JobsPageClient, {
      authenticated: true,
      initialJob: { jobId: "synthetic-job" },
    }),
  );
  expect(html).toContain('data-job="synthetic-job"');
  expect(html).not.toContain("data-application");
  expect(html).toContain("Back to jobs");
  expect(html).not.toContain("data-search");
});

it("shows the search when no job is linked", async () => {
  vi.stubGlobal("React", React);
  const { JobsPageClient } = await import("./jobs-page-client");
  const html = renderToStaticMarkup(React.createElement(JobsPageClient, { authenticated: true }));
  expect(html).toContain("data-search");
  expect(html).not.toContain("data-view");
});
