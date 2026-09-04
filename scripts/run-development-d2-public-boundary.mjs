import { pathToFileURL } from "node:url";

import { compileComponentValidator } from "../packages/api-contracts/dist/src/index.js";

export const CONFIRMATION = "run-d2-development-public-boundary-v1";
const POLICY_PATH = "/v1/extension/contribution-capability-policy";
const CONTRIBUTION_PATH = "/v1/jobs/contributions";
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const validatePolicy = compileComponentValidator("SignedContributionCapabilityPolicy");

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return Math.round(ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0);
}

function latencySummary(values) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.round(Math.max(...values, 0)),
  };
}

export function parseDevelopmentOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("The development API origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com$/.test(url.hostname)
  ) {
    throw new TypeError("The development API origin is outside the reviewed boundary");
  }
  return url;
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 65_536) {
    throw new Error("The policy response exceeded its byte boundary");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 65_536) {
    throw new Error("The policy response exceeded its byte boundary");
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function request(url, init, fetchImpl, now) {
  const started = now();
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    throw new Error("The deployed D2 boundary request failed");
  }
  return { duration: now() - started, response };
}

async function runSteadyPolicyReads({ count, fetchImpl, now, origin, pause }) {
  const durations = [];
  for (let index = 0; index < count; index += 1) {
    const { duration, response } = await request(
      new URL(POLICY_PATH, origin),
      { headers: { accept: "application/json" }, method: "GET" },
      fetchImpl,
      now,
    );
    durations.push(duration);
    const contentType = response.headers.get("content-type") ?? "";
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (
      response.status !== 200 ||
      !contentType.toLowerCase().includes("application/json") ||
      !cacheControl.toLowerCase().includes("no-store") ||
      !validatePolicy(await readBoundedJson(response))
    ) {
      throw new Error("The deployed signed-policy boundary did not pass");
    }
    // The anonymous policy route deliberately shares the one-request-per-second public edge
    // budget. Leave room for an installed extension refresh; the separate protected-route burst
    // exercises D2 throttling without making a healthy policy read look like an outage.
    if (index + 1 < count) await pause(3_100);
  }
  return durations;
}

async function runUnauthorizedBurst({ count, concurrency, fetchImpl, now, origin }) {
  const durations = [];
  const statuses = new Map();
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= count) return;
        const { duration, response } = await request(
          new URL(CONTRIBUTION_PATH, origin),
          {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          },
          fetchImpl,
          now,
        );
        durations.push(duration);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        try {
          await response.body?.cancel();
        } catch {
          // No response body is retained by this workload.
        }
      }
    }),
  );
  const unauthorized = statuses.get(401) ?? 0;
  const throttled = statuses.get(429) ?? 0;
  if (unauthorized + throttled !== count) {
    throw new Error("The deployed unauthenticated contribution boundary did not fail closed");
  }
  return { durations, throttled, unauthorized };
}

export async function runDevelopmentD2PublicBoundary(options) {
  if (options.confirmation !== CONFIRMATION) {
    throw new TypeError("Explicit D2 workload confirmation is required");
  }
  const policyRequests = options.policyRequests ?? 20;
  const unauthorizedRequests = options.unauthorizedRequests ?? 20;
  const abuseConcurrency = options.abuseConcurrency ?? 10;
  if (
    !Number.isInteger(policyRequests) ||
    policyRequests < 1 ||
    policyRequests > 50 ||
    !Number.isInteger(unauthorizedRequests) ||
    unauthorizedRequests < 1 ||
    unauthorizedRequests > 50 ||
    !Number.isInteger(abuseConcurrency) ||
    abuseConcurrency < 1 ||
    abuseConcurrency > 20
  ) {
    throw new TypeError("The D2 workload shape is outside its fixed bounds");
  }
  const origin = parseDevelopmentOrigin(options.origin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? (() => new Date());
  const pause =
    options.pause ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = wallNow().toISOString();
  const started = now();
  const policyDurations = await runSteadyPolicyReads({
    count: policyRequests,
    fetchImpl,
    now,
    origin,
    pause,
  });
  const abuse = await runUnauthorizedBurst({
    concurrency: abuseConcurrency,
    count: unauthorizedRequests,
    fetchImpl,
    now,
    origin,
  });
  return {
    profile: "d2_deployed_public_policy_auth_boundary_v1",
    startedAt,
    endedAt: wallNow().toISOString(),
    durationMs: Math.round(now() - started),
    policyRequests,
    policyFailures: 0,
    unauthorizedContributionRequests: unauthorizedRequests,
    unauthorizedResponses: abuse.unauthorized,
    throttledResponses: abuse.throttled,
    unexpectedResponses: 0,
    serverFailures: 0,
    policyLatency: latencySummary(policyDurations),
    unauthorizedLatency: latencySummary(abuse.durations),
  };
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new TypeError("The D2 workload arguments are invalid");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const result = await runDevelopmentD2PublicBoundary({
    confirmation: args.get("confirm"),
    origin: args.get("origin"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("The D2 deployed public-boundary workload did not pass.\n");
    process.exitCode = 1;
  });
}
