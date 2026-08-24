import { compileComponentValidator } from "@ai-job-apply/api-contracts";

const confirmation = "run-d1-development-read-workload-v1";
const requestsPerPublicRoute = 50;
const authenticatedIterations = 25;
const requestTimeoutMilliseconds = 15_000;

const validateJobPreferences = compileComponentValidator("JobPreferenceSet");
const validateEntitlements = compileComponentValidator("EntitlementSummary");
const validateJobSearch = compileComponentValidator("JobSearchPage");
const validateSavedJobs = compileComponentValidator("SavedJobPage");

interface WorkloadSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface WorkloadDependencies {
  appBaseUrl: string;
  auth0: WorkloadSession;
  baseUrl: string;
  concurrency: number;
  enabled: boolean;
  fetch: typeof globalThis.fetch;
  now?: () => number;
}

interface RequestProfile {
  body?: string;
  expectedStatus: number;
  label: string;
  method: "GET" | "POST";
  path: string;
  token?: string;
}

interface BatchResult {
  durations: number[];
  failures: number;
}

let workloadInProgress = false;

function response(status: number, state: string, message: string, metrics?: object): Response {
  return Response.json(
    { state, message, ...(metrics ? { metrics } : {}) },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function expectedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function platformBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return Math.round(ordered[index] ?? 0);
}

function latencySummary(values: number[]): { maxMs: number; p50Ms: number; p95Ms: number } {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.round(Math.max(...values, 0)),
  };
}

function discardBody(result: Response): void {
  try {
    void result.body?.cancel().catch(() => undefined);
  } catch {
    // The workload retains only status and aggregate latency after baseline validation.
  }
}

async function issue(
  baseUrl: URL,
  profile: RequestProfile,
  dependencies: WorkloadDependencies,
): Promise<Response> {
  return dependencies.fetch(new URL(profile.path, baseUrl), {
    method: profile.method,
    cache: "no-store",
    headers: {
      ...(profile.body ? { "content-type": "application/json" } : {}),
      ...(profile.token ? { authorization: `Bearer ${profile.token}` } : {}),
    },
    ...(profile.body ? { body: profile.body } : {}),
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
}

async function runBatch(
  baseUrl: URL,
  profiles: readonly RequestProfile[],
  count: number,
  dependencies: WorkloadDependencies,
): Promise<BatchResult> {
  const durations: number[] = [];
  let failures = 0;
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: dependencies.concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= count) return;
        const profile = profiles[index % profiles.length];
        if (!profile) {
          failures += 1;
          continue;
        }
        const started = dependencies.now?.() ?? performance.now();
        try {
          const result = await issue(baseUrl, profile, dependencies);
          durations.push((dependencies.now?.() ?? performance.now()) - started);
          if (result.status !== profile.expectedStatus) failures += 1;
          discardBody(result);
        } catch {
          durations.push((dependencies.now?.() ?? performance.now()) - started);
          failures += 1;
        }
      }
    }),
  );
  return { durations, failures };
}

async function validateBaseline(
  baseUrl: URL,
  token: string,
  dependencies: WorkloadDependencies,
): Promise<boolean> {
  const profiles: ReadonlyArray<[RequestProfile, (value: unknown) => boolean]> = [
    [
      {
        expectedStatus: 200,
        label: "preferences",
        method: "GET",
        path: "/v1/me/job-preferences",
        token,
      },
      validateJobPreferences,
    ],
    [
      {
        expectedStatus: 200,
        label: "entitlements",
        method: "GET",
        path: "/v1/entitlements",
        token,
      },
      validateEntitlements,
    ],
    [
      {
        body: JSON.stringify({ sort: "relevance", pageSize: 10 }),
        expectedStatus: 200,
        label: "job_search",
        method: "POST",
        path: "/v1/jobs/search",
        token,
      },
      validateJobSearch,
    ],
    [
      {
        body: JSON.stringify({ pageSize: 20 }),
        expectedStatus: 200,
        label: "saved_jobs",
        method: "POST",
        path: "/v1/saved-jobs/search",
        token,
      },
      validateSavedJobs,
    ],
  ];
  for (const [profile, validate] of profiles) {
    const result = await issue(baseUrl, profile, dependencies);
    if (result.status !== profile.expectedStatus) {
      discardBody(result);
      return false;
    }
    if (!validate(await result.json())) return false;
  }
  return true;
}

export function isD1WorkloadConformanceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment.ENABLE_D1_WORKLOAD_CONFORMANCE === "1" &&
    ["development", "staging"].includes(environment.D1_WORKLOAD_ENVIRONMENT ?? "")
  );
}

