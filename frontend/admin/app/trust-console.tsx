"use client";

import type { ReviewerTrustCase } from "@ai-job-apply/api-contracts";
import { useRef, useState } from "react";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRUST_CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;

async function requestTrust(url: string, init: RequestInit): Promise<ReviewerTrustCase> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) throw new Error("The Trust request failed. Check your assigned reviewer role.");
  return (await response.json()) as ReviewerTrustCase;
}

export function TrustConsole() {
  const [trustCase, setTrustCase] = useState<ReviewerTrustCase>();
  const [message, setMessage] = useState("Enter a case or contribution identifier.");
  const [busy, setBusy] = useState(false);
  const [confirmTakedown, setConfirmTakedown] = useState(false);
  const statusRef = useRef<HTMLOutputElement>(null);

  async function run(operation: () => Promise<ReviewerTrustCase>, pending: string) {
    setBusy(true);
    setMessage(pending);
    try {
      const value = await operation();
      setTrustCase(value);
      setMessage(`Case ${value.id} is ${value.state.replaceAll("_", " ")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Trust request failed.");
      statusRef.current?.focus();
    } finally {
      setBusy(false);
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
          Only fixed decisions and approved evidence digests are sent. Contributor and reviewer
          identities are never shown in this console.
        </p>
      </div>

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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const id = caseId(form);
          const action = String(form.get("action"));
          const expectedVersion = Number(form.get("expectedVersion"));
          const evidenceDigestSha256 = evidence(form);
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
          defaultValue={trustCase?.id}
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
          defaultValue={trustCase?.version}
        />
        <label htmlFor="trust-evidence-digest">Approved evidence SHA-256</label>
        <input
          id="trust-evidence-digest"
          name="evidenceDigestSha256"
          required
          minLength={64}
          maxLength={64}
          pattern="[a-f0-9]{64}"
          autoComplete="off"
          spellCheck={false}
        />
        <label htmlFor="trust-action">Reviewer action</label>
        <select id="trust-action" name="action" onChange={() => setConfirmTakedown(false)}>
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
        <button type="submit" className="danger" disabled={busy}>
          Record version-fenced decision
        </button>
      </form>

      <output ref={statusRef} tabIndex={-1} aria-live="polite">
        {message}
      </output>
    </section>
  );
}
