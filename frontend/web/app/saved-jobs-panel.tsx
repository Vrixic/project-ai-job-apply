"use client";

import type { SavedJob, SavedJobPage } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export const SAVED_JOBS_CHANGED_EVENT = "ai-job-apply:saved-jobs-changed";

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { detail?: string; title?: string };
    return problem.detail ?? problem.title ?? "Saved jobs could not be updated";
  } catch {
    return "Saved jobs could not be updated";
  }
}

export function SavedJobsPanel({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<SavedJob[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(authenticated);
  const [deletingId, setDeletingId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const generation = useRef(0);
  const authenticatedRef = useRef(authenticated);
  const activeControllers = useRef(new Set<AbortController>());
  const listController = useRef<AbortController | undefined>(undefined);
  const loadVersion = useRef(0);
  authenticatedRef.current = authenticated;

  const load = useCallback(async (nextCursor: string | undefined, activeGeneration: number) => {
    const version = ++loadVersion.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    try {
      const response = await fetch("/api/platform/saved-jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageSize: 20, ...(nextCursor ? { cursor: nextCursor } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await problemMessage(response));
      const page = (await response.json()) as SavedJobPage;
      if (
        !authenticatedRef.current ||
        activeGeneration !== generation.current ||
        version !== loadVersion.current
      ) {
        return false;
      }
      setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setMessage(page.items.length === 0 && !nextCursor ? "No jobs saved yet." : undefined);
      return true;
    } catch (error) {
      if (
        !controller.signal.aborted &&
        activeGeneration === generation.current &&
        version === loadVersion.current
      ) {
        setMessage(error instanceof Error ? error.message : "Saved jobs could not be loaded");
      }
      return false;
    } finally {
      if (listController.current === controller) listController.current = undefined;
      if (
        !controller.signal.aborted &&
        activeGeneration === generation.current &&
        version === loadVersion.current
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
      for (const controller of activeControllers.current) controller.abort();
      activeControllers.current.clear();
      window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, refresh);
    };
  }, [authenticated, load]);

  async function remove(savedJobId: string) {
    if (!authenticatedRef.current || deletingId) return;
    const activeGeneration = generation.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setDeletingId(savedJobId);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/platform/saved-jobs/${encodeURIComponent(savedJobId)}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await problemMessage(response));
      if (!authenticatedRef.current || activeGeneration !== generation.current) return;
      setItems((current) => current.filter((item) => item.id !== savedJobId));
      setCursor(undefined);
      setLoading(true);
      const restarted = await load(undefined, activeGeneration);
      if (!authenticatedRef.current || activeGeneration !== generation.current) return;
      if (restarted) setMessage("Saved job removed.");
    } catch (error) {
      if (authenticatedRef.current && activeGeneration === generation.current) {
        setMessage(error instanceof Error ? error.message : "Saved job could not be removed");
      }
    } finally {
      activeControllers.current.delete(controller);
      if (authenticatedRef.current && activeGeneration === generation.current) {
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
          <h2 id="saved-jobs-heading">Saved jobs</h2>
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
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
