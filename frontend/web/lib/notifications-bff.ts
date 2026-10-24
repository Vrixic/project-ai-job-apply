import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { getLazyAuth0Session } from "./auth0";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "./bounded-request-body";
import { validateFoundationResponse } from "./foundation-response-bff";
import { forwardPlatformRequest } from "./platform-api";

/**
 * Candidate BFF for the in-app notifications inbox and preferences (D5-001, ADR-055). Every route
 * is same-origin, bounded, and forwards only validated input for the signed-in candidate. The
 * browser never names the owner. Item ids are UUIDs and commands carry no body.
 */

const MAXIMUM_BODY_BYTES = 4 * 1024;
const BODY_TIMEOUT_MILLISECONDS = 2_000;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const ITEM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const validatePreferencesRequest = compileComponentValidator(
  "UpdateNotificationPreferencesRequest",
);

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

const invalid = () => problem(400, "invalid_request", "Invalid request");

function cancelBody(body: { cancel(): Promise<void> } | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // A hostile or locked body must not replace the fixed boundary response.
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

function forward(
  path: string,
  init: RequestInit,
  options: { includeReauthenticationProof?: boolean } = {},
): Promise<Response> {
  return forwardPlatformRequest(path, init, {
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    fetch,
    ...(options.includeReauthenticationProof ? { includeReauthenticationProof: true } : {}),
  });
}

/** Only a known state, a bounded page size and an opaque cursor, each at most once. */
function listQuery(url: URL): string | undefined {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return undefined;
    seen.add(key);
    const valid =
      (key === "state" && ["open", "unread", "dismissed", "expired"].includes(value)) ||
      (key === "limit" && /^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) ||
      (key === "cursor" && /^[A-Za-z0-9_-]{1,300}$/u.test(value));
    if (!valid) return undefined;
    parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

export async function forwardNotificationList(request: Request): Promise<Response> {
  const query = listQuery(new URL(request.url));
  cancelBody(request.body);
  if (request.method !== "GET" || query === undefined || request.body !== null) return invalid();
  const response = await forward(`/v1/notifications${query ? `?${query}` : ""}`, {
    method: "GET",
    signal: request.signal,
  });
  return validateFoundationResponse(response, 200, "NotificationInboxPage", request.signal);
}

export async function forwardNotificationCommand(
  request: Request,
  notificationId: string,
  command: "acknowledgement" | "dismissal",
): Promise<Response> {
  const declaredLength = request.headers.get("content-length");
  const refused =
    request.method !== "POST" ||
    !ITEM_ID_PATTERN.test(notificationId) ||
    new URL(request.url).search !== "" ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null ||
    !sameOrigin(request);
  cancelBody(request.body);
  if (refused) return invalid();
  const response = await forward(`/v1/notifications/${notificationId}/${command}`, {
    method: "POST",
    signal: request.signal,
  });
  return validateFoundationResponse(response, 200, "NotificationItem", request.signal);
}

type BodyValidator = ((value: unknown) => boolean) & { errors?: unknown };

/** A bounded, same-origin JSON body that matches the contract, or the refusal to send back. */
async function readValidJsonBody(
  request: Request,
  validate: BodyValidator,
): Promise<{ body: string } | { refusal: Response }> {
  if (!sameOrigin(request)) {
    cancelBody(request.body);
    return { refusal: invalid() };
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(request.headers.get("content-type") ?? "")) {
    cancelBody(request.body);
    return { refusal: problem(415, "unsupported_media_type", "Unsupported media type") };
  }
  const declaredLength = request.headers.get("content-length");
  if (
    request.headers.get("transfer-encoding") !== null ||
    (declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAXIMUM_BODY_BYTES))
  ) {
    cancelBody(request.body);
    return {
      refusal:
        declaredLength !== null && Number(declaredLength) > MAXIMUM_BODY_BYTES
          ? problem(413, "payload_too_large", "Payload too large")
          : invalid(),
    };
  }
  try {
    const bytes = await readBoundedRequestBody(request, {
      maximumBytes: MAXIMUM_BODY_BYTES,
      timeoutMilliseconds: BODY_TIMEOUT_MILLISECONDS,
    });
    if (bytes.byteLength === 0) return { refusal: invalid() };
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!validate(JSON.parse(body))) return { refusal: invalid() };
    return { body };
  } catch (error) {
    return {
      refusal:
        error instanceof RequestBodyTooLargeError
          ? problem(413, "payload_too_large", "Payload too large")
          : invalid(),
    };
  }
}

export async function forwardNotificationPreferences(request: Request): Promise<Response> {
  if (new URL(request.url).search !== "") {
    cancelBody(request.body);
    return invalid();
  }
  if (request.method === "GET") {
    cancelBody(request.body);
    const response = await forward("/v1/notifications/preferences", {
      method: "GET",
      signal: request.signal,
    });
    return validateFoundationResponse(response, 200, "NotificationPreferences", request.signal);
  }
  if (request.method !== "PUT") {
    cancelBody(request.body);
    return invalid();
  }
  const read = await readValidJsonBody(request, validatePreferencesRequest);
  if ("refusal" in read) return read.refusal;
  const response = await forward("/v1/notifications/preferences", {
    method: "PUT",
    body: read.body,
    signal: request.signal,
    headers: { "content-type": "application/json" },
  });
  return validateFoundationResponse(response, 200, "NotificationPreferences", request.signal);
}

/** A bodyless request with no query: delivery reads and removals carry their input in the path. */
function bodylessRefused(request: Request, method: string): boolean {
  const declaredLength = request.headers.get("content-length");
  return (
    request.method !== method ||
    new URL(request.url).search !== "" ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null ||
    (method !== "GET" && !sameOrigin(request))
  );
}

function noContent(response: Response, expectedStatus: 202 | 204): Response {
  if (!response.ok) return response;
  if (response.status !== expectedStatus) {
    cancelBody(response.body);
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  cancelBody(response.body);
  return new Response(null, { status: expectedStatus, headers: { "cache-control": "no-store" } });
}

/** Email delivery settings (ADR-056). */
export async function forwardNotificationDeliveryStatus(request: Request): Promise<Response> {
  const refused = bodylessRefused(request, "GET");
  cancelBody(request.body);
  if (refused) return invalid();
  const response = await forward("/v1/notifications/delivery", {
    method: "GET",
    signal: request.signal,
  });
  return validateFoundationResponse(response, 200, "NotificationDeliveryStatus", request.signal);
}

/**
 * Makes the address verified at sign-in the email destination. The browser sends no address: the
 * gateway reads it from the session's ID token, which this route forwards as the identity proof.
 */
export async function forwardNotificationDeliveryEmail(request: Request): Promise<Response> {
  const refused = bodylessRefused(request, "PUT");
  cancelBody(request.body);
  if (refused) return invalid();
  return noContent(
    await forward(
      "/v1/notifications/delivery/email",
      { method: "PUT", signal: request.signal },
      { includeReauthenticationProof: true },
    ),
    204,
  );
}

/** One test item in the candidate's own inbox, so they can see email and browser alerts work. */
export async function forwardNotificationDeliveryTest(request: Request): Promise<Response> {
  const refused = bodylessRefused(request, "POST");
  cancelBody(request.body);
  if (refused) return invalid();
  const response = await forward("/v1/notifications/delivery/test", {
    method: "POST",
    signal: request.signal,
  });
  return validateFoundationResponse(response, 201, "NotificationTestSent", request.signal);
}
