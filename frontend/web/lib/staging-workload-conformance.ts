import { randomUUID } from "node:crypto";
import type {
  JobPreferenceSet,
  Operation,
  PutJobPreferencesRequest,
} from "@ai-job-apply/api-contracts";

const confirmation = "run-phase0-staging-foundation-workload-v1";
const livenessRequests = 200;
const readinessRequests = 200;
const unauthorizedRequests = 100;
const workflowAttempts = 25;
const publicConcurrency = 5;
const requestTimeoutMilliseconds = 15_000;
const workflowTimeoutMilliseconds = 60_000;
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WorkloadSession {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<unknown | null>;
}

interface WorkloadDependencies {
  appBaseUrl: string;
  auth0: WorkloadSession;
  baseUrl: string;
  enabled: boolean;
  fetch: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
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
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
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
    // Only status and aggregate latency are retained by this workload.
  }
}

async function runPublicBatch(
  baseUrl: URL,
  path: string,
  expectedStatus: number,
  count: number,
  dependencies: WorkloadDependencies,
): Promise<BatchResult> {
  const durations: number[] = [];
  let failures = 0;
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: publicConcurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= count) {
          return;
        }
        const started = dependencies.now?.() ?? performance.now();
        try {
          const result = await dependencies.fetch(new URL(path, baseUrl), {
            cache: "no-store",
            signal: AbortSignal.timeout(requestTimeoutMilliseconds),
          });
          durations.push((dependencies.now?.() ?? performance.now()) - started);
          if (result.status !== expectedStatus) {
            failures += 1;
          }
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

function preferenceInput(value: unknown): PutJobPreferencesRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const preferences = value as Partial<JobPreferenceSet>;
  if (
    !Array.isArray(preferences.targetRoles) ||
    !Array.isArray(preferences.locations) ||
    !Array.isArray(preferences.workModes) ||
    !Array.isArray(preferences.employmentTypes)
  ) {
    return null;
  }
  return {
    targetRoles: preferences.targetRoles,
    locations: preferences.locations,
    workModes: preferences.workModes,
    employmentTypes: preferences.employmentTypes,
    ...(typeof preferences.salaryMinimum === "number"
      ? { salaryMinimum: preferences.salaryMinimum }
      : {}),
    ...(typeof preferences.salaryCurrency === "string"
      ? { salaryCurrency: preferences.salaryCurrency }
      : {}),
    ...(typeof preferences.requiresSponsorship === "boolean"
      ? { requiresSponsorship: preferences.requiresSponsorship }
      : {}),
  };
}

async function authenticatedFetch(
  url: URL,
  token: string,
  dependencies: WorkloadDependencies,
  init: RequestInit = {},
): Promise<Response> {
  return dependencies.fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
}

async function waitForOperation(
  baseUrl: URL,
  operationId: string,
  token: string,
  dependencies: WorkloadDependencies,
): Promise<boolean> {
  const started = Date.now();
  const sleep =
    dependencies.sleep ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  while (Date.now() - started < workflowTimeoutMilliseconds) {
    const result = await authenticatedFetch(
      new URL(`/v1/operations/${encodeURIComponent(operationId)}`, baseUrl),
      token,
      dependencies,
    );
    if (result.status !== 200) {
      discardBody(result);
      return false;
    }
    const operation = (await result.json()) as Partial<Operation>;
    if (operation.state === "succeeded") {
      return true;
    }
    if (operation.state === "failed" || operation.state === "retryable_failure") {
      return false;
    }
    await sleep(250);
  }
  return false;
}

export function isStagingWorkloadConformanceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment.ENABLE_STAGING_WORKLOAD_CONFORMANCE === "1"
  );
}

