"use client";

import { useState } from "react";
import { JobSearchForm } from "../../job-search-form";
import { SavedJobsPanel } from "../../saved-jobs-panel";

type JobsView = "search" | "saved";

export function JobsPageClient({ authenticated }: { authenticated: boolean }) {
  const [jobsView, setJobsView] = useState<JobsView>("search");

  return (
    <section aria-label="Jobs">
      <div className="dashboard-subtabs" role="tablist" aria-label="Jobs view">
        <button
          type="button"
          role="tab"
          aria-selected={jobsView === "search"}
          className="dashboard-subtab"
          onClick={() => setJobsView("search")}
        >
          Search
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={jobsView === "saved"}
          className="dashboard-subtab"
          onClick={() => setJobsView("saved")}
        >
          Saved
        </button>
      </div>
      <div hidden={jobsView !== "search"}>
        <JobSearchForm authenticated={authenticated} />
      </div>
      <div hidden={jobsView !== "saved"}>
        <SavedJobsPanel authenticated={authenticated} />
      </div>
    </section>
  );
}
