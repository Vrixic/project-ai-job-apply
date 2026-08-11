"use client";

import type {
  JobPreferenceSet,
  Operation,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { isIsolationOperationEligible } from "../lib/isolation-operation";

function splitValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const problem = (await response.json()) as { detail?: string; title?: string };
    throw new Error(problem.detail ?? problem.title ?? "The request failed");
  }
  return (await response.json()) as T;
}

export function FoundationForm({
  authConfigured,
  authConformanceEnabled,
  authenticationFailed,
  authenticated,
  crossUserProbeArmed,
  displayName,
  workloadConformanceEnabled,
}: {
  authConfigured: boolean;
  authConformanceEnabled: boolean;
  authenticationFailed: boolean;
  authenticated: boolean;
  crossUserProbeArmed: boolean;
  displayName?: string;
  workloadConformanceEnabled: boolean;
}) {
  const [targetRoles, setTargetRoles] = useState("Software Engineer");
  const [locations, setLocations] = useState("New York, NY");
  const [workMode, setWorkMode] = useState<"remote" | "hybrid" | "on_site">("remote");
  const [loadingPreferences, setLoadingPreferences] = useState(authenticated);
  const [saving, setSaving] = useState(false);
  const [renewingSession, setRenewingSession] = useState(false);
  const [checkingJobRead, setCheckingJobRead] = useState(false);
  const [armingIsolation, setArmingIsolation] = useState(false);
  const [checkingIsolation, setCheckingIsolation] = useState(false);
  const [runningWorkload, setRunningWorkload] = useState(false);
  const [workloadMetrics, setWorkloadMetrics] = useState<Record<string, unknown>>();
  const [isolationArmed, setIsolationArmed] = useState(crossUserProbeArmed);
  const [operationId, setOperationId] = useState<string>();
  const [operation, setOperation] = useState<Operation>();
  const [message, setMessage] = useState<string>();
  const lastSubmission = useRef<{ body: string; idempotencyKey: string } | undefined>(undefined);

  useEffect(() => {
    if (!authenticated) {
      setLoadingPreferences(false);
      return;
    }

    const controller = new AbortController();
    async function loadPreferences() {
      setLoadingPreferences(true);
      try {
        const response = await fetch("/api/platform/job-preferences", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          return;
        }
        if (!response.ok) {
          const problem = (await response.json()) as { detail?: string; title?: string };
          throw new Error(problem.detail ?? problem.title ?? "Could not load saved preferences");
        }
        const preferences = (await response.json()) as JobPreferenceSet;
        setTargetRoles(preferences.targetRoles.join(", "));
        setLocations(preferences.locations.join(", "));
        setWorkMode(preferences.workModes[0] ?? "remote");
        setMessage("Saved preferences loaded.");
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Could not load saved preferences");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingPreferences(false);
        }
      }
    }
    void loadPreferences();
    return () => controller.abort();
  }, [authenticated]);

  useEffect(() => {
    if (!operationId || operation?.state === "succeeded" || operation?.state === "failed") {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const next = await apiRequest<Operation>(
          `/api/platform/operations/${encodeURIComponent(operationId)}`,
        );
        setOperation(next);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not read operation status");
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [operationId, operation?.state]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    const body: PutJobPreferencesRequest = {
      targetRoles: splitValues(targetRoles),
      locations: splitValues(locations),
      workModes: [workMode],
      employmentTypes: ["full_time"],
    };
    const serializedBody = JSON.stringify(body);
    if (!lastSubmission.current || lastSubmission.current.body !== serializedBody) {
      lastSubmission.current = {
        body: serializedBody,
        idempotencyKey: `preferences-${crypto.randomUUID()}`,
      };
    }
    try {
      const response = await apiRequest<PutJobPreferencesResponse>(
        "/api/platform/job-preferences",
        {
          method: "PUT",
          headers: { "idempotency-key": lastSubmission.current.idempotencyKey },
          body: serializedBody,
        },
      );
      setOperationId(response.operationId);
      setOperation({
        id: response.operationId,
        kind: "profile_readiness",
        state: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setMessage("Preferences saved. Readiness is being calculated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save preferences");
    } finally {
      setSaving(false);
    }
  }

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
    if (!operationId || !isIsolationOperationEligible(operation?.state, false)) {
      setMessage("Create an eligible readiness operation before arming the isolation check.");
      return;
    }
    setArmingIsolation(true);
    setMessage(undefined);
    try {
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
        "Run the fixed Phase 0 workload: 500 public probes and 25 readiness workflows?",
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
    <main>
      <section className="eyebrow">Foundation vertical slice</section>
      <h1>Tell us what work fits you.</h1>
      <p className="lede">
        These preferences will eventually drive fresh job discovery and rapid, tailored
        applications. Application history stops at confirmed submission.
      </p>

      {authConfigured && authenticated && (
        <nav className="session" aria-label="Account">
          <span>Signed in{displayName ? ` as ${displayName}` : ""}</span>
          <a href="/auth/logout">Log out</a>
        </nav>
      )}

      {authConformanceEnabled && authenticated && (
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
            Arm an owner-visible operation, log out, and sign in with a different synthetic account.
            The server keeps only an encrypted, expiring probe and returns no identity, token, or
            operation identifier.
          </p>
          {!isolationArmed ? (
            <button
              type="button"
              onClick={armIsolationProbe}
              disabled={armingIsolation || !isIsolationOperationEligible(operation?.state, false)}
            >
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

      {authConfigured && !authenticated && (
        <aside>
          <strong>Sign in to save your preferences.</strong>
          <div className="auth-actions">
            <a className="button-link" href="/auth/login">
              Log in
            </a>
            <a className="secondary-link" href="/auth/login?screen_hint=signup">
              Create account
            </a>
          </div>
        </aside>
      )}

      {authenticationFailed && !authenticated && (
        <aside>
          <strong>Sign-in was not completed.</strong>
          <p>
            The account may be unavailable or blocked. Try again after confirming the account is
            active.
          </p>
        </aside>
      )}

      <form onSubmit={save}>
        <label>
          Target roles
          <span>Comma-separated, up to ten</span>
          <input
            value={targetRoles}
            onChange={(event) => setTargetRoles(event.target.value)}
            disabled={loadingPreferences}
            required
          />
        </label>
        <label>
          Locations
          <span>Leave empty if location is flexible</span>
          <input
            value={locations}
            onChange={(event) => setLocations(event.target.value)}
            disabled={loadingPreferences}
          />
        </label>
        <label>
          Work mode
          <select
            value={workMode}
            onChange={(event) => setWorkMode(event.target.value as "remote" | "hybrid" | "on_site")}
            disabled={loadingPreferences}
          >
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="on_site">On-site</option>
          </select>
        </label>
        <button type="submit" disabled={saving || loadingPreferences || !authenticated}>
          {loadingPreferences ? "Loading…" : saving ? "Saving…" : "Save preferences"}
        </button>
      </form>

      {!authConfigured && (
        <aside>
          Auth0 client credentials are not configured. The application fails closed; browser
          development tokens are not supported.
        </aside>
      )}
      {message && <output>{message}</output>}
      {workloadMetrics && (
        <section className="result" aria-live="polite">
          <strong>Aggregate Phase 0 workload metrics</strong>
          <pre>{JSON.stringify(workloadMetrics, null, 2)}</pre>
        </section>
      )}
      {operation && (
        <section className="result" aria-live="polite">
          <strong>Readiness workflow: {operation.state.replace("_", " ")}</strong>
          {operation.result && (
            <p>
              Profile readiness: {operation.result.completionPercent}%.
              {operation.result.missingFields.length > 0
                ? ` Optional details: ${operation.result.missingFields.join(", ")}.`
                : " No discovery details are missing."}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