export async function runStagingFoundationWorkload(
  request: Request,
  dependencies: WorkloadDependencies,
): Promise<Response> {
  if (!dependencies.enabled) {
    return response(404, "unavailable", "Not found");
  }
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
    return response(409, "already_running", "A staging workload is already running");
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
  if (!session) {
    return response(401, "reauthentication_required", "Sign in again to continue");
  }
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
    const currentResult = await authenticatedFetch(
      new URL("/v1/me/job-preferences", baseUrl),
      token,
      dependencies,
    );
    if (currentResult.status !== 200) {
      discardBody(currentResult);
      return response(
        409,
        "preferences_required",
        "Save synthetic preferences before running the workload",
      );
    }
    const input = preferenceInput(await currentResult.json());
    if (!input) {
      return response(503, "invalid_baseline", "The saved preference baseline is invalid");
    }
    const serializedInput = JSON.stringify(input);

    const liveness = await runPublicBatch(
      baseUrl,
      "/health/live",
      200,
      livenessRequests,
      dependencies,
    );
    const readiness = await runPublicBatch(
      baseUrl,
      "/health/ready",
      200,
      readinessRequests,
      dependencies,
    );
    const unauthorized = await runPublicBatch(
      baseUrl,
      "/v1/me",
      401,
      unauthorizedRequests,
      dependencies,
    );
    const publicFailures = liveness.failures + readiness.failures + unauthorized.failures;
    if (publicFailures !== 0) {
      return response(503, "public_workload_failed", "The public workload did not pass", {
        publicRequests: livenessRequests + readinessRequests + unauthorizedRequests,
        publicFailures,
      });
    }

    const writeLatencies: number[] = [];
    const propagationLatencies: number[] = [];
    let replayMatched = false;
    for (let index = 0; index < workflowAttempts; index += 1) {
      const idempotencyKey = `phase0-workload-${randomUUID()}`;
      const writeStarted = performance.now();
      const write = await authenticatedFetch(
        new URL("/v1/me/job-preferences", baseUrl),
        token,
        dependencies,
        {
          method: "PUT",
          body: serializedInput,
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        },
      );
      writeLatencies.push(performance.now() - writeStarted);
      if (write.status !== 200) {
        discardBody(write);
        return response(503, "workflow_write_failed", "A workflow write did not pass");
      }
      const writeBody = (await write.json()) as { operationId?: unknown };
      if (
        typeof writeBody.operationId !== "string" ||
        !operationIdPattern.test(writeBody.operationId)
      ) {
        return response(503, "workflow_response_invalid", "A workflow response was invalid");
      }

      if (index === 0) {
        const replay = await authenticatedFetch(
          new URL("/v1/me/job-preferences", baseUrl),
          token,
          dependencies,
          {
            method: "PUT",
            body: serializedInput,
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          },
        );
        if (replay.status !== 200) {
          discardBody(replay);
          return response(503, "idempotency_replay_failed", "The idempotency replay did not pass");
        }
        const replayBody = (await replay.json()) as { operationId?: unknown };
        replayMatched = replayBody.operationId === writeBody.operationId;
        if (!replayMatched) {
          return response(503, "idempotency_mismatch", "The idempotency replay did not match");
        }
      }

      const propagationStarted = performance.now();
      const succeeded = await waitForOperation(baseUrl, writeBody.operationId, token, dependencies);
      propagationLatencies.push(performance.now() - propagationStarted);
      if (!succeeded) {
        return response(503, "workflow_incomplete", "A workflow did not complete successfully");
      }
    }

    return response(200, "passed", "The Phase 0 staging workload passed", {
      profile: "phase0_staging_foundation_v1",
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - overallStarted),
      publicRequests: livenessRequests + readinessRequests + unauthorizedRequests,
      publicFailures: 0,
      liveness: latencySummary(liveness.durations),
      readiness: latencySummary(readiness.durations),
      unauthorized: latencySummary(unauthorized.durations),
      workflowAttempts,
      workflowSucceeded: workflowAttempts,
      idempotentReplayMatched: replayMatched,
      writes: latencySummary(writeLatencies),
      workflowPropagation: latencySummary(propagationLatencies),
    });
  } catch {
    return response(503, "workload_inconclusive", "The staging workload could not be completed");
  } finally {
    workloadInProgress = false;
  }
}
