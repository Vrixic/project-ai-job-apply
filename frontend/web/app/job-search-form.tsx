"use client";

import type { CanonicalJobSummary, JobSearchPage } from "@ai-job-apply/api-contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { JobReportControl } from "./job-report-control";
import {
  appendJobSearchPage,
  buildJobSearchRequest,
  type JobSearchFields,
  jobSearchFailureAction,
} from "./job-search-state";
import { MatchAssessmentPanel } from "./match-assessment-panel";
import { SAVED_JOBS_CHANGED_EVENT } from "./saved-jobs-panel";

const initialFields: JobSearchFields = {
  query: "",
  title: "",
  company: "",
  location: "",
  verifiedWithinDays: "",
  sort: "relevance",
};

const saveJobTimeoutMilliseconds = 20_000;
const saveJobTimeoutMessage = "Saving timed out. Retry to safely check the same saved job.";
const saveJobFailureMessage =
  "The job could not be saved. Retry to safely check the same saved job.";

interface SaveJobIntent {
  jobId: string;
  idempotencyKey: string;
}

async function readProblem(response: Response): Promise<{ code?: string; message: string }> {
  try {
    const problem = (await response.json()) as { code?: unknown };
    const code = typeof problem.code === "string" ? problem.code : undefined;
    return {
      ...(code ? { code } : {}),
      message:
        code === "authentication_required" || code === "session_expired"
          ? "Sign in again to search or save jobs."
          : code === "forbidden"
            ? "Your session is not allowed to search or save jobs."
            : code === "invalid_request"
              ? "Check the search filters and try again."
              : "Job search is temporarily unavailable.",
    };
  } catch {
    return { message: "Job search is temporarily unavailable." };
  }
}

