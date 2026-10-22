import { getLazyAuth0Session } from "./auth0";
import { validateFoundationResponse } from "./foundation-response-bff";
import { forwardPlatformRequest } from "./platform-api";

/**
 * Candidate BFF for Stripe checkout and the customer portal (D6-005). Both are bodyless same-origin
 * POSTs that only ask the Gateway for a Stripe-hosted page URL for the signed-in candidate. Nothing
 * from the browser is forwarded, and a hosted URL that is not on a Stripe host is never returned.
 */

export type BillingSessionPath = "checkout-sessions" | "portal-sessions";
type BillingPath = BillingSessionPath | "subscription-syncs";

const STRIPE_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com"]);

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

function cancelBody(body: { cancel(): Promise<void> } | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // A hostile or locked body must not replace the fixed boundary response.
  }
}

export function isStripeHostedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && STRIPE_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

function refuseUnlessBodylessSameOrigin(request: Request): Response | undefined {
  const declaredLength = request.headers.get("content-length");
  const origin = request.headers.get("origin");
  const invalid =
    request.method !== "POST" ||
    new URL(request.url).search !== "" ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null ||
    (origin !== null && origin !== new URL(request.url).origin);
  cancelBody(request.body);
  return invalid ? problem(400, "invalid_request", "Invalid request") : undefined;
}

function forwardBilling(request: Request, path: BillingPath): Promise<Response> {
  return forwardPlatformRequest(
    `/v1/billing/${path}`,
    { method: "POST", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
}

/** Pulls the candidate's subscription from Stripe through the Gateway (D6-007). */
export async function forwardBillingSync(request: Request): Promise<Response> {
  const refused = refuseUnlessBodylessSameOrigin(request);
  if (refused) return refused;
  const response = await forwardBilling(request, "subscription-syncs");
  return validateFoundationResponse(response, 200, "BillingSubscriptionSync", request.signal);
}

export async function forwardBillingSession(
  request: Request,
  path: BillingSessionPath,
): Promise<Response> {
  const refused = refuseUnlessBodylessSameOrigin(request);
  if (refused) return refused;
  const response = await forwardBilling(request, path);
  const checked = await validateFoundationResponse(
    response,
    201,
    "BillingSessionLink",
    request.signal,
  );
  if (!checked.ok) return checked;
  const body: unknown = await checked
    .clone()
    .json()
    .catch(() => undefined);
  if (!isStripeHostedUrl((body as { url?: unknown } | undefined)?.url)) {
    cancelBody(checked.body);
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  return checked;
}
