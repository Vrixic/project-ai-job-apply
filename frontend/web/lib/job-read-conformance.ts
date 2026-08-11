import { forwardPlatformRequest } from "./platform-api";

const GUARANTEED_MISSING_JOB_ID = "00000000-0000-0000-8000-000000000000";
const PLATFORM_REQUEST_TIMEOUT_MILLISECONDS = 10_000;

interface JobReadAuthSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface JobReadConformanceDependencies {
  appBaseUrl: string;
  auth0: JobReadAuthSession;
  enabled: boolean;
  fetch: typeof globalThis.fetch;
  platformBaseUrl: string;
}

function result(status: number, state: string, message: string): Response {
  return Response.json(
    { state, message },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

function discardResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Only the status is authoritative; the upstream body is intentionally ignored.
  }
}

export async function verifyJobReadAuthorization(
  request: Request,
  dependencies: JobReadConformanceDependencies,
): Promise<Response> {
  if (!dependencies.enabled) {
    return result(404, "unavailable", "Not found");
  }

  const expectedOrigin = new URL(dependencies.appBaseUrl).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return result(403, "origin_rejected", "The request origin was rejected");
  }

  const upstream = await forwardPlatformRequest(
    `/v1/jobs/${GUARANTEED_MISSING_JOB_ID}`,
    {
      method: "GET",
      signal: AbortSignal.timeout(PLATFORM_REQUEST_TIMEOUT_MILLISECONDS),
    },
    {
      auth0: dependencies.auth0,
      baseUrl: dependencies.platformBaseUrl,
      fetch: dependencies.fetch,
    },
  );
  discardResponseBody(upstream);

  if (upstream.status === 404) {
    return result(
      200,
      "jobs_read_authorized",
      "The server-held session has the jobs:read permission",
    );
  }
  if (upstream.status === 403) {
    return result(
      403,
      "jobs_read_scope_missing",
      "The session is missing jobs:read; sign out and sign in again after confirming Auth0",
    );
  }
  if (upstream.status === 401) {
    return result(401, "reauthentication_required", "Sign in again to continue");
  }
  if (upstream.status === 200) {
    return result(
      409,
      "probe_record_collision",
      "The synthetic missing-job probe unexpectedly resolved; stop acceptance and investigate",
    );
  }
  return result(
    503,
    "check_inconclusive",
    "The job-read authorization check could not be completed",
  );
}
