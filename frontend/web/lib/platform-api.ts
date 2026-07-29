interface PlatformAuthSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface PlatformRequestDependencies {
  auth0: PlatformAuthSession;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

function platformBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  ) {
    throw new Error("PLATFORM_API_BASE_URL must use HTTPS except on localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PLATFORM_API_BASE_URL cannot contain credentials, a query, or a fragment");
  }
  return url;
}

export async function forwardPlatformRequest(
  path: string,
  init: RequestInit,
  dependencies: PlatformRequestDependencies,
): Promise<Response> {
  const session = await dependencies.auth0.getSession();
  if (!session) {
    return problem(401, "authentication_required", "Authentication required");
  }

  let token: string;
  try {
    ({ token } = await dependencies.auth0.getAccessToken());
  } catch {
    return problem(401, "session_expired", "The session has expired");
  }

  let response: Response;
  try {
    const baseUrl = platformBaseUrl(dependencies.baseUrl);
    response = await dependencies.fetch(new URL(path, baseUrl), {
      ...init,
      cache: "no-store",
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }

  const headers = new Headers({ "cache-control": "no-store" });
  const contentType = response.headers.get("content-type");
  const correlationId = response.headers.get("x-correlation-id");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (correlationId) {
    headers.set("x-correlation-id", correlationId);
  }
  return new Response(response.body, { status: response.status, headers });
}
