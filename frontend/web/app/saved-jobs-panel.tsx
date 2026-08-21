"use client";

import type { SavedJob, SavedJobPage } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { MatchAssessmentPanel } from "./match-assessment-panel";

export const SAVED_JOBS_CHANGED_EVENT = "ai-job-apply:saved-jobs-changed";

const savedJobsRequestTimeoutMilliseconds = 20_000;
const savedJobsLoadTimeoutMessage = "Loading saved jobs timed out. Try again.";
const savedJobDeleteTimeoutMessage =
  "Removing the saved job timed out. Retry to safely check the same saved job.";

class SavedJobsRequestDeadlineError extends Error {}

function startDeadline(controller: AbortController): {
  clear: () => void;
  wait: Promise<never>;
  timedOut: () => boolean;
} {
  let didTimeOut = false;
  let rejectDeadline: ((reason?: unknown) => void) | undefined;
  const wait = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const clear = () => {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", abort);
    rejectDeadline = undefined;
  };
  const abort = () => {
    const reject = rejectDeadline;
    clear();
    reject?.(new Error("The saved-jobs request was cancelled"));
  };
  const timer = window.setTimeout(() => {
    didTimeOut = true;
    const reject = rejectDeadline;
    rejectDeadline = undefined;
    reject?.(new SavedJobsRequestDeadlineError("The saved-jobs request timed out"));
    controller.abort();
  }, savedJobsRequestTimeoutMilliseconds);
  controller.signal.addEventListener("abort", abort, { once: true });
  return { clear, wait, timedOut: () => didTimeOut };
}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { code?: unknown };
    const code = typeof problem.code === "string" ? problem.code : undefined;
    return code === "authentication_required" || code === "session_expired"
      ? "Sign in again to view or update saved jobs."
      : code === "forbidden"
        ? "Your session is not allowed to view or update saved jobs."
        : code === "invalid_request"
          ? "Check the saved-jobs request and try again."
          : "Saved jobs are temporarily unavailable.";
  } catch {
    return "Saved jobs are temporarily unavailable.";
  }
}

