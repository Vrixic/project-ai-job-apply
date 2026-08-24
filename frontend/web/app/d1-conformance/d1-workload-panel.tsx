"use client";

import { useState } from "react";

export function D1WorkloadPanel({ authenticated }: { authenticated: boolean }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string>();
  const [metrics, setMetrics] = useState<Record<string, unknown>>();

  async function run(): Promise<void> {
    if (
      !window.confirm(
        "Run the fixed D1 read workload: 150 public and 100 authenticated synthetic requests?",
      )
    ) {
      return;
    }
    setRunning(true);
    setMessage(undefined);
    setMetrics(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/d1-conformance/workload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "run-d1-development-read-workload-v1" }),
        signal: controller.signal,
      });
      const result = (await response.json()) as {
        message?: string;
        metrics?: Record<string, unknown>;
      };
      if (!response.ok || !result.metrics) {
        throw new Error(result.message ?? "The D1 workload failed");
      }
      setMetrics(result.metrics);
      setMessage("The D1 workload passed. Retain only the aggregate metrics shown below.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "The D1 workload timed out. Stop and inspect the deployed environment."
          : error instanceof Error
            ? error.message
            : "The D1 workload failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setRunning(false);
    }
  }

  return (
    <main>
      <section className="eyebrow">Phase 1 deployed assurance</section>
      <h1>Bounded synthetic read workload</h1>
      <p className="lede">
        This local-only control uses the server-held managed-OIDC session against the deployed API
        Gateway. It validates preferences, entitlements, job search, and saved-job reads before
        sending a fixed aggregate-only request profile.
      </p>
      {!authenticated ? (
        <aside>
          <strong>Sign in with the approved synthetic account first.</strong>
          <div className="auth-actions">
            <a className="button-link" href="/auth/login?returnTo=/d1-conformance">
              Log in
            </a>
          </div>
        </aside>
      ) : (
        <aside>
          <strong>Managed-OIDC session ready</strong>
          <p>
            Save synthetic job preferences on the main page before running this read-only workload.
            No token, identity, preference, job, saved-job, or response body enters the result.
          </p>
          <button type="button" onClick={run} disabled={running}>
            {running ? "Running workload…" : "Run D1 read workload"}
          </button>
          <a className="secondary-link" href="/">
            Return to preferences
          </a>
        </aside>
      )}
      {message && <p aria-live="polite">{message}</p>}
      {metrics && (
        <section aria-label="Aggregate D1 workload metrics">
          <pre>{JSON.stringify(metrics, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
