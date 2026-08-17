"use client";

import type { EntitlementSummary } from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";

const expectedGrants = [
  "profile.manage",
  "jobs.search",
  "jobs.save",
  "applications.history",
] as const;
const entitlementReadTimeoutMilliseconds = 20_000;

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isEntitlementSummary(value: unknown): value is EntitlementSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(candidate.version) ||
    (candidate.version as number) < 0 ||
    !isDateTime(candidate.evaluatedAt) ||
    !Array.isArray(candidate.grants) ||
    candidate.grants.length !== expectedGrants.length ||
    !candidate.grants.every((grant, index) => grant === expectedGrants[index])
  ) {
    return false;
  }
  const baseKeys = ["accessState", "evaluatedAt", "grants", "plan", "version"];
  if (candidate.plan === "free" && candidate.accessState === "active") {
    return Object.keys(candidate).sort().join(",") === baseKeys.sort().join(",");
  }
  if (candidate.plan !== "pro" || !isDateTime(candidate.accessThrough)) return false;
  if (candidate.accessState === "active") {
    const keys = [...baseKeys, "accessThrough"];
    if (candidate.graceThrough !== undefined) {
      if (!isDateTime(candidate.graceThrough)) return false;
      keys.push("graceThrough");
    }
    return Object.keys(candidate).sort().join(",") === keys.sort().join(",");
  }
  return (
    candidate.accessState === "grace" &&
    isDateTime(candidate.graceThrough) &&
    Object.keys(candidate).sort().join(",") ===
      [...baseKeys, "accessThrough", "graceThrough"].sort().join(",")
  );
}

export function EntitlementStatus({ authenticated }: { authenticated: boolean }) {
  const [view, setView] = useState<
    | { generation: number; status: "idle" | "loading" | "unavailable" }
    | { generation: number; status: "ready"; summary: EntitlementSummary }
  >({ generation: 0, status: authenticated ? "loading" : "idle" });
  const [requestAttempt, setRequestAttempt] = useState(0);
  const requestGeneration = useRef(0);
  const previousAuthentication = useRef(authenticated);
  const controller = useRef<AbortController | undefined>(undefined);
  const requestInFlight = useRef(false);

  if (previousAuthentication.current !== authenticated) {
    previousAuthentication.current = authenticated;
    requestGeneration.current += 1;
  }
  const visibleGeneration = requestGeneration.current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the attempt counter intentionally starts a candidate-requested retry.
  useEffect(() => {
    const generation = requestGeneration.current;
    controller.current?.abort();
    if (!authenticated) {
      requestInFlight.current = false;
      setView({ generation, status: "idle" });
      return;
    }
    requestInFlight.current = true;
    setView({ generation, status: "loading" });
    const active = new AbortController();
    controller.current = active;
    let timedOut = false;
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      active.abort();
      rejectDeadline?.(new Error("entitlement read timed out"));
    }, entitlementReadTimeoutMilliseconds);
    void (async () => {
      try {
        const read = async (): Promise<EntitlementSummary> => {
          const response = await fetch("/api/platform/entitlements", {
            method: "GET",
            cache: "no-store",
            signal: active.signal,
          });
          if (!response.ok) throw new Error("entitlement unavailable");
          const value: unknown = await response.json();
          if (!isEntitlementSummary(value)) throw new Error("entitlement response invalid");
          return value;
        };
        const value = await Promise.race([read(), deadline]);
        if (!active.signal.aborted && generation === requestGeneration.current) {
          setView({ generation, status: "ready", summary: value });
        }
      } catch {
        if (
          (!active.signal.aborted || timedOut) &&
          generation === requestGeneration.current &&
          controller.current === active
        ) {
          setView({ generation, status: "unavailable" });
        }
      } finally {
        window.clearTimeout(timeout);
        if (controller.current === active) requestInFlight.current = false;
      }
    })();
    return () => {
      requestGeneration.current += 1;
      window.clearTimeout(timeout);
      active.abort();
      if (controller.current === active) {
        controller.current = undefined;
        requestInFlight.current = false;
      }
    };
  }, [authenticated, requestAttempt]);

  if (!authenticated) {
    return (
      <section className="entitlement-status" aria-labelledby="entitlement-status-heading">
        <h2 id="entitlement-status-heading">Access status</h2>
        <p>Sign in to view your current access.</p>
      </section>
    );
  }

  const visibleView =
    view.generation === visibleGeneration
      ? view
      : { generation: visibleGeneration, status: "loading" as const };
  const retry = () => {
    if (requestInFlight.current || visibleView.status !== "unavailable") return;
    requestInFlight.current = true;
    setView({ generation: requestGeneration.current, status: "loading" });
    setRequestAttempt((attempt) => attempt + 1);
  };
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