export function JobSearchForm({ authenticated }: { authenticated: boolean }) {
  const [fields, setFields] = useState(initialFields);
  const [submittedFields, setSubmittedFields] = useState<JobSearchFields>();
  const [items, setItems] = useState<CanonicalJobSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [savingJobId, setSavingJobId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  const keywordsRef = useRef<HTMLInputElement>(null);
  const restoreKeywordsFocus = useRef(false);
  const sessionGeneration = useRef(0);
  const activeControllers = useRef(new Set<AbortController>());
  const saveController = useRef<AbortController | undefined>(undefined);
  const saveTimeout = useRef<number | undefined>(undefined);
  const saveIntent = useRef<SaveJobIntent | undefined>(undefined);
  const saveInFlight = useRef(false);
  authenticatedRef.current = authenticated;

  useEffect(() => {
    sessionGeneration.current += 1;
    restoreKeywordsFocus.current = false;
    window.clearTimeout(saveTimeout.current);
    saveTimeout.current = undefined;
    saveController.current?.abort();
    saveController.current = undefined;
    saveIntent.current = undefined;
    saveInFlight.current = false;
    for (const controller of activeControllers.current) controller.abort();
    activeControllers.current.clear();
    setSearching(false);
    setSavingJobId(undefined);
    if (!authenticated) {
      setFields(initialFields);
      setItems([]);
      setCursor(undefined);
      setSubmittedFields(undefined);
      setMessage(undefined);
    }
    return () => {
      sessionGeneration.current += 1;
      window.clearTimeout(saveTimeout.current);
      saveTimeout.current = undefined;
      saveController.current?.abort();
      saveController.current = undefined;
      saveIntent.current = undefined;
      saveInFlight.current = false;
      for (const controller of activeControllers.current) controller.abort();
      activeControllers.current.clear();
    };
  }, [authenticated]);

  useEffect(() => {
    if (!searching && restoreKeywordsFocus.current) {
      restoreKeywordsFocus.current = false;
      if (authenticatedRef.current) keywordsRef.current?.focus();
    }
  }, [searching]);

  function update<Key extends keyof JobSearchFields>(key: Key, value: JobSearchFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function search(
    requestFields: JobSearchFields,
    nextCursor?: string,
    preserveMessage = false,
  ) {
    if (!authenticatedRef.current) return;
    const generation = sessionGeneration.current;
    setSearching(true);
    if (!preserveMessage) {
      setMessage(undefined);
    }
    const controller = new AbortController();
    activeControllers.current.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildJobSearchRequest(requestFields, nextCursor)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const problem = await readProblem(response);
        if (
          jobSearchFailureAction(response.status, problem.code, Boolean(nextCursor)) === "restart"
        ) {
          setItems([]);
          setCursor(undefined);
          setMessage("The catalog changed. Restarting this search with current jobs.");
          await search(requestFields, undefined, true);
          return;
        }
        throw new Error(problem.message);
      }
      const page = (await response.json()) as JobSearchPage;
      if (!authenticatedRef.current || generation !== sessionGeneration.current) return;
      setItems((current) => (nextCursor ? appendJobSearchPage(current, page) : page.items));
      setCursor(page.nextCursor);
      setMessage(
        page.items.length === 0 && !nextCursor
          ? "No active jobs matched these filters."
          : `${page.items.length} job${page.items.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      if (generation === sessionGeneration.current)
        setMessage(
          controller.signal.aborted
            ? "Job search timed out. Try again after confirming the platform is available."
            : error instanceof Error
              ? error.message
              : "Job search could not be completed",
        );
    } finally {
      window.clearTimeout(timeout);
      activeControllers.current.delete(controller);
      if (generation === sessionGeneration.current) {
        restoreKeywordsFocus.current = !nextCursor;
        setSearching(false);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFields = { ...fields };
    setSubmittedFields(nextFields);
    setItems([]);
    setCursor(undefined);
    await search(nextFields);
  }

  async function saveJob(jobId: string) {
    if (!authenticatedRef.current || saveInFlight.current) return;
    saveInFlight.current = true;
    const generation = sessionGeneration.current;
    const intent =
      saveIntent.current?.jobId === jobId
        ? saveIntent.current
        : { jobId, idempotencyKey: `saved-job-${crypto.randomUUID()}` };
    saveIntent.current = intent;
    const controller = new AbortController();
    saveController.current?.abort();
    saveController.current = controller;
    activeControllers.current.add(controller);
    setSavingJobId(jobId);
    setMessage(undefined);
    let timedOut = false;
    let rejectedMessage: string | undefined;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      if (saveTimeout.current === timeout) saveTimeout.current = undefined;
      controller.abort();
    }, saveJobTimeoutMilliseconds);
    saveTimeout.current = timeout;
    try {
      const response = await fetch("/api/platform/saved-jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": intent.idempotencyKey,
        },
        body: JSON.stringify({ jobId: intent.jobId }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        if (timedOut) throw new Error("saved job request timed out");
        return;
      }
      if (!response.ok) {
        const problem = await readProblem(response);
        rejectedMessage = problem.message;
        if (
          response.status < 500 &&
          authenticatedRef.current &&
          generation === sessionGeneration.current &&
          saveIntent.current === intent
        ) {
          saveIntent.current = undefined;
        }
        throw new Error("saved job request rejected");
      }
      if (
        !authenticatedRef.current ||
        generation !== sessionGeneration.current ||
        saveIntent.current !== intent
      ) {
        return;
      }
      saveIntent.current = undefined;
      setMessage("Job saved to your private list.");
      window.dispatchEvent(new Event(SAVED_JOBS_CHANGED_EVENT));
    } catch {
      if (
        authenticatedRef.current &&
        generation === sessionGeneration.current &&
        (!controller.signal.aborted || timedOut)
      ) {
        setMessage(timedOut ? saveJobTimeoutMessage : (rejectedMessage ?? saveJobFailureMessage));
      }
    } finally {
      window.clearTimeout(timeout);
      if (saveTimeout.current === timeout) saveTimeout.current = undefined;
      activeControllers.current.delete(controller);
      if (saveController.current === controller) {
        saveController.current = undefined;
        saveInFlight.current = false;
        if (generation === sessionGeneration.current) setSavingJobId(undefined);
      }
    }
  }

  if (!authenticated) {
    return (
      <section className="job-search" aria-labelledby="job-search-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Active job catalog</span>
            <h2 id="job-search-heading">Search current jobs</h2>
          </div>
        </div>
        <p>Sign in to search the candidate job catalog.</p>
      </section>
    );
  }

  return (
    <section className="job-search" aria-labelledby="job-search-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Active job catalog</span>
          <h2 id="job-search-heading">Search current jobs</h2>
        </div>
      </div>
      <p>
        Search verified, unexpired postings. These results are not personalized or ranked from
        private profile facts.
      </p>
      <form className="compact-form job-search-fields" onSubmit={submit}>
        <label>
          Keywords
          <span>Title, description, department, or company</span>
          <input
            ref={keywordsRef}
            type="search"
            maxLength={200}
            value={fields.query}
            onChange={(event) => update("query", event.target.value)}
            disabled={!authenticated || searching}
          />
        </label>
        <label>
          Job title
          <span>Matches one stored title exactly</span>
          <input
            maxLength={200}
            value={fields.title}
            onChange={(event) => update("title", event.target.value)}
            disabled={!authenticated || searching}
          />
        </label>
        <label>
          Company
          <input
            maxLength={200}
            value={fields.company}
            onChange={(event) => update("company", event.target.value)}
            disabled={!authenticated || searching}
          />
        </label>
        <label>
          Location
          <input
            maxLength={200}
            value={fields.location}
            onChange={(event) => update("location", event.target.value)}
            disabled={!authenticated || searching}
          />
        </label>
        <label>
          Verified within days
          <input
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            value={fields.verifiedWithinDays}
            onChange={(event) => update("verifiedWithinDays", event.target.value)}
            disabled={!authenticated || searching}
          />
        </label>
        <label>
          Sort
          <select
            value={fields.sort}
            onChange={(event) => update("sort", event.target.value as JobSearchFields["sort"])}
            disabled={!authenticated || searching}
          >
            <option value="relevance">Relevance</option>
            <option value="freshness">Freshness</option>
          </select>
        </label>
        <button type="submit" disabled={!authenticated || searching}>
          {searching && !cursor ? "Searching…" : "Search jobs"}
        </button>
      </form>

      {message && <output aria-live="polite">{message}</output>}
      {items.length > 0 && (
        <ol className="job-results" aria-label="Job search results">
          {items.map((job) => (
            <li key={job.id}>
              <article>
                <h3>{job.title}</h3>
                <p>
                  <strong>{job.company.name}</strong>
                  {job.department ? ` · ${job.department}` : ""}
                </p>
                <p>{job.locations.length > 0 ? job.locations.join(" · ") : "Location flexible"}</p>
                <small>Verified {new Date(job.lastVerifiedAt).toLocaleDateString()}</small>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void saveJob(job.id)}
                  disabled={!authenticated || Boolean(savingJobId)}
                >
                  {savingJobId === job.id ? "Saving…" : "Save job"}
                </button>
                <JobReportControl jobId={job.id} />
                <MatchAssessmentPanel jobId={job.id} />
              </article>
            </li>
          ))}
        </ol>
      )}
      {cursor && submittedFields && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => search(submittedFields, cursor)}
          disabled={searching}
        >
          {searching ? "Loading…" : "Load more jobs"}
        </button>
      )}
    </section>
  );
}
