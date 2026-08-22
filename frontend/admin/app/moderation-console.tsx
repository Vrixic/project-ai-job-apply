"use client";

import type {
  JobReportSummary,
  ModerationCase,
  ModerationCasePage,
  OpenModerationCaseRequest,
  ResolveModerationCaseRequest,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";

const reasonLabels = {
  candidate_reports: "Candidate reports",
  catalog_integrity: "Catalog integrity",
  source_integrity: "Source integrity",
} as const;

type PendingDecision = Readonly<{
  caseId: string;
  targetLabel: string;
  request: ResolveModerationCaseRequest;
}>;

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error("The moderation request failed. Refresh and try again.");
  return value as T;
}

export function ModerationConsole() {
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [targetKind, setTargetKind] = useState<"job" | "source">("job");
  const [message, setMessage] = useState("Loading moderation cases…");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<JobReportSummary>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>();
  const queueRequest = useRef<AbortController | undefined>(undefined);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const loadCases = useCallback(
    async (requestedStatus = status, cursor?: string) => {
      queueRequest.current?.abort();
      const controller = new AbortController();
      queueRequest.current = controller;
      setBusy(true);
      setMessage("Loading moderation cases…");
      try {
        const page = await jsonRequest<ModerationCasePage>("/api/moderation/cases/search", {
          method: "POST",
          body: JSON.stringify({
            status: requestedStatus,
            pageSize: 50,
            ...(cursor && { cursor }),
          }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCases((current) => (cursor ? [...current, ...page.items] : [...page.items]));
        setNextCursor(page.nextCursor);
        setMessage(
          page.items.length === 0
            ? cursor
              ? "No more cases."
              : `No ${requestedStatus} cases.`
            : `${page.items.length} ${cursor ? "more " : ""}cases loaded.`,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "The moderation request failed.");
      } finally {
        if (queueRequest.current === controller) setBusy(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void loadCases();
    return () => queueRequest.current?.abort();
  }, [loadCases]);

  useEffect(() => {
    if (pendingDecision) confirmButton.current?.focus();
  }, [pendingDecision]);

  async function openCase(form: FormData) {
    setBusy(true);
    setMessage("Opening moderation case…");
    const kind = form.get("kind") === "source" ? "source" : "job";
    const request: OpenModerationCaseRequest =
      kind === "job"
        ? {
            target: { kind, jobId: String(form.get("jobId") ?? "") },
            reasonCode: String(form.get("jobReason") ?? "") as
              | "candidate_reports"
              | "catalog_integrity",
          }
        : {
            target: {
              kind,
              sourceId: String(form.get("sourceId") ?? ""),
              adapterVersion: String(form.get("adapterVersion") ?? ""),
              adapterConfigSha256: String(form.get("adapterConfigSha256") ?? ""),
            },
            reasonCode: "source_integrity",
          };
    try {
      await jsonRequest<ModerationCase>("/api/moderation/cases", {
        method: "POST",
        body: JSON.stringify(request),
      });
      setStatus("open");
      await loadCases("open");
      setMessage("Moderation case opened.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The moderation request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveCase(caseId: string, request: ResolveModerationCaseRequest) {
    setBusy(true);
    setMessage("Recording moderation decision…");
    try {
      await jsonRequest<ModerationCase>(`/api/moderation/cases/${caseId}/resolve`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      setPendingDecision(undefined);
      await loadCases();
      setMessage("Moderation decision recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The moderation request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSummary(jobId: string) {
    setBusy(true);
    setMessage("Loading aggregate candidate reports…");
    try {
      setSummary(
        await jsonRequest<JobReportSummary>(`/api/moderation/jobs/${jobId}/report-summary`, {
          method: "GET",
        }),
      );
      setMessage("Aggregate candidate reports loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The moderation request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console">
      <output aria-live="polite">{message}</output>
      <section>
        <h2>Open a review case</h2>
        <form action={openCase}>
          <label>
            Target type
            <select
              name="kind"
              value={targetKind}
              onChange={(event) => setTargetKind(event.target.value as "job" | "source")}
            >
              <option value="job">Canonical job</option>
              <option value="source">Exact source configuration</option>
            </select>
          </label>
          {targetKind === "job" ? (
            <>
              <label>
                Job UUID
                <input
                  name="jobId"
                  autoComplete="off"
                  required
                  pattern="[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
                />
              </label>
              <label>
                Job review reason
                <select name="jobReason" defaultValue="candidate_reports">
                  <option value="candidate_reports">Candidate reports</option>
                  <option value="catalog_integrity">Catalog integrity</option>
                </select>
              </label>
            </>
          ) : (
            <fieldset>
              <legend>Exact source target</legend>
              <p>All three values must match the deployed source configuration exactly.</p>
              <label>
                Source ID <input name="sourceId" autoComplete="off" required />
              </label>
              <label>
                Adapter version <input name="adapterVersion" autoComplete="off" required />
              </label>
              <label>
                Adapter config SHA-256
                <input
                  name="adapterConfigSha256"
                  autoComplete="off"
                  required
                  pattern="[0-9a-f]{64}"
                />
              </label>
            </fieldset>
          )}
          <button disabled={busy} type="submit">
            Open case
          </button>
        </form>
      </section>
      <section>
        <header className="queue-header">
          <h2>Moderation queue</h2>
          <label>
            Case status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "open" | "resolved")}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => void loadCases()} type="button">
            Refresh
          </button>
        </header>
        <ul className="case-list">
          {cases.map((item) => (
            <li key={item.id}>
              <h3>{item.target.kind === "job" ? "Job review" : "Source review"}</h3>
              <code>
                {item.target.kind === "job"
                  ? item.target.jobId
                  : `${item.target.sourceId} / ${item.target.adapterVersion}`}
              </code>
              <p>
                {reasonLabels[item.openReasonCode]} · {item.status}
              </p>
              {item.target.kind === "job" ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void loadSummary(item.target.kind === "job" ? item.target.jobId : "")
                  }
                  type="button"
                >
                  View aggregate reports
                </button>
              ) : null}
              {item.status === "open" ? (
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      setPendingDecision({
                        caseId: item.id,
                        targetLabel:
                          item.target.kind === "job"
                            ? item.target.jobId
                            : `${item.target.sourceId} / ${item.target.adapterVersion}`,
                        request: {
                          expectedVersion: item.version,
                          resolution: "no_action",
                          reasonCode: "insufficient_evidence",
                        },
                      })
                    }
                    type="button"
                  >
                    No action
                  </button>
                  {item.target.kind === "job" ? (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        setPendingDecision({
                          caseId: item.id,
                          targetLabel: item.target.kind === "job" ? item.target.jobId : "",
                          request: {
                            expectedVersion: item.version,
                            resolution: "block_job",
                            reasonCode: "report_confirmed",
                          },
                        })
                      }
                      type="button"
                    >
                      Block job
                    </button>
                  ) : (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        setPendingDecision({
                          caseId: item.id,
                          targetLabel:
                            item.target.kind === "source"
                              ? `${item.target.sourceId} / ${item.target.adapterVersion}`
                              : "",
                          request: {
                            expectedVersion: item.version,
                            resolution: "pause_source",
                            reasonCode: "source_integrity_failure",
                          },
                        })
                      }
                      type="button"
                    >
                      Pause exact source
                    </button>
                  )}
                </div>
              ) : (
                <p>Resolution: {item.resolution}</p>
              )}
            </li>
          ))}
        </ul>
        {nextCursor ? (
          <button disabled={busy} onClick={() => void loadCases(status, nextCursor)} type="button">
            Load more cases
          </button>
        ) : null}
        {pendingDecision ? (
          <aside className="confirmation" aria-labelledby="decision-confirmation-heading">
            <h3 id="decision-confirmation-heading">Confirm moderation decision</h3>
            <p>
              Record <strong>{pendingDecision.request.resolution.replaceAll("_", " ")}</strong> for
              exact target <code>{pendingDecision.targetLabel}</code>?
            </p>
            <p>This writes an append-only audit event and cannot be edited in this console.</p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => void resolveCase(pendingDecision.caseId, pendingDecision.request)}
                ref={confirmButton}
                type="button"
              >
                Confirm decision
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setPendingDecision(undefined)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </aside>
        ) : null}
        {summary ? (
          <aside aria-label="Aggregate report summary">
            <h3>Aggregate reports: {summary.total}</h3>
            <dl>
              {Object.entries(summary.counts).map(([reason, count]) => (
                <div key={reason}>
                  <dt>{reason}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : null}
      </section>
    </div>
  );
}
