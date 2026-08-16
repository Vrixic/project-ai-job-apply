function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function validateEntitlementReadRequest(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.search !== "" || request.body !== null) {
    return problem(400, "invalid_request", "Invalid request");
  }
  return undefined;
}
