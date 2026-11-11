"use client";

import Link from "next/link";
import { AppliedJobsPanel } from "../../applied-jobs-panel";
import { JobDetailView } from "../../job-detail-view";
import { JobSearchForm } from "../../job-search-form";
import { SavedJobsPanel } from "../../saved-jobs-panel";

// Applications is shown only when the deployment turns the surface on at build time; the platform
// still refuses callers whose token lacks the Applications permissions.
const applicationsUiEnabled = process.env.NEXT_PUBLIC_APPLICATIONS_UI === "enabled";

export function JobsPageClient({
  authenticated,
  initialJob,
}: {
  authenticated: boolean;
  /** One job, opened on its own page, optionally with an application of the candidate's for it. */
  initialJob?: { jobId: string; applicationId?: string };
}) {
  // A link to one job (and, optionally, its application) opens that job's own page, apart from the search.
  if (authenticated && initialJob) {
    return (
      <section aria-label="Job">
        <p>
          <Link href="/jobs">Back to jobs</Link>
        </p>
        <JobDetailView
          authenticated
          jobId={initialJob.jobId}
          {...(initialJob.applicationId ? { applicationId: initialJob.applicationId } : {})}
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
