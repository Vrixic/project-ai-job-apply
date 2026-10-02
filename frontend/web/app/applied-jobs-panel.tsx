"use client";

import type { Application, CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";
import { listAppliedApplications } from "../lib/applications-client";

const loadFailureMessage = "Applied jobs are temporarily unavailable.";

interface AppliedJobRow {
  application: Application;
  job: CanonicalJobDetail | undefined;
}

function confirmedAt(application: Application): string | undefined {
  for (let index = application.attempts.length - 1; index >= 0; index -= 1) {
    const confirmation = application.attempts[index]?.confirmation;
    if (confirmation) return confirmation.observedAt;
  }
  return undefined;
}

/** The candidate's confirmed-submitted applications, with the job details for each. */
export function AppliedJobsPanel({ authenticated }: { authenticated: boolean }) {
  const [rows, setRows] = useState<AppliedJobRow[]>();
  const [loading, setLoading] = useState(authenticated);
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setRows(undefined);
      setLoading(false);
      setMessage(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setMessage(undefined);
    (async () => {
      const result = await listAppliedApplications({ signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (!result.ok) {
        setMessage(loadFailureMessage);
        setLoading(false);
        return;
      }
      const resolved = await Promise.all(
        result.applications.map(async (application): Promise<AppliedJobRow> => {
          try {
            const response = await fetch(`/api/platform/jobs/${application.canonicalJobId}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) return { application, job: undefined };
            return { application, job: (await response.json()) as CanonicalJobDetail };
          } catch {
            return { application, job: undefined };
          }
        }),
      );
      if (!mounted.current || controller.signal.aborted) return;
      setRows(resolved);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [authenticated]);

  if (!authenticated) return null;

  return (
    <section aria-label="Applied jobs">
      {loading ? (
        <p>Loading applied jobs…</p>
      ) : message ? (
        <output aria-live="polite">{message}</output>
      ) : !rows || rows.length === 0 ? (
        <p>No applications confirmed yet.</p>
      ) : (
        <ol className="job-results" aria-label="Applied jobs">
          {rows.map(({ application, job }) => {
            const confirmed = confirmedAt(application);
            return (
              <li key={application.id}>
                <article>
                  {job ? (
                    <>
                      <h3>{job.title}</h3>
                      <p>
                        <strong>{job.company.name}</strong>
                        {job.department ? ` · ${job.department}` : ""}
                      </p>
                      <p>
                        {job.locations.length > 0 ? job.locations.join(" · ") : "Location flexible"}
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>Posting no longer available</h3>
                      <p className="field-help">This job can no longer be viewed.</p>
                    </>
                  )}
                  <small>
                    Applied{confirmed ? ` ${new Date(confirmed).toLocaleDateString()}` : ""}
                  </small>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
