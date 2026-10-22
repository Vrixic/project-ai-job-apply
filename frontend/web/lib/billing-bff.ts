import { getLazyAuth0Session } from "./auth0";
import { validateFoundationResponse } from "./foundation-response-bff";
import { forwardPlatformRequest } from "./platform-api";

/**
 * Candidate BFF for Stripe checkout and the customer portal (D6-005). Both are bodyless same-origin
 * POSTs that only ask the Gateway for a Stripe-hosted page URL for the signed-in candidate. Nothing
 * from the browser is forwarded, and a hosted URL that is not on a Stripe host is never returned.
 */

export type BillingSessionPath = "checkout-sessions" | "portal-sessions";

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

export async function forwardBillingSession(
  request: Request,
  path: BillingSessionPath,
): Promise<Response> {
  const declaredLength = request.headers.get("content-length");
  const origin = request.headers.get("origin");
  if (
    request.method !== "POST" ||
    new URL(request.url).search !== "" ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null ||
    (origin !== null && origin !== new URL(request.url).origin)
  ) {
    cancelBody(request.body);
    return problem(400, "invalid_request", "Invalid request");
  }
  cancelBody(request.body);
  const response = await forwardPlatformRequest(
    `/v1/billing/${path}`,
    { method: "POST", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
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
