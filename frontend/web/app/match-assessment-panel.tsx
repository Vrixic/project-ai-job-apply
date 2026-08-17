"use client";

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";
import { matchAssessmentNonclaim, matchEvidenceCopy, matchGateCopy } from "./match-assessment-copy";

const matchAssessmentTimeoutMilliseconds = 20_000;
const matchAssessmentTimeoutMessage = "Match evidence request timed out. Try again.";

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
  const timeout = useRef<number | undefined>(undefined);
  const activeJobId = useRef(jobId);
  const requestInFlight = useRef(false);

  useEffect(() => {
    activeJobId.current = jobId;
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    window.clearTimeout(timeout.current);
    timeout.current = undefined;
    requestInFlight.current = false;
    setAssessment(undefined);
    setMessage(undefined);
    setLoading(false);
    return () => {
      requestVersion.current += 1;
      controller.current?.abort();
      controller.current = null;
      window.clearTimeout(timeout.current);
      timeout.current = undefined;
      requestInFlight.current = false;
    };
  }, [jobId]);

  async function load() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const requestedJobId = jobId;
    const version = ++requestVersion.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    let timedOut = false;
    const nextTimeout = window.setTimeout(() => {
      timedOut = true;
      if (timeout.current === nextTimeout) timeout.current = undefined;
      nextController.abort();
    }, matchAssessmentTimeoutMilliseconds);
    timeout.current = nextTimeout;
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
      if (timedOut) throw new Error(matchAssessmentTimeoutMessage);
      if (
        version !== requestVersion.current ||
        activeJobId.current !== requestedJobId ||
        nextController.signal.aborted
      ) {
        return;
      }
      setAssessment(result);
    } catch (error) {
      if (version !== requestVersion.current || activeJobId.current !== requestedJobId) return;
      if (nextController.signal.aborted && !timedOut) return;
      setAssessment(undefined);
      setMessage(
        timedOut
          ? matchAssessmentTimeoutMessage
          : error instanceof Error
            ? error.message
            : "Match evidence is unavailable.",
      );
    } finally {
      window.clearTimeout(nextTimeout);
      if (timeout.current === nextTimeout) timeout.current = undefined;
      if (controller.current === nextController) {
        controller.current = null;
        requestInFlight.current = false;
        if (version === requestVersion.current && activeJobId.current === requestedJobId) {
          setLoading(false);
        }
      }
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
