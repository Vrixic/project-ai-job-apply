"use client";

import type { CreateJobReportRequest } from "@ai-job-apply/api-contracts";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

type JobReportReason = CreateJobReportRequest["reason"];

const reasonOptions: readonly Readonly<{ value: JobReportReason; label: string }>[] = [
  { value: "job_closed", label: "The job is closed" },
  { value: "job_not_found", label: "The employer page cannot be found" },
  { value: "job_inaccurate", label: "Job details are inaccurate" },
  { value: "suspected_scam", label: "The listing may be a scam" },
  { value: "duplicate_listing", label: "This is a duplicate listing" },
  { value: "other_catalog_issue", label: "Another catalog issue" },
] as const;

interface RetryIntent {
  jobId: string;
  reason: JobReportReason;
  idempotencyKey: string;
}

function messageForProblem(code: string | undefined): string {
  switch (code) {
    case "job_already_reported":
      return "You already reported this job.";
    case "job_report_target_unavailable":
      return "This job is no longer available for reporting.";
    case "job_report_limit_reached":
      return "Your retained job-report limit has been reached.";
    case "authentication_required":
    case "session_expired":
      return "Sign in again to report this job.";
    case "forbidden":
      return "Your session is not allowed to report jobs.";
    default:
      return "The report could not be submitted. Try again.";
  }
}

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const value = (await response.json()) as { code?: unknown };
    return typeof value.code === "string" ? value.code : undefined;
  } catch {
    return undefined;
  }
}

export function JobReportControl({ jobId }: { jobId: string }) {
  const reasonId = useId();
  const [reason, setReason] = useState<JobReportReason | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string>();
  const retryIntent = useRef<RetryIntent | undefined>(undefined);
  const activeController = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeController.current?.abort();
    };
  }, []);

  function changeReason(value: string) {
    setReason(value as JobReportReason | "");
    retryIntent.current = undefined;
    setMessage(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || submittingRef.current || submitted) return;
    const intent =
      retryIntent.current?.jobId === jobId && retryIntent.current.reason === reason
        ? retryIntent.current
        : {
            jobId,
            reason,
            idempotencyKey: `job-report-${crypto.randomUUID()}`,
          };
    retryIntent.current = intent;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(undefined);
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/platform/jobs/${encodeURIComponent(jobId)}/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": intent.idempotencyKey,
        },
        body: JSON.stringify({ reason }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const code = await problemCode(response);
        if (code === "idempotency_conflict") retryIntent.current = undefined;
        if (!mounted.current) return;
        if (code === "job_already_reported") setSubmitted(true);
        setMessage(messageForProblem(code));
        return;
      }
      if (!mounted.current) return;
      setSubmitted(true);
      setMessage("Report received for review. Reporting does not automatically change this job.");
    } catch {
      if (mounted.current) {
        setMessage(
          controller.signal.aborted
            ? "Reporting timed out. Retry to safely check the same report."
            : "The report could not be submitted. Retry to safely check the same report.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeController.current === controller) activeController.current = undefined;
      if (mounted.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <details className="job-report-control">
      <summary>Report a catalog issue</summary>
      <form onSubmit={submit}>
        <label htmlFor={reasonId}>
          Issue
          <select
            id={reasonId}
            value={reason}
            onChange={(event) => changeReason(event.target.value)}
            disabled={submitting || submitted}
            required
          >
            <option value="">Choose an issue</option>
            {reasonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">
          Reports are reviewed. They do not automatically remove a job or pause a source.
        </p>
        <button
          type="submit"
          className="secondary-button"
          disabled={!reason || submitting || submitted}
        >
          {submitting ? "Reporting…" : submitted ? "Reported" : "Submit report"}
        </button>
        {message && <output aria-live="polite">{message}</output>}
      </form>
    </details>
  );
}
