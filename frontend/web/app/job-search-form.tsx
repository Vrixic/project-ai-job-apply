"use client";

import type { CanonicalJobSummary, JobSearchPage } from "@ai-job-apply/api-contracts";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { APPLICATIONS_CHANGED_EVENT, listAppliedApplications } from "../lib/applications-client";
import { JobDetailPanel } from "./job-detail-panel";
import { JobReportControl } from "./job-report-control";
import {
  appendJobSearchPage,
  buildJobSearchRequest,
  type JobSearchFields,
  jobSearchFailureAction,
} from "./job-search-state";
import { MatchAssessmentPanel } from "./match-assessment-panel";
import { SAVED_JOBS_CHANGED_EVENT } from "./saved-jobs-panel";

// Applications is shown only when the deployment turns the surface on at build time; the platform
// still refuses callers whose token lacks the Applications permissions.
const applicationsUiEnabled = process.env.NEXT_PUBLIC_APPLICATIONS_UI === "enabled";

const initialFields: JobSearchFields = {
  query: "",
  title: "",
  company: "",
  location: "",
  verifiedWithinDays: "",
  sort: "relevance",
};

const saveJobTimeoutMilliseconds = 20_000;
const jobSearchTimeoutMilliseconds = 20_000;
const saveJobTimeoutMessage = "Saving timed out. Retry to safely check the same saved job.";
const saveJobFailureMessage =
  "The job could not be saved. Retry to safely check the same saved job.";

interface SaveJobIntent {
  jobId: string;
  idempotencyKey: string;
}

interface SaveJobAttempt {
  controller: AbortController;
  generation: number;
  intent: SaveJobIntent;
  rejectDeadline: ((reason?: unknown) => void) | undefined;
  timedOut: boolean;
  timeout: number | undefined;
}

class SaveJobRequestDeadlineError extends Error {}

interface JobSearchChain {
  generation: number;
  controller: AbortController | undefined;
  timeout: number | undefined;
}

type JobSearchRequestResult =
  | { action: "success"; page: JobSearchPage }
  | { action: "restart" }
  | { action: "error"; message: string };

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

