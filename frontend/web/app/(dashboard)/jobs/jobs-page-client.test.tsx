import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../applications-workspace", () => ({
  ApplicationsWorkspace: ({ applicationId, jobId }: { applicationId: string; jobId: string }) =>
    React.createElement(
      "div",
      { "data-application": applicationId, "data-job": jobId },
      "Exact application",
    ),
}));
vi.mock("../../job-search-form", () => ({ JobSearchForm: () => null }));
vi.mock("../../saved-jobs-panel", () => ({ SavedJobsPanel: () => null }));
vi.mock("../../applied-jobs-panel", () => ({ AppliedJobsPanel: () => null }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it.each([true, false])(
  "opens the exact application independently of current job availability only with handoff enabled=%s",
  async (enabled) => {
    vi.stubGlobal("React", React);
    vi.stubEnv("NEXT_PUBLIC_APPLICATIONS_UI", "enabled");
    vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF", enabled ? "enabled" : "disabled");
    const { JobsPageClient } = await import("./jobs-page-client");
    const html = renderToStaticMarkup(
      React.createElement(JobsPageClient, {
        authenticated: true,
        initialApplication: { id: "synthetic-application", jobId: "synthetic-job" },
      }),
    );
    expect(html.includes('data-application="synthetic-application"')).toBe(enabled);
    expect(html.includes('data-job="synthetic-job"')).toBe(enabled);
  },
);
