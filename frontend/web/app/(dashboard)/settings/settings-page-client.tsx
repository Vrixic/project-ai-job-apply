"use client";

import { useState } from "react";
import { isIsolationOperationEligible } from "../../../lib/isolation-operation";
import { CandidateRightsPanel } from "../../candidate-rights-panel";
import { EntitlementStatus } from "../../entitlement-status";

/** Set by the Profile page after a preference save; read here to arm the isolation check for that operation. */
const devConformanceOperationStorageKey = "dev-conformance-operation-id";

function readStoredOperationId(): string | undefined {
  try {
    return window.sessionStorage.getItem(devConformanceOperationStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function SettingsPageClient({
  authenticated,
  authConformanceEnabled,
  crossUserProbeArmed,
  workloadConformanceEnabled,
}: {
  authenticated: boolean;
  authConformanceEnabled: boolean;
  crossUserProbeArmed: boolean;
  workloadConformanceEnabled: boolean;
}) {
  const [renewingSession, setRenewingSession] = useState(false);
  const [checkingJobRead, setCheckingJobRead] = useState(false);
  const [armingIsolation, setArmingIsolation] = useState(false);
  const [checkingIsolation, setCheckingIsolation] = useState(false);
  const [runningWorkload, setRunningWorkload] = useState(false);
  const [workloadMetrics, setWorkloadMetrics] = useState<Record<string, unknown>>();
  const [isolationArmed, setIsolationArmed] = useState(crossUserProbeArmed);
  const [message, setMessage] = useState<string>();

  async function verifySessionRenewal() {
    setRenewingSession(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/auth-conformance/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Session renewal failed");
      }
      setMessage("Auth0 conformance check passed: the server-held session renewed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Session renewal failed");
    } finally {
      setRenewingSession(false);
    }
  }

  async function verifyJobRead() {
    setCheckingJobRead(true);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/auth-conformance/job-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Job-read authorization check failed");
      }
      setMessage("Job-read authorization passed: the server-held session has jobs:read.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Job-read authorization check timed out. Confirm the deployed gateway is healthy, then retry."
          : error instanceof Error
            ? error.message
            : "Job-read authorization check failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setCheckingJobRead(false);
    }
  }

  async function armIsolationProbe() {
    const operationId = readStoredOperationId();
    if (!operationId) {
      setMessage(
        "Save your job preferences on the Profile page first, to create a completed check.",
      );
      return;
    }
    setArmingIsolation(true);
    setMessage(undefined);
    try {
      const statusResponse = await fetch(
        `/api/platform/operations/${encodeURIComponent(operationId)}`,
        { cache: "no-store" },
      );
      if (!statusResponse.ok) {
        throw new Error("Could not check the saved-preference operation status");
      }
      const status = (await statusResponse.json()) as { state?: string };
      if (!isIsolationOperationEligible(status.state, false)) {
        setMessage(
          "Create a completed saved-preference check on the Profile page before arming the isolation check.",
        );
        return;
      }
      const response = await fetch("/api/auth-conformance/isolation/arm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Could not arm the isolation check");
      }
      setIsolationArmed(true);
      setMessage(
        "Isolation probe armed for 15 minutes. Log out, sign in with a different synthetic account, then run the check.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not arm the isolation check");
    } finally {
      setArmingIsolation(false);
    }
  }

  async function runIsolationProbe() {
    setCheckingIsolation(true);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/auth-conformance/isolation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Cross-user isolation check failed");
      }
      setIsolationArmed(false);
      setMessage(
        "Cross-user isolation passed: this account could not read the first account’s operation.",
      );
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Isolation check timed out. Confirm the deployed gateway is healthy, then retry."
          : error instanceof Error
            ? error.message
            : "Cross-user isolation check failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setCheckingIsolation(false);
    }
  }

  async function runPhase0Workload() {
    if (
      !window.confirm(
        "Run the fixed Phase 0 workload: 500 public probes and 25 preference workflows?",
      )
    ) {
      return;
    }
    setRunningWorkload(true);
    setWorkloadMetrics(undefined);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/auth-conformance/workload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "run-phase0-staging-foundation-workload-v1" }),
        signal: controller.signal,
      });
      const outcome = (await response.json()) as {
        message?: string;
        metrics?: Record<string, unknown>;
      };
      if (!response.ok || !outcome.metrics) {
        throw new Error(outcome.message ?? "Phase 0 workload failed");
      }
      setWorkloadMetrics(outcome.metrics);
      setMessage("Phase 0 workload passed. Review the aggregate metrics below.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "The Phase 0 workload timed out. Stop and inspect the deployed environment."
          : error instanceof Error
            ? error.message
            : "Phase 0 workload failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setRunningWorkload(false);
    }
  }

  return (
    <section aria-labelledby="dashboard-settings-heading">
      <h1 id="dashboard-settings-heading">Settings</h1>

      {message && <output aria-live="polite">{message}</output>}
      {workloadMetrics && (
        <section className="result" aria-live="polite">
          <strong>Aggregate Phase 0 workload metrics</strong>
          <pre>{JSON.stringify(workloadMetrics, null, 2)}</pre>
        </section>
      )}

      <EntitlementStatus authenticated={authenticated} />
      <CandidateRightsPanel authenticated={authenticated} />

      {authConformanceEnabled && (
        <aside>
          <strong>Development Auth0 conformance</strong>
          <p>
            Force a server-side renewal before and after revoking this test account&apos;s
            application authorization. No token material is returned to the browser.
          </p>
          <button type="button" onClick={verifySessionRenewal} disabled={renewingSession}>
            {renewingSession ? "Renewing…" : "Verify session renewal"}
          </button>
          <button type="button" onClick={verifyJobRead} disabled={checkingJobRead}>
            {checkingJobRead ? "Checking…" : "Verify job-read authorization"}
          </button>
          <hr />
          <strong>Deployed cross-user isolation</strong>
          <p>
            Save a job preference check on the Profile page first. Then arm an owner-visible
            operation here, log out, and sign in with a different synthetic account. The server
            keeps only an encrypted, expiring probe and returns no identity, token, or operation
            identifier.
          </p>
          {!isolationArmed ? (
            <button type="button" onClick={armIsolationProbe} disabled={armingIsolation}>
              {armingIsolation ? "Arming…" : "Arm cross-user isolation check"}
            </button>
          ) : (
            <button type="button" onClick={runIsolationProbe} disabled={checkingIsolation}>
              {checkingIsolation ? "Checking…" : "Run check as this account"}
            </button>
          )}
          {workloadConformanceEnabled && (
            <>
              <hr />
              <strong>Phase 0 workload</strong>
              <p>
                Run the fixed synthetic profile only after reviewing its runbook. The server-held
                token, saved preferences, and operation identifiers never enter the result.
              </p>
              <button type="button" onClick={runPhase0Workload} disabled={runningWorkload}>
                {runningWorkload ? "Running workload…" : "Run Phase 0 workload"}
              </button>
            </>
          )}
        </aside>
      )}

      <a className="button-link settings-logout" href="/auth/logout">
        Log out
      </a>
    </section>
  );
}
