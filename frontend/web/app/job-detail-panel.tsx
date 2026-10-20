"use client";

import type { CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import { useEffect, useId, useRef, useState } from "react";
import { parseJobDetail } from "../lib/job-detail";
import { ApplicationsWorkspace } from "./applications-workspace";

// Applications is shown only when the deployment turns the surface on at build time; the platform
// still refuses callers whose token lacks the Applications permissions.
const applicationsUiEnabled = process.env.NEXT_PUBLIC_APPLICATIONS_UI === "enabled";

const requestTimeoutMilliseconds = 20_000;
const unavailableMessage = "Job details are temporarily unavailable. Try again.";
const timeoutMessage = "Job details timed out. Try again.";

const providerLabels = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  ugc: "Community",
  other: "Other source",
} satisfies Record<CanonicalJobDetail["sources"][number]["provider"], string>;

const provenanceLabels = {
  permitted_api: "Permitted API",
  authorized_fixture: "Authorized test fixture",
  explicit_ugc: "Community contribution",
} satisfies Record<CanonicalJobDetail["sources"][number]["provenance"], string>;

type DetailScope = { jobId: string; authenticated: boolean };
type DetailResult =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; detail: CanonicalJobDetail };
type DetailState = { scope: DetailScope; result: DetailResult };
type DetailRequest = {
  scope: DetailScope;
  generation: number;
  controller: AbortController;
  timeout: number | undefined;
  rejectDeadline: ((reason: Error) => void) | undefined;
  timedOut: boolean;
};

function cancelRequest(request: DetailRequest | undefined) {
  if (!request) return;
  window.clearTimeout(request.timeout);
  request.timeout = undefined;
  request.controller.abort();
  request.rejectDeadline?.(new Error("Job detail request cancelled."));
  request.rejectDeadline = undefined;
}

function failureMessage(status: number): string {
  if (status === 401) return "Sign in again to view job details and sources.";
  if (status === 403) return "Your session is not allowed to view job details and sources.";
  if (status === 404) return "This posting is no longer available.";
  return unavailableMessage;
}

