"use client";

import { AppliedJobsPanel } from "../../applied-jobs-panel";
import { JobSearchForm } from "../../job-search-form";
import { SavedJobsPanel } from "../../saved-jobs-panel";

// Applications is shown only when the deployment turns the surface on at build time; the platform
// still refuses callers whose token lacks the Applications permissions.
const applicationsUiEnabled = process.env.NEXT_PUBLIC_APPLICATIONS_UI === "enabled";

export function JobsPageClient({ authenticated }: { authenticated: boolean }) {
  return (
    <section aria-label="Jobs">
      <JobSearchForm
        authenticated={authenticated}
        savedPanel={<SavedJobsPanel authenticated={authenticated} />}
        appliedPanel={
          applicationsUiEnabled ? <AppliedJobsPanel authenticated={authenticated} /> : undefined
        }
      />
    </section>
  );
}
