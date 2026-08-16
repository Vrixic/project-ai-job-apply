const MAXIMUM_SAVED_JOB_BODY_BYTES = 16 * 1024;
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
): Promise<{ body: string } | { failure: Response }> {
  if (new URL(request.url).search.length > 0) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(request.headers.get("content-type") ?? "")) {
    return { failure: problem(415, "unsupported_media_type", "Unsupported media type") };
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_SAVED_JOB_BODY_BYTES)
  ) {
    return { failure: problem(413, "payload_too_large", "Payload too large") };
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAXIMUM_SAVED_JOB_BODY_BYTES) {
    return { failure: problem(413, "payload_too_large", "Payload too large") };
  }
  if (bytes.byteLength === 0) {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(body);
    return { body };
  } catch {
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
