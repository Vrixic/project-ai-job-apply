interface PlatformAuthSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface PlatformRequestDependencies {
  auth0: PlatformAuthSession;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  random?: () => number;
  retryDelaysMilliseconds?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMilliseconds?: number;
}

const defaultReadRetryDelaysMilliseconds = [250, 750, 1_500] as const;
const transientReadStatuses = new Set([429, 500, 502, 503, 504]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canRetry(method: string | undefined): boolean {
  return method === undefined || method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
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

  let baseUrl: URL;
  try {
    baseUrl = platformBaseUrl(dependencies.baseUrl);
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  const retryDelays = canRetry(init.method)
    ? (dependencies.retryDelaysMilliseconds ?? defaultReadRetryDelaysMilliseconds)
    : [];
  const random = dependencies.random ?? Math.random;
  const wait = dependencies.sleep ?? sleep;
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    dependencies.timeoutMilliseconds ?? 10_000,
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;
  let response: Response | undefined;

  try {
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        response = await dependencies.fetch(new URL(path, baseUrl), {
          ...init,
          cache: "no-store",
          signal,
          headers: {
            ...init.headers,
            authorization: `Bearer ${token}`,
          },
        });
      } catch {
        response = undefined;
      }

      const delay = retryDelays[attempt];
      if (response && (!transientReadStatuses.has(response.status) || delay === undefined)) {
        break;
      }
      if (delay === undefined || signal.aborted) {
        return problem(503, "platform_unavailable", "The platform API is unavailable");
      }
      await response?.body?.cancel();
      await wait(Math.round(delay / 2 + random() * (delay / 2)));
    }

    if (!response) {
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
  } finally {
    clearTimeout(timeout);
  }
}
