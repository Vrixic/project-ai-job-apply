"use client";

import { JobSearchForm } from "../../job-search-form";
import { SavedJobsPanel } from "../../saved-jobs-panel";

export function JobsPageClient({ authenticated }: { authenticated: boolean }) {
  return (
    <section aria-label="Jobs">
      <JobSearchForm
        authenticated={authenticated}
        savedPanel={<SavedJobsPanel authenticated={authenticated} />}
      />
    </section>
  );
}
