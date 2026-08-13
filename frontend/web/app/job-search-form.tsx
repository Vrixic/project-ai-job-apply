"use client";

import type { CanonicalJobSummary, JobSearchPage } from "@ai-job-apply/api-contracts";
import { type FormEvent, useState } from "react";
import {
  appendJobSearchPage,
  buildJobSearchRequest,
  type JobSearchFields,
  jobSearchFailureAction,
} from "./job-search-state";

const initialFields: JobSearchFields = {
  query: "",
  title: "",
  company: "",
  location: "",
  verifiedWithinDays: "",
  sort: "relevance",
};

async function readProblem(response: Response): Promise<{ code?: string; message: string }> {
  try {
    const problem = (await response.json()) as { code?: string; detail?: string; title?: string };
    return {
      ...(problem.code ? { code: problem.code } : {}),
      message: problem.detail ?? problem.title ?? "Job search could not be completed",
    };
  } catch {
    return { message: "Job search could not be completed" };
  }
}

export function JobSearchForm({ authenticated }: { authenticated: boolean }) {
  const [fields, setFields] = useState(initialFields);
  const [submittedFields, setSubmittedFields] = useState<JobSearchFields>();
  const [items, setItems] = useState<CanonicalJobSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string>();

  function update<Key extends keyof JobSearchFields>(key: Key, value: JobSearchFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function search(
    requestFields: JobSearchFields,
    nextCursor?: string,
    preserveMessage = false,
  ) {
    setSearching(true);
    if (!preserveMessage) {
      setMessage(undefined);
    }
    const controller = new AbortController();
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
      setItems((current) => (nextCursor ? appendJobSearchPage(current, page) : page.items));
      setCursor(page.nextCursor);
      setMessage(
        page.items.length === 0 && !nextCursor
          ? "No active jobs matched these filters."
          : `${page.items.length} job${page.items.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Job search timed out. Try again after confirming the platform is available."
          : error instanceof Error
            ? error.message
            : "Job search could not be completed",
      );
    } finally {
      window.clearTimeout(timeout);
      setSearching(false);
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

      {!authenticated && <p>Sign in to search the candidate job catalog.</p>}
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
