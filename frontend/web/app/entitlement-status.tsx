"use client";

import type { EntitlementSummary } from "@ai-job-apply/api-contracts";
import { useEffect, useRef } from "react";
import { useEntitlementSummary } from "./use-entitlement-summary";

export function EntitlementStatus({
  authenticated,
  onSummary,
}: {
  authenticated: boolean;
  /** Reports the evaluated summary when it is ready and nothing when it is not, for callers that gate on limits. */
  onSummary?: (summary: EntitlementSummary | undefined) => void;
}) {
  const { view: visibleView, retry } = useEntitlementSummary(authenticated);

  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;
  const reportedSummary =
    visibleView.status === "ready" && authenticated ? visibleView.summary : undefined;
  useEffect(() => {
    onSummaryRef.current?.(reportedSummary);
  }, [reportedSummary]);

  if (!authenticated) {
    return (
      <section className="entitlement-status" aria-labelledby="entitlement-status-heading">
        <h2 id="entitlement-status-heading">Access status</h2>
        <p>Sign in to view your current access.</p>
      </section>
    );
  }

  return (
    <section className="entitlement-status" aria-labelledby="entitlement-status-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Provider-neutral access</span>
          <h2 id="entitlement-status-heading">Access status</h2>
        </div>
      </div>
      <div aria-live="polite">
        {visibleView.status === "loading" && <p>Loading access status…</p>}
        {visibleView.status === "unavailable" && (
          <div>
            <p>Access status is temporarily unavailable.</p>
            <button type="button" onClick={retry}>
              Retry access status
            </button>
          </div>
        )}
        {visibleView.status === "ready" && (
          <div className="entitlement-summary">
            <strong>{visibleView.summary.plan === "pro" ? "Pro" : "Free"} access</strong>
            <p>
              {visibleView.summary.accessState === "grace" && visibleView.summary.graceThrough ? (
                <>
                  Grace access is active through{" "}
                  <time dateTime={visibleView.summary.graceThrough}>
                    {visibleView.summary.graceThrough.replace("T", " ")}
                  </time>
                  .
                </>
              ) : (
                "Core access is active."
              )}
            </p>
            <small>Free and Pro currently include the same four core capabilities.</small>
          </div>
        )}
      </div>
    </section>
  );
}
