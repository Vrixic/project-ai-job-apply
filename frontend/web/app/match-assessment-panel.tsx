"use client";

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";
import { matchAssessmentNonclaim, matchEvidenceCopy, matchGateCopy } from "./match-assessment-copy";

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
            <strong>{matchGateCopy[assessment.gate].heading}</strong>
            <p>{matchGateCopy[assessment.gate].summary}</p>
            <ul>
              {assessment.evidence.map((entry) => (
                <li key={entry.constraint} data-state={entry.state}>
                  <span>{entry.state.replace("_", " ")}</span> {matchEvidenceCopy[entry.reasonCode]}
                </li>
              ))}
            </ul>
            <small>{matchAssessmentNonclaim}</small>
          </div>
        )}
      </div>
    </section>
  );
}