export function d1WorkloadConcurrency(environment: string | undefined): number {
  if (environment === "development") return 2;
  if (environment === "staging") return 5;
  return 0;
}

export async function runD1ReadWorkload(
  request: Request,
  dependencies: WorkloadDependencies,
): Promise<Response> {
  if (!dependencies.enabled) return response(404, "unavailable", "Not found");
  const origin = expectedOrigin(dependencies.appBaseUrl);
  if (!origin || request.headers.get("origin") !== origin) {
    return response(403, "origin_rejected", "The request origin was rejected");
  }
  try {
    const body = (await request.json()) as { confirmation?: unknown };
    if (body.confirmation !== confirmation) {
      return response(400, "confirmation_required", "Explicit workload confirmation is required");
    }
  } catch {
    return response(400, "confirmation_required", "Explicit workload confirmation is required");
  }
  if (workloadInProgress) {
    return response(409, "already_running", "The D1 workload is already running");
  }
  if (!Number.isInteger(dependencies.concurrency) || dependencies.concurrency < 1) {
    return response(503, "configuration_unavailable", "The workload configuration is unavailable");
  }
  const baseUrl = platformBaseUrl(dependencies.baseUrl);
  if (!baseUrl) {
    return response(503, "configuration_unavailable", "The workload configuration is unavailable");
  }
  let session: unknown | null;
  try {
    session = await dependencies.auth0.getSession();
  } catch {
    session = null;
  }
  if (!session) return response(401, "reauthentication_required", "Sign in again to continue");
  let token: string;
  try {
    ({ token } = await dependencies.auth0.getAccessToken());
  } catch {
    return response(401, "reauthentication_required", "Sign in again to continue");
  }

  workloadInProgress = true;
  const startedAt = new Date().toISOString();
  const overallStarted = performance.now();
  try {
    if (!(await validateBaseline(baseUrl, token, dependencies))) {
      return response(
        409,
        "baseline_required",
        "Save synthetic preferences and verify the current D1 read surfaces before running the workload",
      );
    }

    const publicProfiles: RequestProfile[] = [
      { expectedStatus: 200, label: "liveness", method: "GET", path: "/health/live" },
      { expectedStatus: 200, label: "readiness", method: "GET", path: "/health/ready" },
      { expectedStatus: 401, label: "unauthorized", method: "GET", path: "/v1/entitlements" },
    ];
    const authenticatedProfiles: RequestProfile[] = [
      {
        expectedStatus: 200,
        label: "preferences",
        method: "GET",
        path: "/v1/me/job-preferences",
        token,
      },
      {
        expectedStatus: 200,
        label: "entitlements",
        method: "GET",
        path: "/v1/entitlements",
        token,
      },
      {
        body: JSON.stringify({ sort: "relevance", pageSize: 10 }),
        expectedStatus: 200,
        label: "job_search",
        method: "POST",
        path: "/v1/jobs/search",
        token,
      },
      {
        body: JSON.stringify({ pageSize: 20 }),
        expectedStatus: 200,
        label: "saved_jobs",
        method: "POST",
        path: "/v1/saved-jobs/search",
        token,
      },
    ];
    const publicRequests = requestsPerPublicRoute * publicProfiles.length;
    const authenticatedRequests = authenticatedIterations * authenticatedProfiles.length;
    const publicResult = await runBatch(baseUrl, publicProfiles, publicRequests, dependencies);
    if (publicResult.failures !== 0) {
      return response(503, "public_workload_failed", "The public workload did not pass", {
        publicRequests,
        publicFailures: publicResult.failures,
      });
    }
    const authenticatedResult = await runBatch(
      baseUrl,
      authenticatedProfiles,
      authenticatedRequests,
      dependencies,
    );
    if (authenticatedResult.failures !== 0) {
      return response(
        503,
        "authenticated_workload_failed",
        "The authenticated workload did not pass",
        {
          authenticatedRequests,
          authenticatedFailures: authenticatedResult.failures,
        },
      );
    }
    return response(200, "passed", "The D1 read workload passed", {
      profile: "d1_deployed_read_v1",
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - overallStarted),
      baselineContractsValidated: 4,
      publicRequests,
      publicFailures: 0,
      authenticatedRequests,
      authenticatedFailures: 0,
      publicLatency: latencySummary(publicResult.durations),
      authenticatedLatency: latencySummary(authenticatedResult.durations),
    });
  } catch {
    return response(503, "workload_inconclusive", "The D1 workload could not be completed");
  } finally {
    workloadInProgress = false;
  }
}
