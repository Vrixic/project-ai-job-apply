import { RequestBodyTooLargeError, readBoundedRequestBody } from "./bounded-request-body";

const MAXIMUM_SAVED_JOB_BODY_BYTES = 16 * 1024;
const SAVED_JOB_BODY_TIMEOUT_MILLISECONDS = 2_000;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function readSavedJobBody(
  request: Request,
  timeoutMilliseconds = SAVED_JOB_BODY_TIMEOUT_MILLISECONDS,
): Promise<{ body: string } | { failure: Response }> {
  if (new URL(request.url).search.length > 0) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(request.headers.get("content-type") ?? "")) {
    return { failure: problem(415, "unsupported_media_type", "Unsupported media type") };
  }
  if (request.headers.get("transfer-encoding") !== null) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_SAVED_JOB_BODY_BYTES)
  ) {
    return { failure: problem(413, "payload_too_large", "Payload too large") };
  }
  try {
    const bytes = await readBoundedRequestBody(request, {
      maximumBytes: MAXIMUM_SAVED_JOB_BODY_BYTES,
      timeoutMilliseconds,
    });
    if (bytes.byteLength === 0) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(body);
    return { body };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { failure: problem(413, "payload_too_large", "Payload too large") };
    }
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
}

export function savedJobIdentifier(value: string): string | undefined {
  return UUID_PATTERN.test(value) ? value : undefined;
}

export function forwardIdempotencyKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key");
  return value && value.length >= 16 && value.length <= 128 ? value : undefined;
}
