"use client";

import { AppliedJobsPanel } from "../../applied-jobs-panel";
import { JobDetailPanel } from "../../job-detail-panel";
import { JobSearchForm } from "../../job-search-form";
import { SavedJobsPanel } from "../../saved-jobs-panel";

// Applications is shown only when the deployment turns the surface on at build time; the platform
// still refuses callers whose token lacks the Applications permissions.
const applicationsUiEnabled = process.env.NEXT_PUBLIC_APPLICATIONS_UI === "enabled";

export function JobsPageClient({
  authenticated,
  initialApplication,
}: {
  authenticated: boolean;
  initialApplication?: { id: string; jobId: string };
}) {
  // A link to one job and its application opens that job on its own, apart from the search.
  if (authenticated && initialApplication) {
    return (
      <section aria-label="Job">
        <p>
          <a href="/jobs">Back to jobs</a>
        </p>
        <JobDetailPanel
          standalone
          authenticated
          jobId={initialApplication.jobId}
          applicationId={initialApplication.id}
        />
      </section>
    );
  }
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
