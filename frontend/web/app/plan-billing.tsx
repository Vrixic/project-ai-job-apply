"use client";

import type { EntitlementSummary } from "@ai-job-apply/api-contracts";
import { useEffect, useState } from "react";
import { useEntitlementSummary } from "./use-entitlement-summary";

type Action = "checkout" | "portal";

const STRIPE_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com"]);

function stripeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && STRIPE_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const messages: Record<string, string> = {
  billing_already_subscribed: "You already have a Pro subscription. Use Manage subscription.",
  billing_no_account: "There is no subscription to manage yet.",
  not_found: "Paid plans are not available yet.",
  billing_unavailable: "Billing is temporarily unavailable. Try again shortly.",
  platform_unavailable: "Billing is temporarily unavailable. Try again shortly.",
};

function describeLimit(summary: EntitlementSummary): string | undefined {
  const count = summary.limits?.maxStoredResumes;
  if (count === undefined) return undefined;
  return `Stored resumes: up to ${count} on ${summary.plan === "pro" ? "Pro" : "Free"}.`;
}

export function PlanBilling({
  authenticated,
  navigate = (url: string) => window.location.assign(url),
}: {
  authenticated: boolean;
  /** Replaceable so tests need not leave the page. */
  navigate?: (url: string) => void;
}) {
  const { view } = useEntitlementSummary(authenticated);
  const [pending, setPending] = useState<Action>();
  const [message, setMessage] = useState<string>();

  // Stripe returns here after checkout; the plan changes when the verified webhook arrives.
  useEffect(() => {
    const returned = new URLSearchParams(window.location.search).get("plan");
    if (returned === "success") {
      setMessage(
        "Thanks. Your plan updates as soon as the payment is confirmed; refresh in a moment.",
      );
    } else if (returned === "cancelled") {
      setMessage("Checkout was cancelled. You have not been charged.");
    }
  }, []);

  if (!authenticated) return null;
  const summary = view.status === "ready" ? view.summary : undefined;

  async function go(action: Action) {
    setPending(action);
    setMessage(undefined);
    try {
      const response = await fetch(
        action === "checkout"
          ? "/api/platform/billing/checkout-sessions"
          : "/api/platform/billing/portal-sessions",
        { method: "POST", cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as { url?: unknown; code?: unknown };
      const target = response.ok ? stripeUrl(body.url) : undefined;
      if (target) {
        navigate(target);
        return;
      }
      setMessage(
        messages[typeof body.code === "string" ? body.code : ""] ??
          "Billing is temporarily unavailable. Try again shortly.",
      );
    } catch {
      setMessage("Billing is temporarily unavailable. Try again shortly.");
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section className="plan-billing" aria-labelledby="plan-billing-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Plan</span>
          <h2 id="plan-billing-heading">Pro subscription</h2>
        </div>
      </div>
      <p>
        Pro is the one paid plan. It has the same features as Free with a higher stored-resume
        limit. There are no other tiers.
      </p>
      {summary && (
        <>
          <p>
            <strong>{summary.plan === "pro" ? "Pro" : "Free"}</strong>
            {summary.plan === "pro" && summary.accessThrough && (
              <>
                {" "}
                through{" "}
                <time dateTime={summary.accessThrough}>{summary.accessThrough.slice(0, 10)}</time>
              </>
            )}
          </p>
          {describeLimit(summary) && <p>{describeLimit(summary)}</p>}
          <div className="button-row">
            {summary.plan === "free" ? (
              <button
                type="button"
                disabled={pending !== undefined}
                onClick={() => void go("checkout")}
              >
                {pending === "checkout" ? "Opening checkout…" : "Upgrade to Pro"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending !== undefined}
                onClick={() => void go("portal")}
              >
                {pending === "portal" ? "Opening portal…" : "Manage subscription"}
              </button>
            )}
          </div>
        </>
      )}
      {view.status === "unavailable" && <p>Plan status is temporarily unavailable.</p>}
      <div aria-live="polite">{message && <p role="status">{message}</p>}</div>
    </section>
  );
}
