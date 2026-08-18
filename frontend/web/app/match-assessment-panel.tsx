"use client";

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";
import { matchAssessmentNonclaim, matchEvidenceCopy, matchGateCopy } from "./match-assessment-copy";

const matchAssessmentTimeoutMilliseconds = 20_000;
const matchAssessmentTimeoutMessage = "Match evidence request timed out. Try again.";

type MatchAssessmentRequest = {
  controller: AbortController;
  jobId: string;
  rejectDeadline: ((reason: Error) => void) | undefined;
  timedOut: boolean;
  timeout: number | undefined;
  version: number;
};

function cancelMatchAssessmentRequest(request: MatchAssessmentRequest) {
  window.clearTimeout(request.timeout);
  request.timeout = undefined;
  request.rejectDeadline?.(new Error("Match evidence request cancelled."));
  request.rejectDeadline = undefined;
  request.controller.abort();
}

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
  const activeRequest = useRef<MatchAssessmentRequest | undefined>(undefined);
  const activeJobId = useRef(jobId);

  useEffect(() => {
    activeJobId.current = jobId;
    requestVersion.current += 1;
    if (activeRequest.current) cancelMatchAssessmentRequest(activeRequest.current);
    activeRequest.current = undefined;
    setAssessment(undefined);
    setMessage(undefined);
    setLoading(false);
    return () => {
      requestVersion.current += 1;
      if (activeRequest.current) cancelMatchAssessmentRequest(activeRequest.current);
      activeRequest.current = undefined;
    };
  }, [jobId]);

  async function load() {
    if (activeRequest.current) return;
    const nextController = new AbortController();
    const request: MatchAssessmentRequest = {
      controller: nextController,
      jobId,
      rejectDeadline: undefined,
      timedOut: false,
      timeout: undefined,
      version: ++requestVersion.current,
    };
    activeRequest.current = request;
    const deadline = new Promise<never>((_, reject) => {
      request.rejectDeadline = reject;
      request.timeout = window.setTimeout(() => {
        if (activeRequest.current !== request) return;
        request.timedOut = true;
        request.timeout = undefined;
        request.rejectDeadline?.(new Error(matchAssessmentTimeoutMessage));
        request.rejectDeadline = undefined;
        request.controller.abort();
      }, matchAssessmentTimeoutMilliseconds);
    });
    setLoading(true);
    setMessage(undefined);
    let response: Response | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          response = await fetch(
            `/api/platform/jobs/${encodeURIComponent(request.jobId)}/match-assessment`,
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
          const nextAssessment = (await response.json()) as MatchAssessment;
          if (nextAssessment.requestedJobId !== request.jobId) {
            throw new Error("Match evidence is temporarily unavailable.");
          }
          return nextAssessment;
        })(),
        deadline,
      ]);
      if (
        activeRequest.current !== request ||
        request.version !== requestVersion.current ||
        activeJobId.current !== request.jobId ||
        nextController.signal.aborted
      ) {
        return;
      }
      setAssessment(result);
    } catch (error) {
      if (
        activeRequest.current !== request ||
        request.version !== requestVersion.current ||
        activeJobId.current !== request.jobId
      ) {
        return;
      }
      if (nextController.signal.aborted && !request.timedOut) return;
      setAssessment(undefined);
      setMessage(
        request.timedOut
          ? matchAssessmentTimeoutMessage
          : error instanceof Error
            ? error.message
            : "Match evidence is unavailable.",
      );
    } finally {
      if (response?.body) {
        void Promise.resolve(response.body.cancel()).catch(() => undefined);
      }
      window.clearTimeout(request.timeout);
      request.timeout = undefined;
      request.rejectDeadline = undefined;
      if (activeRequest.current === request) {
        activeRequest.current = undefined;
        if (request.version === requestVersion.current && activeJobId.current === request.jobId) {
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
