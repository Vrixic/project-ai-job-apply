"use client";

import { ApplicationsWorkspace } from "../../applications-workspace";
import { AppliedJobsPanel } from "../../applied-jobs-panel";
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
  return (
    <section aria-label="Jobs">
      {authenticated &&
      applicationsUiEnabled &&
      process.env.NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF === "enabled" &&
      initialApplication ? (
        <section aria-label="Application from extension">
          <h2>Application review</h2>
          <ApplicationsWorkspace
            key={`${initialApplication.id}:${initialApplication.jobId}`}
            jobId={initialApplication.jobId}
            applicationId={initialApplication.id}
          />
        </section>
      ) : null}
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
