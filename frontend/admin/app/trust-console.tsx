"use client";

import type {
  ReviewerTrustCase,
  ReviewerTrustCasePage,
  ReviewerTrustEvidence,
} from "@ai-job-apply/api-contracts";
import { useRef, useState } from "react";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRUST_CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;

async function requestTrust<T = ReviewerTrustCase>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) throw new Error("The Trust request failed. Check your assigned reviewer role.");
  return (await response.json()) as T;
}

export function TrustConsole() {
  const [trustCase, setTrustCase] = useState<ReviewerTrustCase>();
  const [reviewEvidence, setReviewEvidence] = useState<ReviewerTrustEvidence>();
  const [cases, setCases] = useState<ReviewerTrustCase[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [queueState, setQueueState] = useState<"needs_review" | "appeal_pending">("needs_review");
  const [action, setAction] = useState("accept");
  const [message, setMessage] = useState("Load the review queue to choose a case.");
  const [busy, setBusy] = useState(false);
  const [confirmTakedown, setConfirmTakedown] = useState(false);
  const statusRef = useRef<HTMLOutputElement>(null);
  const requestSequence = useRef(0);

  async function loadCases(cursor?: string) {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setTrustCase(undefined);
    setReviewEvidence(undefined);
    setMessage("Loading review queue…");
    try {
      const query = new URLSearchParams({
        state: queueState,
        pageSize: "25",
        ...(cursor ? { cursor } : {}),
      });
      const page = await requestTrust<ReviewerTrustCasePage>(`/api/trust/cases?${query}`, {
        method: "GET",
      });
      if (sequence !== requestSequence.current) return;
      setCases(page.items);
      setNextCursor(page.nextCursor);
      setMessage(
        page.items.length
          ? `${page.items.length} review cases loaded.`
          : "No cases are awaiting this review.",
      );
    } catch {
      if (sequence !== requestSequence.current) return;
      setCases([]);
      setNextCursor(undefined);
      setMessage("The queue could not be loaded. Check your case-reader role and try again.");
      statusRef.current?.focus();
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  async function run(operation: () => Promise<ReviewerTrustCase>, pending: string) {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setTrustCase(undefined);
    setReviewEvidence(undefined);
    setConfirmTakedown(false);
    setMessage(pending);
    try {
      const value = await operation();
      if (sequence !== requestSequence.current) return;
      setTrustCase(value);
      const evidence = await requestTrust<ReviewerTrustEvidence>(
        `/api/trust/cases/${value.id}/evidence`,
        { method: "GET" },
      );
      if (sequence !== requestSequence.current) return;
      if (
        evidence.caseId !== value.id ||
        evidence.caseVersion !== value.version ||
        evidence.evidence.contributionId !== value.contributionId
      )
        throw new Error("The case changed. Reload it before reviewing evidence.");
      setReviewEvidence(evidence);
      setMessage(`Case ${value.id} is ${value.state.replaceAll("_", " ")}.`);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setMessage(error instanceof Error ? error.message : "The Trust request failed.");
      statusRef.current?.focus();
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  function caseId(form: FormData): string | undefined {
    const value = String(form.get("caseId") ?? "");
    return TRUST_CASE_ID.test(value) ? value : undefined;
  }

  function evidence(form: FormData): string | undefined {
    const value = String(form.get("evidenceDigestSha256") ?? "");
    return DIGEST.test(value) ? value : undefined;
  }

  function focusControl(form: HTMLFormElement, name: string) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement) control.focus();
  }

  return (
    <section aria-labelledby="trust-console-heading" className="console">
      <div>
        <p className="eyebrow">Phase 2 restricted surface</p>
        <h2 id="trust-console-heading">Contribution Trust review</h2>
        <p>
          Review the independently verified public job content before deciding. Decisions bind the
          loaded case version and exact evidence digest. Contributor and reviewer identities are
          never shown.
        </p>
      </div>

      <section aria-label="Trust review queue">
        <label htmlFor="trust-queue-state">Review queue</label>
        <select
          id="trust-queue-state"
          value={queueState}
          disabled={busy}
          onChange={(event) => {
            setQueueState(event.target.value as "needs_review" | "appeal_pending");
            setCases([]);
            setNextCursor(undefined);
          }}
        >
          <option value="needs_review">Awaiting initial review</option>
          <option value="appeal_pending">Awaiting independent appeal review</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void loadCases()}>
          Load review queue
        </button>
        <ul className="case-list">
          {cases.map((item) => (
            <li key={item.id}>
              <p>
                {item.state.replaceAll("_", " ")} · version {item.version}
              </p>
              <code translate="no">{item.id}</code>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => requestTrust(`/api/trust/cases/${item.id}`, { method: "GET" }),
                    "Loading case and verified evidence…",
                  )
                }
              >
                Review case and evidence
              </button>
            </li>
          ))}
        </ul>
        {nextCursor ? (
          <button type="button" disabled={busy} onClick={() => void loadCases(nextCursor)}>
            Next 25 cases
          </button>
        ) : null}
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const id = caseId(form);
          if (!id) {
            setMessage("Enter a lowercase Trust case UUID.");
            focusControl(event.currentTarget, "caseId");
            return;
          }
          void run(
            () => requestTrust(`/api/trust/cases/${id}`, { method: "GET" }),
            "Loading case…",
          );
        }}
      >
        <label htmlFor="trust-case-id">Trust case UUID</label>
        <input
          id="trust-case-id"
          name="caseId"
          required
          pattern="[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy}>
          Load Trust case
        </button>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const contributionId = String(
            new FormData(event.currentTarget).get("contributionId") ?? "",
          );
          if (!UUID_V7.test(contributionId)) {
            setMessage("Enter a lowercase UUIDv7 contribution identifier.");
            focusControl(event.currentTarget, "contributionId");
            return;
          }
          void run(
            () =>
              requestTrust("/api/trust/cases", {
                method: "POST",
                body: JSON.stringify({ contributionId }),
              }),
            "Opening Trust case…",
          );
        }}
      >
        <label htmlFor="trust-contribution-id">Eligible contribution UUIDv7</label>
        <input
          id="trust-contribution-id"
          name="contributionId"
          required
          pattern="[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy}>
          Open review case
        </button>
      </form>

      {trustCase ? (
        <section aria-label="Current Trust case">
          <h3>Current case</h3>
          <dl>
            <div>
              <dt>Case</dt>
              <dd>
                <code translate="no">{trustCase.id}</code>
              </dd>
            </div>
            <div>
              <dt>Contribution</dt>
              <dd>
                <code translate="no">{trustCase.contributionId}</code>
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{trustCase.state.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{trustCase.version}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>
                <code translate="no">{trustCase.policyVersion}</code>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {reviewEvidence ? (
        <section className="review-evidence" aria-labelledby="trust-evidence-heading">
          <h3 id="trust-evidence-heading">Independently verified job evidence</h3>
          <p>
            This is provider-fetched public content, not an unverified submitted page. No content is
            rendered as HTML.
          </p>
          <h4>{reviewEvidence.evidence.title}</h4>
          <dl>
            <div>
              <dt>Company</dt>
              <dd>{reviewEvidence.evidence.companyName}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{reviewEvidence.evidence.locations.join("; ") || "Not specified"}</dd>
            </div>
            <div>
              <dt>Work type</dt>
              <dd>{reviewEvidence.evidence.workMode?.replaceAll("_", " ") ?? "Not specified"}</dd>
            </div>
            <div>
              <dt>Employment type</dt>
              <dd>
                {reviewEvidence.evidence.employmentType?.replaceAll("_", " ") ?? "Not specified"}
              </dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{reviewEvidence.evidence.provider}</dd>
            </div>
            <div>
              <dt>Verified at</dt>
              <dd>
                <time dateTime={reviewEvidence.evidence.verifiedAt}>
                  {reviewEvidence.evidence.verifiedAt}
                </time>
              </dd>
            </div>
          </dl>
          <p>
            <a
              href={reviewEvidence.evidence.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              Open public provider posting in a new tab
            </a>
          </p>
          <h4>Full verified description</h4>
          <pre>{reviewEvidence.evidence.description}</pre>
          <details>
            <summary>Integrity reference</summary>
            <code translate="no">{reviewEvidence.evidence.evidenceDigestSha256}</code>
          </details>
        </section>
      ) : (
        <p>
          Load a case to view verified evidence. A digest alone is not readable review evidence.
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const id = caseId(form);
          const action = String(form.get("action"));
          const expectedVersion = Number(form.get("expectedVersion"));
          const evidenceDigestSha256 =
            action === "accept" || action === "reject"
              ? reviewEvidence?.evidence.evidenceDigestSha256
              : evidence(form);
          if (
            !trustCase ||
            id !== trustCase.id ||
            expectedVersion !== trustCase.version ||
            ((action === "accept" || action === "reject") &&
              (!reviewEvidence ||
                reviewEvidence.caseId !== trustCase.id ||
                reviewEvidence.caseVersion !== trustCase.version))
          ) {
            setMessage("Load the current case and its readable evidence before deciding.");
            return;
          }
          if (!id) {
            setMessage("Enter a lowercase Trust case UUID.");
            focusControl(event.currentTarget, "caseId");
            return;
          }
          if (!evidenceDigestSha256) {
            setMessage("Enter the approved 64-character evidence digest.");
            focusControl(event.currentTarget, "evidenceDigestSha256");
            return;
          }
          let path = "decision";
          let body: Record<string, unknown>;
          if (action === "accept") {
            body = {
              expectedVersion,
              outcome: "accepted",
              reasonCode: "independently_verified",
              evidenceDigestSha256,
            };
          } else if (action === "reject") {
            body = {
              expectedVersion,
              outcome: "rejected",
              reasonCode: "insufficient_evidence",
              evidenceDigestSha256,
            };
          } else if (action === "takedown") {
            if (!confirmTakedown) {
              setMessage("Confirm the takedown before submitting.");
              return;
            }
            path = "takedown";
            body = {
              expectedVersion,
              reasonCode: "rights_or_policy_violation",
              evidenceDigestSha256,
            };
          } else {
            path = "appeal-resolution";
            body = {
              expectedVersion,
              outcome: action === "reverse" ? "reversed" : "upheld",
              evidenceDigestSha256,
            };
          }
          void run(
            () =>
              requestTrust(`/api/trust/cases/${id}/${path}`, {
                method: "POST",
                body: JSON.stringify(body),
              }),
            "Recording Trust decision…",
          );
        }}
      >
        <label htmlFor="trust-action-case-id">Trust case UUID</label>
        <input
          id="trust-action-case-id"
          name="caseId"
          required
          pattern="[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
          value={trustCase?.id ?? ""}
          readOnly
          autoComplete="off"
          spellCheck={false}
        />
        <label htmlFor="trust-action-version">Expected version</label>
        <input
          id="trust-action-version"
          name="expectedVersion"
          type="number"
          min="1"
          step="1"
          required
          value={trustCase?.version ?? ""}
          readOnly
        />
        <label htmlFor="trust-evidence-digest">
          Separately approved takedown or appeal evidence SHA-256
        </label>
        <input
          id="trust-evidence-digest"
          name="evidenceDigestSha256"
          required={action !== "accept" && action !== "reject"}
          disabled={action === "accept" || action === "reject"}
          minLength={64}
          maxLength={64}
          pattern="[a-f0-9]{64}"
          autoComplete="off"
          spellCheck={false}
        />
        <label htmlFor="trust-action">Reviewer action</label>
        <select
          id="trust-action"
          name="action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setConfirmTakedown(false);
          }}
        >
          <option value="accept">Accept independently verified</option>
          <option value="reject">Reject: insufficient evidence</option>
          <option value="takedown">Take down: rights or policy violation</option>
          <option value="uphold">Uphold appeal</option>
          <option value="reverse">Reverse appeal</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={confirmTakedown}
            onChange={(event) => setConfirmTakedown(event.target.checked)}
          />
          Confirm takedown (required only for the takedown action)
        </label>
        <button
          type="submit"
          className="danger"
          disabled={
            busy || !trustCase || ((action === "accept" || action === "reject") && !reviewEvidence)
          }
        >
          Record version-fenced decision
        </button>
      </form>

      <output ref={statusRef} tabIndex={-1} aria-live="polite">
        {message}
      </output>
    </section>
  );
}