export function SavedJobsPanel({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<SavedJob[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(authenticated);
  const [deletingId, setDeletingId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const generation = useRef(0);
  const authenticatedRef = useRef(authenticated);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listController = useRef<AbortController | undefined>(undefined);
  const activeDelete = useRef<
    | {
        controller: AbortController;
        generation: number;
        savedJobId: string;
      }
    | undefined
  >(undefined);
  const loadVersion = useRef(0);
  authenticatedRef.current = authenticated;

  const load = useCallback(async (nextCursor: string | undefined, activeGeneration: number) => {
    const version = ++loadVersion.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const deadline = startDeadline(controller);
    if (authenticatedRef.current && activeGeneration === generation.current) {
      setLoadFailed(false);
    }
    let response: Response | undefined;
    try {
      const read = async (): Promise<SavedJobPage> => {
        response = await fetch("/api/platform/saved-jobs/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pageSize: 20, ...(nextCursor ? { cursor: nextCursor } : {}) }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new Error("The saved-jobs request was aborted");
        if (!response.ok) throw new Error(await problemMessage(response));
        return (await response.json()) as SavedJobPage;
      };
      const page = await Promise.race([read(), deadline.wait]);
      if (
        controller.signal.aborted ||
        !authenticatedRef.current ||
        activeGeneration !== generation.current ||
        version !== loadVersion.current
      ) {
        return false;
      }
      setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setLoadFailed(false);
      setMessage(page.items.length === 0 && !nextCursor ? "No jobs saved yet." : undefined);
      return true;
    } catch (error) {
      if (
        authenticatedRef.current &&
        activeGeneration === generation.current &&
        version === loadVersion.current &&
        (deadline.timedOut() || !controller.signal.aborted)
      ) {
        setLoadFailed(true);
        setMessage(
          deadline.timedOut()
            ? savedJobsLoadTimeoutMessage
            : error instanceof Error
              ? error.message
              : "Saved jobs could not be loaded",
        );
      }
      return false;
    } finally {
      if (response?.body) {
        void Promise.resolve(response.body.cancel()).catch(() => undefined);
      }
      deadline.clear();
      if (listController.current === controller) listController.current = undefined;
      if (
        activeGeneration === generation.current &&
        version === loadVersion.current &&
        (deadline.timedOut() || !controller.signal.aborted)
      ) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const activeGeneration = ++generation.current;
    setItems([]);
    setCursor(undefined);
    setDeletingId(undefined);
    setMessage(undefined);
    setLoadFailed(false);
    activeDelete.current?.controller.abort();
    activeDelete.current = undefined;
    if (!authenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(undefined, activeGeneration);
    const refresh = () => {
      if (authenticatedRef.current && activeGeneration === generation.current) {
        setLoading(true);
        void load(undefined, activeGeneration);
      }
    };
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, refresh);
    return () => {
      generation.current += 1;
      loadVersion.current += 1;
      listController.current?.abort();
      listController.current = undefined;
      activeDelete.current?.controller.abort();
      activeDelete.current = undefined;
      window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, refresh);
    };
  }, [authenticated, load]);

  async function remove(savedJobId: string) {
    if (!authenticatedRef.current || activeDelete.current) return;
    const activeGeneration = generation.current;
    const controller = new AbortController();
    const request = { controller, generation: activeGeneration, savedJobId };
    activeDelete.current = request;
    const deadline = startDeadline(controller);
    let response: Response | undefined;
    setDeletingId(savedJobId);
    setMessage(undefined);
    try {
      const read = async (): Promise<void> => {
        response = await fetch(`/api/platform/saved-jobs/${encodeURIComponent(savedJobId)}`, {
          method: "DELETE",
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new Error("The saved-job removal was aborted");
        if (!response.ok) throw new Error(await problemMessage(response));
      };
      await Promise.race([read(), deadline.wait]);
      deadline.clear();
      if (
        controller.signal.aborted ||
        !authenticatedRef.current ||
        activeGeneration !== generation.current ||
        activeDelete.current !== request
      ) {
        return;
      }
      setItems((current) => current.filter((item) => item.id !== savedJobId));
      setCursor(undefined);
      setLoading(true);
      const restarted = await load(undefined, activeGeneration);
      if (!authenticatedRef.current || activeGeneration !== generation.current) return;
      if (restarted) setMessage("Saved job removed.");
      headingRef.current?.focus();
    } catch (error) {
      if (
        authenticatedRef.current &&
        activeGeneration === generation.current &&
        activeDelete.current === request &&
        (deadline.timedOut() || !controller.signal.aborted)
      ) {
        setMessage(
          deadline.timedOut()
            ? savedJobDeleteTimeoutMessage
            : error instanceof Error
              ? error.message
              : "Saved job could not be removed",
        );
      }
    } finally {
      if (response?.body) {
        void Promise.resolve(response.body.cancel()).catch(() => undefined);
      }
      deadline.clear();
      if (activeDelete.current === request) activeDelete.current = undefined;
      if (
        authenticatedRef.current &&
        activeGeneration === generation.current &&
        activeDelete.current === undefined
      ) {
        setDeletingId(undefined);
      }
    }
  }

  if (!authenticated) {
    return (
      <section className="saved-jobs" aria-labelledby="saved-jobs-heading">
        <h2 id="saved-jobs-heading">Saved jobs</h2>
        <p>Sign in to keep a private list of jobs.</p>
      </section>
    );
  }

  return (
    <section className="saved-jobs" aria-labelledby="saved-jobs-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Private candidate list</span>
          <h2 id="saved-jobs-heading" ref={headingRef} tabIndex={-1}>
            Saved jobs
          </h2>
        </div>
      </div>
      <p>
        Each distinct job target you save is retained. Matching and application outcomes are not
        inferred here.
      </p>
      {loading && items.length === 0 && <p>Loading saved jobs…</p>}
      {items.length > 0 && (
        <ol className="job-results" aria-label="Saved jobs">
          {items.map((saved) => {
            const job =
              saved.availability.state === "available"
                ? saved.availability.currentJob
                : saved.snapshot;
            return (
              <li key={saved.id}>
                <article>
                  <h3>{job.title}</h3>
                  <p>
                    <strong>{job.company.name}</strong>
                    {job.department ? ` · ${job.department}` : ""}
                  </p>
                  <p>{job.locations.join(" · ")}</p>
                  {saved.availability.state === "unavailable" && (
                    <small>This posting is no longer available in the active catalog.</small>
                  )}
                  {saved.availability.state === "available" && (
                    <MatchAssessmentPanel jobId={saved.requestedJobId} />
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void remove(saved.id)}
                    disabled={Boolean(deletingId)}
                  >
                    {deletingId === saved.id ? "Removing…" : "Remove"}
                  </button>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      {cursor && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setLoading(true);
            void load(cursor, generation.current);
          }}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more saved jobs"}
        </button>
      )}
      {loadFailed && !loading && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setLoading(true);
            void load(undefined, generation.current);
          }}
        >
          Retry saved jobs
        </button>
      )}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