export function JobDetailPanel({
  jobId,
  authenticated,
  submitted = false,
  onSubmitted,
}: {
  jobId: string;
  authenticated: boolean;
  /** The candidate's submission for this job is logged: the Apply step and sources are removed. */
  submitted?: boolean;
  onSubmitted?: () => void;
}) {
  const panelId = useId();
  const headingId = `${panelId}-heading`;
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const restoreTriggerFocus = useRef(false);
  const generation = useRef(0);
  const activeRequest = useRef<DetailRequest | undefined>(undefined);
  const scopeRef = useRef<DetailScope>({ jobId, authenticated });
  const [state, setState] = useState<DetailState>();

  // Fence rendering as well as callbacks before passive effect cleanup can run.
  if (scopeRef.current.jobId !== jobId || scopeRef.current.authenticated !== authenticated) {
    scopeRef.current = { jobId, authenticated };
  }
  const scope = scopeRef.current;
  const result = authenticated && state?.scope === scope ? state.result : undefined;
  const loading = result?.phase === "loading";

  useEffect(() => {
    if (scopeRef.current !== scope) return;
    generation.current += 1;
    const previous = activeRequest.current;
    activeRequest.current = undefined;
    cancelRequest(previous);
    focusHeading.current = false;
    restoreTriggerFocus.current = false;
    setState(undefined);
    return () => {
      generation.current += 1;
      const pending = activeRequest.current;
      activeRequest.current = undefined;
      cancelRequest(pending);
    };
  }, [scope]);

  useEffect(() => {
    if (!authenticated) return;
    if (result && focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
    } else if (!result && restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      trigger.current?.focus();
    }
  }, [authenticated, result]);

  function close() {
    generation.current += 1;
    const pending = activeRequest.current;
    activeRequest.current = undefined;
    cancelRequest(pending);
    focusHeading.current = false;
    restoreTriggerFocus.current = true;
    setState(undefined);
  }

  async function load() {
    if (!scopeRef.current.authenticated || activeRequest.current) return;
    const request: DetailRequest = {
      scope: scopeRef.current,
      generation: ++generation.current,
      controller: new AbortController(),
      timeout: undefined,
      rejectDeadline: undefined,
      timedOut: false,
    };
    activeRequest.current = request;
    const ownsRequest = () =>
      activeRequest.current === request &&
      generation.current === request.generation &&
      scopeRef.current === request.scope &&
      scopeRef.current.authenticated;
    const deadline = new Promise<never>((_resolve, reject) => {
      request.rejectDeadline = reject;
      request.timeout = window.setTimeout(() => {
        if (!ownsRequest()) return;
        request.timedOut = true;
        request.timeout = undefined;
        request.controller.abort();
        request.rejectDeadline?.(new Error(timeoutMessage));
        request.rejectDeadline = undefined;
      }, requestTimeoutMilliseconds);
    });
    focusHeading.current = true;
    setState({ scope: request.scope, result: { phase: "loading" } });
    try {
      const next = await Promise.race([
        (async (): Promise<DetailResult> => {
          const response = await fetch(
            `/api/platform/jobs/${encodeURIComponent(request.scope.jobId)}`,
            {
              method: "GET",
              cache: "no-store",
              credentials: "same-origin",
              redirect: "error",
              referrerPolicy: "no-referrer",
              signal: request.controller.signal,
            },
          );
          try {
            if (request.controller.signal.aborted) throw new Error("Job detail request cancelled.");
            // Never read or render provider-controlled problem bodies or transport messages.
            if (!response.ok) return { phase: "error", message: failureMessage(response.status) };
            const detail = parseJobDetail(await response.json());
            if (!detail) return { phase: "error", message: unavailableMessage };
            // A requested alias may resolve to another canonical ID. The request's scope,
            // not response.id equality, establishes ownership of this result.
            return { phase: "ready", detail };
          } finally {
            if (response.body) {
              void Promise.resolve(response.body.cancel()).catch(() => undefined);
            }
          }
        })(),
        deadline,
      ]);
      if (!ownsRequest() || request.controller.signal.aborted) return;
      setState({ scope: request.scope, result: next });
    } catch {
      if (!ownsRequest() || (request.controller.signal.aborted && !request.timedOut)) return;
      setState({
        scope: request.scope,
        result: { phase: "error", message: request.timedOut ? timeoutMessage : unavailableMessage },
      });
    } finally {
      window.clearTimeout(request.timeout);
      request.timeout = undefined;
      request.rejectDeadline = undefined;
      if (activeRequest.current === request) activeRequest.current = undefined;
    }
  }

  if (!authenticated) return null;

  return (
    <div className="job-detail">
      <button
        ref={trigger}
        className="secondary-button"
        type="button"
        aria-expanded={Boolean(result)}
        aria-controls={panelId}
        disabled={loading}
        onClick={() => {
          if (result) heading.current?.focus();
          else void load();
        }}
      >
        View details and sources
      </button>
      {result && (
        <section
          id={panelId}
          className="job-detail-content"
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="job-detail-heading">
            <h4 id={headingId} ref={heading} tabIndex={-1}>
              Job details and sources
            </h4>
            <button className="secondary-button" type="button" onClick={close}>
              Close details
            </button>
          </div>
          <p role="status" aria-live="polite">
            {loading
              ? "Loading job details and sources…"
              : result.phase === "ready"
                ? "Job details loaded."
                : ""}
          </p>
          <div aria-busy={loading}>
            {result.phase === "error" && (
              <>
                <p role="alert">{result.message}</p>
                <button className="secondary-button" type="button" onClick={() => void load()}>
                  Retry details
                </button>
              </>
            )}
            {result.phase === "ready" && (
              <>
                <p>
                  <strong>{result.detail.title}</strong>
                </p>
                <p>
                  {result.detail.company.name}
                  {result.detail.department ? ` · ${result.detail.department}` : ""}
                </p>
                <p>
                  {result.detail.locations.length
                    ? result.detail.locations.join(" · ")
                    : "Location not provided"}
                </p>
                <h5>Description</h5>
                <p className="job-detail-description">{result.detail.description}</p>
                {submitted ? null : (
                  <>
                    <h5>Sources and provenance</h5>
                    <p>Source links open external sites in a new tab.</p>
                    <ul className="job-detail-sources">
                      {result.detail.sources.map((source) => (
                        <li key={`${source.provider}-${source.canonicalUrl}`}>
                          <a
                            href={source.canonicalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                          >
                            {providerLabels[source.provider]} source (opens in a new tab)
                          </a>
                          <p>{provenanceLabels[source.provenance]}</p>
                          <p>
                            First observed{" "}
                            <time dateTime={source.firstObservedAt}>
                              {new Date(source.firstObservedAt).toLocaleDateString()}
                            </time>
                            {" · "}Last verified{" "}
                            <time dateTime={source.lastVerifiedAt}>
                              {new Date(source.lastVerifiedAt).toLocaleDateString()}
                            </time>
                          </p>
                          {source.validThrough && (
                            <p>
                              Source valid through{" "}
                              <time dateTime={source.validThrough}>
                                {new Date(source.validThrough).toLocaleDateString()}
                              </time>
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {authenticated &&
                applicationsUiEnabled &&
                !submitted &&
                result.detail.status === "active" ? (
                  <ApplicationsWorkspace
                    jobId={result.detail.id}
                    applyUrl={result.detail.sources[0]?.canonicalUrl}
                    {...(onSubmitted ? { onApplied: onSubmitted } : {})}
                  />
                ) : null}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
