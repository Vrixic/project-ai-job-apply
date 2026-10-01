"use client";

import { ResumeUploadForm } from "../../resume-upload-form";
import { useEntitlementSummary } from "../../use-entitlement-summary";

export function ResumePageClient({ authenticated }: { authenticated: boolean }) {
  const { view } = useEntitlementSummary(authenticated);
  const maxStoredResumes =
    view.status === "ready" ? view.summary.limits?.maxStoredResumes : undefined;

  return (
    <section aria-label="Resume">
      <ResumeUploadForm authenticated={authenticated} maxStoredResumes={maxStoredResumes} />
    </section>
  );
}
