const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function candidateRightsIdentifier(value: string): string | undefined {
  return UUID_V7_PATTERN.test(value) ? value : undefined;
}

export function candidateRightsIfMatch(request: Request): string | undefined {
  const value = request.headers.get("if-match");
  return value && /^"[1-9][0-9]*"$/u.test(value) ? value : undefined;
}

export function invalidCandidateRightsRequest(): Response {
  return Response.json(
    {
      type: "urn:ai-job-apply:problem:invalid_request",
      title: "Invalid request",
      status: 400,
      code: "invalid_request",
    },
    {
      status: 400,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

export function validBodylessCandidateRightsRequest(request: Request): boolean {
  return new URL(request.url).search.length === 0 && request.body === null;
}

export function validIdempotencyKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key");
  return value && value.length >= 16 && value.length <= 128 ? value : undefined;
}

export function exactNoContent(response: Response): Response {
  if (!response.ok) return response;
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Status and body shape are rejected below without exposing upstream bytes.
  }
  if (response.status !== 204 || response.body !== null) {
    return Response.json(
      {
        type: "urn:ai-job-apply:problem:platform_unavailable",
        title: "The platform API is unavailable",
        status: 503,
        code: "platform_unavailable",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      },
    );
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