export function JobSearchForm({
  authenticated,
  savedPanel,
  appliedPanel,
}: {
  authenticated: boolean;
  /** When provided, renders a Search/Saved toggle alongside the filter bar and shows this in the "Saved" view. */
  savedPanel?: ReactNode;
  /** When provided alongside savedPanel, adds an Applied tab and shows this in it. */
  appliedPanel?: ReactNode;
}) {
  const [jobsView, setJobsView] = useState<"search" | "saved" | "applied">("search");
  const filterFormId = useId();
  const [fields, setFields] = useState(initialFields);
  const [submittedFields, setSubmittedFields] = useState<JobSearchFields>();
  const [items, setItems] = useState<CanonicalJobSummary[]>([]);
  const [appliedJobIds, setAppliedJobIds] = useState<ReadonlySet<string>>(() => new Set());
  const [appliedRefresh, setAppliedRefresh] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [savingJobId, setSavingJobId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  const keywordsRef = useRef<HTMLInputElement>(null);
  const restoreKeywordsFocus = useRef(false);
  const sessionGeneration = useRef(0);
  const activeControllers = useRef(new Set<AbortController>());
  const searchChain = useRef<JobSearchChain | undefined>(undefined);
  const activeSave = useRef<SaveJobAttempt | undefined>(undefined);
  const saveIntent = useRef<SaveJobIntent | undefined>(undefined);
  authenticatedRef.current = authenticated;

  useEffect(() => {
    sessionGeneration.current += 1;
    restoreKeywordsFocus.current = false;
    const currentSearch = searchChain.current;
    searchChain.current = undefined;
    window.clearTimeout(currentSearch?.timeout);
    if (currentSearch) currentSearch.timeout = undefined;
    currentSearch?.controller?.abort();
    if (currentSearch) currentSearch.controller = undefined;
    const currentSave = activeSave.current;
    activeSave.current = undefined;
    if (currentSave?.timeout !== undefined) window.clearTimeout(currentSave.timeout);
    if (currentSave) currentSave.timeout = undefined;
    currentSave?.controller.abort();
    currentSave?.rejectDeadline?.(new Error("saved job request cancelled"));
    if (currentSave) currentSave.rejectDeadline = undefined;
    saveIntent.current = undefined;
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
      const pendingSearch = searchChain.current;
      searchChain.current = undefined;
      window.clearTimeout(pendingSearch?.timeout);
      if (pendingSearch) pendingSearch.timeout = undefined;
      pendingSearch?.controller?.abort();
      if (pendingSearch) pendingSearch.controller = undefined;
      const pendingSave = activeSave.current;
      activeSave.current = undefined;
      if (pendingSave?.timeout !== undefined) window.clearTimeout(pendingSave.timeout);
      if (pendingSave) pendingSave.timeout = undefined;
      pendingSave?.controller.abort();
      pendingSave?.rejectDeadline?.(new Error("saved job request cancelled"));
      if (pendingSave) pendingSave.rejectDeadline = undefined;
      saveIntent.current = undefined;
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

  useEffect(() => {
    const refresh = () => setAppliedRefresh((value) => value + 1);
    window.addEventListener(APPLICATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(APPLICATIONS_CHANGED_EVENT, refresh);
  }, []);

  // Submitted jobs are excluded from search results; see the filter in `results` below. A new
  // submission only adds to the set, so a job stays hidden even if this read fails.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a logged submission triggers a fresh read.
  useEffect(() => {
    if (!authenticated || !applicationsUiEnabled) {
      setAppliedJobIds(new Set());
      return;
    }
    const controller = new AbortController();
    void listAppliedApplications({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      setAppliedJobIds(
        (current) =>
          new Set([
            ...current,
            ...result.applications.map((application) => application.canonicalJobId),
          ]),
      );
    });
    return () => controller.abort();
  }, [authenticated, appliedRefresh]);

  function update<Key extends keyof JobSearchFields>(key: Key, value: JobSearchFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function requestSearchPage(
    chain: JobSearchChain,
    requestFields: JobSearchFields,
    nextCursor?: string,
  ): Promise<"complete" | "restart"> {
    if (
      !authenticatedRef.current ||
      chain.generation !== sessionGeneration.current ||
      searchChain.current !== chain
    ) {
      return "complete";
    }
    const controller = new AbortController();
    chain.controller = controller;
    activeControllers.current.add(controller);
    let timedOut = false;
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeout = window.setTimeout(() => {
      if (searchChain.current === chain && chain.controller === controller) {
        timedOut = true;
        controller.abort();
        rejectDeadline?.(new DOMException("Timed out", "AbortError"));
      }
    }, jobSearchTimeoutMilliseconds);
    chain.timeout = timeout;
    const ownsSearch = () =>
      authenticatedRef.current &&
      chain.generation === sessionGeneration.current &&
      searchChain.current === chain;

    try {
      const response = await Promise.race([
        (async (): Promise<JobSearchRequestResult> => {
          const searchResponse = await fetch("/api/platform/jobs/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(buildJobSearchRequest(requestFields, nextCursor)),
            signal: controller.signal,
          });
          if (!searchResponse.ok) {
            const problem = await readProblem(searchResponse);
            return jobSearchFailureAction(
              searchResponse.status,
              problem.code,
              Boolean(nextCursor),
            ) === "restart"
              ? { action: "restart" }
              : { action: "error", message: problem.message };
          }
          return { action: "success", page: (await searchResponse.json()) as JobSearchPage };
        })(),
        deadline,
      ]);
      if (!ownsSearch()) return "complete";
      if (response.action === "restart") return "restart";
      if (response.action === "error") throw new Error(response.message);
      const { page } = response;
      setItems((current) => (nextCursor ? appendJobSearchPage(current, page) : page.items));
      setCursor(page.nextCursor);
      setMessage(
        page.items.length === 0 && !nextCursor
          ? "No active jobs matched these filters."
          : `${page.items.length} job${page.items.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      if (ownsSearch()) {
        setMessage(
          timedOut
            ? "Job search timed out. Try again after confirming the platform is available."
            : error instanceof Error
              ? error.message
              : "Job search could not be completed",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      activeControllers.current.delete(controller);
      if (chain.timeout === timeout) chain.timeout = undefined;
      if (chain.controller === controller) chain.controller = undefined;
    }
    return "complete";
  }

  async function search(requestFields: JobSearchFields, nextCursor?: string) {
    if (!authenticatedRef.current || searchChain.current) return;
    const chain: JobSearchChain = {
      generation: sessionGeneration.current,
      controller: undefined,
      timeout: undefined,
    };
    searchChain.current = chain;
    setSearching(true);
    setMessage(undefined);
    try {
      const action = await requestSearchPage(chain, requestFields, nextCursor);
      if (
        action === "restart" &&
        authenticatedRef.current &&
        chain.generation === sessionGeneration.current &&
        searchChain.current === chain
      ) {
        setItems([]);
        setCursor(undefined);
        setMessage("The catalog changed. Restarting this search with current jobs.");
        await requestSearchPage(chain, requestFields);
      }
    } finally {
      if (searchChain.current === chain) {
        searchChain.current = undefined;
      }
      if (chain.generation === sessionGeneration.current) {
        restoreKeywordsFocus.current = !nextCursor;
        setSearching(false);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticatedRef.current || searchChain.current) return;
    const nextFields = { ...fields };
    setSubmittedFields(nextFields);
    setItems([]);
    setCursor(undefined);
    await search(nextFields);
  }

  async function saveJob(jobId: string) {
    if (!authenticatedRef.current || activeSave.current) return;
    const generation = sessionGeneration.current;
    const intent =
      saveIntent.current?.jobId === jobId
        ? saveIntent.current
        : { jobId, idempotencyKey: `saved-job-${crypto.randomUUID()}` };
    saveIntent.current = intent;
    const controller = new AbortController();
    const attempt: SaveJobAttempt = {
      controller,
      generation,
      intent,
      rejectDeadline: undefined,
      timedOut: false,
      timeout: undefined,
    };
    activeSave.current = attempt;
    activeControllers.current.add(controller);
    setSavingJobId(jobId);
    setMessage(undefined);
    let rejectedMessage: string | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      attempt.rejectDeadline = reject;
    });
    attempt.timeout = window.setTimeout(() => {
      if (activeSave.current !== attempt) return;
      attempt.timedOut = true;
      attempt.timeout = undefined;
      controller.abort();
      attempt.rejectDeadline?.(new SaveJobRequestDeadlineError("saved job request timed out"));
      attempt.rejectDeadline = undefined;
    }, saveJobTimeoutMilliseconds);
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetch("/api/platform/saved-jobs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": attempt.intent.idempotencyKey,
            },
            body: JSON.stringify({ jobId: attempt.intent.jobId }),
            signal: controller.signal,
          });
          if (controller.signal.aborted) throw new SaveJobRequestDeadlineError();
          if (!response.ok) return { response, problem: await readProblem(response) };
          await response.json();
          return { response, problem: undefined };
        })(),
        deadline,
      ]);
      if (
        activeSave.current !== attempt ||
        !authenticatedRef.current ||
        attempt.generation !== sessionGeneration.current ||
        saveIntent.current !== attempt.intent ||
        controller.signal.aborted
      ) {
        return;
      }
      const { problem, response } = result;
      if (!response.ok) {
        rejectedMessage = problem?.message;
        if (response.status < 500 && saveIntent.current === attempt.intent) {
          saveIntent.current = undefined;
        }
        throw new Error("saved job request rejected");
      }
      saveIntent.current = undefined;
      setMessage("Job saved to your private list.");
      window.dispatchEvent(new Event(SAVED_JOBS_CHANGED_EVENT));
    } catch {
      if (
        authenticatedRef.current &&
        attempt.generation === sessionGeneration.current &&
        activeSave.current === attempt &&
        (!controller.signal.aborted || attempt.timedOut)
      ) {
        setMessage(
          attempt.timedOut ? saveJobTimeoutMessage : (rejectedMessage ?? saveJobFailureMessage),
        );
      }
    } finally {
      if (attempt.timeout !== undefined) window.clearTimeout(attempt.timeout);
      attempt.timeout = undefined;
      attempt.rejectDeadline = undefined;
      activeControllers.current.delete(controller);
      if (activeSave.current === attempt) {
        activeSave.current = undefined;
        if (attempt.generation === sessionGeneration.current) setSavingJobId(undefined);
      }
    }
  }

  if (!authenticated) {
    return (
      <section className="job-search" aria-label="Search current jobs">
        <p>Sign in to search the candidate job catalog.</p>
      </section>
    );
  }

  const primaryFilters = (
    <>
      <label className="job-filter">
        <span>Keywords</span>
        <input
          ref={keywordsRef}
          type="search"
          maxLength={200}
          placeholder="Title, description, department, or company"
          value={fields.query}
          onChange={(event) => update("query", event.target.value)}
          disabled={!authenticated || searching}
        />
      </label>
      <label className="job-filter">
        <span>Title</span>
        <input
          maxLength={200}
          placeholder="Exact stored title"
          value={fields.title}
          onChange={(event) => update("title", event.target.value)}
          disabled={!authenticated || searching}
        />
      </label>
      <label className="job-filter">
        <span>Company</span>
        <input
          maxLength={200}
          value={fields.company}
          onChange={(event) => update("company", event.target.value)}
          disabled={!authenticated || searching}
        />
      </label>
      <label className="job-filter">
        <span>Location</span>
        <input
          maxLength={200}
          value={fields.location}
          onChange={(event) => update("location", event.target.value)}
          disabled={!authenticated || searching}
        />
      </label>
      <label className="job-filter job-filter-narrow">
        <span>Verified within</span>
        <input
          type="number"
          min={1}
          max={365}
          inputMode="numeric"
          placeholder="Days"
          value={fields.verifiedWithinDays}
          onChange={(event) => update("verifiedWithinDays", event.target.value)}
          disabled={!authenticated || searching}
        />
      </label>
    </>
  );

  const sortAndSubmit = (formId?: string) => (
    <>
      <label className="job-filter job-filter-narrow">
        <span>Sort</span>
        <select
          form={formId}
          value={fields.sort}
          onChange={(event) => update("sort", event.target.value as JobSearchFields["sort"])}
          disabled={!authenticated || searching}
        >
          <option value="relevance">Relevance</option>
          <option value="freshness">Freshness</option>
        </select>
      </label>
      <button
        form={formId}
        className="job-filter-submit"
        type="submit"
        disabled={!authenticated || searching}
      >
        {searching && !cursor ? "Searching…" : "Search"}
      </button>
    </>
  );

  const visibleItems =
    appliedJobIds.size > 0 ? items.filter((job) => !appliedJobIds.has(job.id)) : items;

  const results = (
    <>
      {message && <output aria-live="polite">{message}</output>}
      {visibleItems.length > 0 ? <h2>Search results</h2> : null}
      {visibleItems.length > 0 && (
        <ol className="job-results" aria-label="Job search results">
          {visibleItems.map((job) => (
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
                <JobDetailPanel
                  jobId={job.id}
                  authenticated={authenticated}
                  onSubmitted={() =>
                    setAppliedJobIds((current) =>
                      current.has(job.id) ? current : new Set(current).add(job.id),
                    )
                  }
                />
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
    </>
  );

  if (savedPanel) {
    return (
      <>
        <div className="jobs-toolbar">
          <div className="dashboard-subtabs" role="tablist" aria-label="Jobs view">
            <button
              type="button"
              role="tab"
              aria-selected={jobsView === "search"}
              className="dashboard-subtab"
              onClick={() => setJobsView("search")}
            >
              Search
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={jobsView === "saved"}
              className="dashboard-subtab"
              onClick={() => setJobsView("saved")}
            >
              Saved
            </button>
            {appliedPanel && (
              <button
                type="button"
                role="tab"
                aria-selected={jobsView === "applied"}
                className="dashboard-subtab"
                onClick={() => setJobsView("applied")}
              >
                Applied
              </button>
            )}
          </div>
          <form
            id={filterFormId}
            className="job-filter-bar"
            onSubmit={submit}
            aria-label="Job filters"
            hidden={jobsView !== "search"}
          >
            {primaryFilters}
          </form>
          <div className="jobs-toolbar-row2">
            <div className="job-filter-secondary" hidden={jobsView !== "search"}>
              {sortAndSubmit(filterFormId)}
            </div>
          </div>
        </div>
        <div hidden={jobsView !== "search"}>{results}</div>
        <div hidden={jobsView !== "saved"}>{savedPanel}</div>
        {appliedPanel && <div hidden={jobsView !== "applied"}>{appliedPanel}</div>}
      </>
    );
  }

  return (
    <section className="job-search" aria-label="Search current jobs">
      <form className="job-filter-bar" onSubmit={submit} aria-label="Job filters">
        {primaryFilters}
        {sortAndSubmit()}
      </form>
      {results}
    </section>
  );
}
