"use client";

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";

const reasonLabels: Record<MatchAssessment["evidence"][number]["reasonCode"], string> = {
  work_mode_selected: "The job’s stated work mode is one you selected.",
  work_mode_conflict: "The job’s stated work mode conflicts with your selections.",
  work_mode_unavailable: "The job does not provide a usable work-mode value.",
  employment_type_selected: "The job’s stated employment type is one you selected.",
  employment_type_conflict: "The job’s stated employment type conflicts with your selections.",
  employment_type_unavailable: "The job does not provide a usable employment-type value.",
  target_role_exact_overlap: "The normalized job title exactly overlaps a target role.",
  target_role_not_established: "A target-role match is not established.",
  location_exact_overlap: "A normalized job location exactly overlaps a preferred location.",
  location_not_established: "A location match is not established.",
  compensation_semantics_unavailable:
    "Compensation cannot be compared because cadence and base-versus-total meaning are unavailable.",
  authorization_sponsorship_unavailable:
    "Authorization and sponsorship are not assessed in this general-preferences boundary.",
  seniority_semantics_unavailable: "Seniority is not yet represented by a comparable taxonomy.",
  blocked_company_preferences_unavailable: "Blocked-company preferences are not available.",
  qualification_evidence_unavailable: "Qualification evidence is not assessed by this baseline.",
};

function problemMessage(code: unknown): string {
  if (code === "match_preferences_required") {
    return "Save your job preferences before checking this evidence.";
  }
  if (code === "match_preferences_require_review") {
    return "Review and save your preferences before checking this evidence.";
  }
  if (code === "match_job_unavailable" || code === "not_found") {
    return "This posting is no longer available for assessment.";
  }
  return "Match evidence is temporarily unavailable.";
}

export function MatchAssessmentPanel({ jobId }: { jobId: string }) {
  const [assessment, setAssessment] = useState<MatchAssessment>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeJobId = useRef(jobId);

  useEffect(() => {
    activeJobId.current = jobId;
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    setAssessment(undefined);
    setMessage(undefined);
    setLoading(false);
    return () => {
      requestVersion.current += 1;
      controller.current?.abort();
    };
  }, [jobId]);

  async function load() {
    const requestedJobId = jobId;
    const version = ++requestVersion.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/platform/jobs/${encodeURIComponent(requestedJobId)}/match-assessment`,
        { cache: "no-store", signal: nextController.signal },
      );
      if (!response.ok) {
        let code: unknown;
        try {
          code = ((await response.json()) as { code?: unknown }).code;
        } catch {
          code = undefined;
        }
        throw new Error(problemMessage(code));
      }
      const result = (await response.json()) as MatchAssessment;
      if (result.requestedJobId !== requestedJobId) {
        throw new Error("Match evidence is temporarily unavailable.");
      }
      if (
        version !== requestVersion.current ||
        activeJobId.current !== requestedJobId ||
        nextController.signal.aborted
      ) {
        return;
      }
      setAssessment(result);
    } catch (error) {
      if (version !== requestVersion.current || nextController.signal.aborted) return;
      setAssessment(undefined);
      setMessage(error instanceof Error ? error.message : "Match evidence is unavailable.");
    } finally {
      if (version === requestVersion.current && !nextController.signal.aborted) {
        setLoading(false);
      }
      if (controller.current === nextController) controller.current = null;
    }
  }

  return (
    <section className="match-assessment" aria-label="Match evidence" aria-busy={loading}>
      <button
        className="secondary-button"
        type="button"
        onClick={() => void load()}
        disabled={loading}
      >
        {loading ? "Checking…" : assessment ? "Refresh match evidence" : "Check match evidence"}
      </button>
      <div aria-live="polite">
        {loading && <p>Checking match evidence…</p>}
        {message && <p>{message}</p>}
        {assessment && (
          <div className="match-assessment-result">
            <strong>
              {assessment.gate === "excluded"
                ? "Known preference conflict"
                : "Review the available evidence"}
            </strong>
            <p>
              {assessment.gate === "excluded"
                ? "At least one exact stated job attribute conflicts with your saved preferences."
                : "No exact hard conflict was found in the currently comparable attributes."}
            </p>
            <ul>
              {assessment.evidence.map((entry) => (
                <li key={entry.constraint} data-state={entry.state}>
                  <span>{entry.state.replace("_", " ")}</span> {reasonLabels[entry.reasonCode]}
                </li>
              ))}
            </ul>
            <small>
              This is deterministic evidence, not a score, eligibility decision, ranking, or
              application outcome. Unknown evidence never counts as a conflict.
            </small>
          </div>
        )}
      </div>
    </section>
  );
}
