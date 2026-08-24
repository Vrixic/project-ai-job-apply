import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { chromium } from "playwright-core";

const HOST = "127.0.0.1";
const CANONICAL_JOB_ID = "0198be31-2e40-7000-8000-000000000001";
const ALIAS_JOB_ID = "0198be31-2e40-7000-8000-000000000002";
const STRUCTURED_JOB_ID = "0198be31-2e40-7000-8000-000000000004";
const SYNTHETIC_EXPIRED_TARGET = Object.freeze({
  jobId: "0198be31-2e40-7000-8000-000000000003",
  expiresAt: "2026-08-16T12:00:00.000Z",
});
const INVALID_JOB_ID = "NOT-A-PUBLIC-JOB-ID";
const DESCRIPTION_CANARY =
  "Build generated-synthetic systems. <script>globalThis.__d1PublicJobCanary = true</script> stays plain text.";
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessRoot, "../../..");
const webRoot = resolve(repositoryRoot, "frontend/web");
const requireFromWeb = createRequire(resolve(webRoot, "package.json"));

function boundedPort(value, fallback, name) {
  const port = value === undefined ? fallback : Number(value);
  assert(Number.isInteger(port) && port >= 1024 && port <= 65_535, `${name} is invalid`);
  return port;
}

const webPort = boundedPort(
  Reflect.get(process.env, "D1_PUBLIC_JOB_ASSURANCE_WEB_PORT"),
  4185,
  "web port",
);
const apiPort = boundedPort(
  Reflect.get(process.env, "D1_PUBLIC_JOB_ASSURANCE_API_PORT"),
  4186,
  "API port",
);
assert.notEqual(webPort, apiPort, "web and API ports must differ");
const webOrigin = `http://${HOST}:${webPort}`;
const apiOrigin = `http://${HOST}:${apiPort}`;

const canonicalDetail = Object.freeze({
  requestedJobId: CANONICAL_JOB_ID,
  canonicalJobId: CANONICAL_JOB_ID,
  isAlias: false,
  job: {
    id: CANONICAL_JOB_ID,
    companyName: "Generated Synthetic Company",
    title: "Synthetic Platform Engineer",
    locations: ["Remote - generated synthetic"],
    department: "Synthetic Assurance",
    description: DESCRIPTION_CANARY,
    firstObservedAt: "2026-08-10T12:00:00.000Z",
    lastVerifiedAt: "2026-08-16T12:00:00.000Z",
    expiresAt: "2099-08-17T12:00:00.000Z",
    validThrough: "2099-08-16T12:00:00.000Z",
  },
});

const structuredDetail = Object.freeze({
  requestedJobId: STRUCTURED_JOB_ID,
  canonicalJobId: STRUCTURED_JOB_ID,
  isAlias: false,
  job: {
    ...canonicalDetail.job,
    id: STRUCTURED_JOB_ID,
    title: "Synthetic On-site Platform Engineer",
    locations: ["New York, NY"],
    workMode: "on_site",
    employmentType: "full_time",
    datePosted: "2026-08-09T12:00:00.000Z",
    applicationUrl: `https://jobs.ashbyhq.com/generated-synthetic/${STRUCTURED_JOB_ID}/application`,
    structuredLocations: [
      {
        address: {
          addressCountry: "US",
          addressRegion: "NY",
          addressLocality: "New York",
        },
      },
    ],
  },
});

const absentProblem = Object.freeze({
  type: "urn:ai-job-apply:problem:PUBLIC_JOB_NOT_FOUND",
  title: "Public job not found",
  status: 404,
  code: "PUBLIC_JOB_NOT_FOUND",
  traceId: "generated-synthetic-public-job-trace",
});

function writeJson(response, status, mediaType, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": `${mediaType}; charset=utf-8`,
  });
  response.end(body);
}

function listen(server, port, label) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(new Error(`${label} could not bind ${HOST}:${port}: ${error.message}`));
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function startSyntheticPublicApi() {
  const requests = [];
  const violations = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", apiOrigin);
    const bodyChunks = [];
    request.on("data", (chunk) => bodyChunks.push(chunk));
    request.on("end", () => {
      const bodyBytes = Buffer.concat(bodyChunks).byteLength;
      const record = {
        method: request.method,
        pathname: url.pathname,
        search: url.search,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        accept: request.headers.accept,
        bodyBytes,
      };
      requests.push(record);
      if (
        request.method !== "GET" ||
        url.search !== "" ||
        bodyBytes !== 0 ||
        request.headers.authorization !== undefined ||
        request.headers.cookie !== undefined ||
        request.headers.accept !== "application/json"
      ) {
        violations.push(record);
        writeJson(response, 400, "application/problem+json", {
          title: "Synthetic harness rejected request",
          status: 400,
        });
        return;
      }

      const match = /^\/v1\/public\/jobs\/([^/]+)$/.exec(url.pathname);
      if (!match) {
        violations.push(record);
        writeJson(response, 404, "application/problem+json", absentProblem);
        return;
      }
      if (match[1] === CANONICAL_JOB_ID) {
        writeJson(response, 200, "application/json", canonicalDetail);
        return;
      }
      if (match[1] === ALIAS_JOB_ID) {
        writeJson(response, 200, "application/json", {
          ...canonicalDetail,
          requestedJobId: ALIAS_JOB_ID,
          isAlias: true,
        });
        return;
      }
      if (match[1] === STRUCTURED_JOB_ID) {
        writeJson(response, 200, "application/json", structuredDetail);
        return;
      }
      if (match[1] === SYNTHETIC_EXPIRED_TARGET.jobId) {
        writeJson(response, 404, "application/problem+json", absentProblem);
        return;
      }
      violations.push(record);
      writeJson(response, 404, "application/problem+json", absentProblem);
    });
  });
  return { requests, server, violations };
}

async function findSystemChrome() {
  const candidates = [
    Reflect.get(process.env, "D1_PUBLIC_JOB_ASSURANCE_CHROME_PATH"),
    Reflect.get(process.env, "D1_BROWSER_ASSURANCE_CHROME_PATH"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through fixed local candidates. This runner never downloads a browser.
    }
  }
  throw new Error(
    "A local Chrome binary is required; set D1_PUBLIC_JOB_ASSURANCE_CHROME_PATH (downloads are disabled)",
  );
}

function robotsTokens(content) {
  return new Set(
    content
      .toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  );
}

async function assertNoWcagViolations(page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return results.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length }));
  });
  assert.deepEqual(violations, []);
}

async function runCanonicalBrowserScenario(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const unexpectedNetwork = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== HOST || Number(url.port) !== webPort) {
      unexpectedNetwork.push(url.origin);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(`${webOrigin}/jobs/${CANONICAL_JOB_ID}?utm_source=synthetic`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200);
    await page.getByRole("heading", { level: 1, name: "Synthetic Platform Engineer" }).waitFor();
    await page.getByText("Generated Synthetic Company", { exact: true }).waitFor();
    assert.equal(await page.locator(".public-job-description").textContent(), DESCRIPTION_CANARY);
    assert.equal(await page.evaluate(() => globalThis.__d1PublicJobCanary), undefined);
    assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0);
    assert(!(await page.content()).includes('"@type":"JobPosting"'));
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      `${webOrigin}/jobs/${CANONICAL_JOB_ID}`,
    );
    const robots = robotsTokens(
      (await page.locator('meta[name="robots"]').getAttribute("content")) ?? "",
    );
    for (const token of ["noindex", "nofollow", "noarchive", "nosnippet"]) {
      assert(robots.has(token), `canonical metadata is missing ${token}`);
    }
    await assertNoWcagViolations(page);
    assert.deepEqual(unexpectedNetwork, []);
  } finally {
    await context.close();
  }
}

async function runTruthfulStructuredDataScenario(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const unexpectedNetwork = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== HOST || Number(url.port) !== webPort) {
      unexpectedNetwork.push(url.origin);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(`${webOrigin}/jobs/${STRUCTURED_JOB_ID}`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200);
    await page
      .getByRole("heading", { level: 1, name: "Synthetic On-site Platform Engineer" })
      .waitFor();
    const applicationLink = page.getByRole("link", { name: "Apply on the employer's site" });
    assert.equal(await applicationLink.getAttribute("href"), structuredDetail.job.applicationUrl);
    assert.deepEqual(
      new Set((await applicationLink.getAttribute("rel"))?.split(" ")),
      new Set(["external", "nofollow"]),
    );
    const scripts = page.locator('script[type="application/ld+json"]');
    assert.equal(await scripts.count(), 1);
    const jobPosting = JSON.parse((await scripts.textContent()) ?? "null");
    assert.deepEqual(jobPosting, {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: structuredDetail.job.title,
      description: structuredDetail.job.description,
      datePosted: structuredDetail.job.datePosted,
      hiringOrganization: {
        "@type": "Organization",
        name: structuredDetail.job.companyName,
      },
      jobLocation: [
        {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            ...structuredDetail.job.structuredLocations[0].address,
          },
        },
      ],
      employmentType: "FULL_TIME",
      validThrough: structuredDetail.job.validThrough,
    });
    assert.equal(await page.evaluate(() => globalThis.__d1PublicJobCanary), undefined);
    await assertNoWcagViolations(page);
    assert.deepEqual(unexpectedNetwork, []);
  } finally {
    await context.close();
  }
}

async function runRoutingAndCrawlerScenario() {
  assert(Date.parse(SYNTHETIC_EXPIRED_TARGET.expiresAt) <= Date.now());
  const alias = await fetch(`${webOrigin}/jobs/${ALIAS_JOB_ID}`, { redirect: "manual" });
  assert.equal(alias.status, 307);
  assert.equal(alias.headers.get("location"), `/jobs/${CANONICAL_JOB_ID}`);

  const expired = await fetch(`${webOrigin}/jobs/${SYNTHETIC_EXPIRED_TARGET.jobId}`);
  assert.equal(expired.status, 404);
  const expiredText = await expired.text();
  assert(expiredText.includes("This page could not be found"));
  assert(!expiredText.includes("PUBLIC_JOB_NOT_FOUND"));
  assert(!expiredText.includes("generated-synthetic-public-job-trace"));
  assert.match(expiredText, /name="robots" content="noindex"/);

  const invalid = await fetch(`${webOrigin}/jobs/${INVALID_JOB_ID}`);
  assert.equal(invalid.status, 404);
  const invalidText = await invalid.text();
  assert(invalidText.includes("This page could not be found"));
  assert(!invalidText.includes("PUBLIC_JOB_NOT_FOUND"));
  assert(!invalidText.includes("generated-synthetic-public-job-trace"));
  assert.match(invalidText, /name="robots" content="noindex"/);

  const robots = await fetch(`${webOrigin}/robots.txt`);
  assert.equal(robots.status, 200);
  const robotsText = await robots.text();
  assert.match(robotsText, /User-Agent: \*/i);
  assert.match(robotsText, /Disallow: \//i);
  assert(!/Allow:\s*\/jobs\//i.test(robotsText));
}

async function runBoundedLocalBurst() {
  const requests = Array.from({ length: 24 }, (_, index) => index);
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const index = requests.shift();
      if (index === undefined) return;
      const response = await fetch(`${webOrigin}/jobs/${CANONICAL_JOB_ID}?burst=${index}`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert(body.includes("Synthetic Platform Engineer"));
      assert(body.includes(`${webOrigin}/jobs/${CANONICAL_JOB_ID}`));
      assert.match(body, /name="robots" content="noindex, nofollow, noarchive, nosnippet"/);
    }
  });
  await Promise.all(workers);
}

const originalEnvironment = {
  APP_BASE_URL: Reflect.get(process.env, "APP_BASE_URL"),
  NODE_ENV: process.env.NODE_ENV,
  NEXT_TELEMETRY_DISABLED: Reflect.get(process.env, "NEXT_TELEMETRY_DISABLED"),
  PLATFORM_API_BASE_URL: Reflect.get(process.env, "PLATFORM_API_BASE_URL"),
  PUBLIC_JOB_INDEXING_ENABLED: Reflect.get(process.env, "PUBLIC_JOB_INDEXING_ENABLED"),
};
Reflect.set(process.env, "APP_BASE_URL", webOrigin);
process.env.NODE_ENV = "production";
Reflect.set(process.env, "NEXT_TELEMETRY_DISABLED", "1");
Reflect.set(process.env, "PLATFORM_API_BASE_URL", apiOrigin);
Reflect.set(process.env, "PUBLIC_JOB_INDEXING_ENABLED", "false");

const syntheticApi = startSyntheticPublicApi();
let nextApplication;
let webServer;
let browser;
try {
  await listen(syntheticApi.server, apiPort, "synthetic public API");
  const next = requireFromWeb("next");
  nextApplication = next({ dev: false, dir: webRoot, hostname: HOST, port: webPort });
  await nextApplication.prepare();
  webServer = createServer(nextApplication.getRequestHandler());
  await listen(webServer, webPort, "production Next server");

  const chromePath = await findSystemChrome();
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  await runCanonicalBrowserScenario(browser);
  process.stdout.write("PASS canonical/noindex/plain-text/WCAG scenario\n");
  await runTruthfulStructuredDataScenario(browser);
  process.stdout.write("PASS provider-truth application-link/JobPosting/WCAG scenario\n");
  await runRoutingAndCrawlerScenario();
  process.stdout.write("PASS alias/expired-target/invalid/robots scenario\n");
  await runBoundedLocalBurst();
  process.stdout.write("PASS bounded local concurrency scenario (not load or abuse acceptance)\n");

  assert.deepEqual(syntheticApi.violations, []);
  assert(syntheticApi.requests.some(({ pathname }) => pathname.endsWith(CANONICAL_JOB_ID)));
  assert(syntheticApi.requests.some(({ pathname }) => pathname.endsWith(ALIAS_JOB_ID)));
  assert(syntheticApi.requests.some(({ pathname }) => pathname.endsWith(STRUCTURED_JOB_ID)));
  assert(
    syntheticApi.requests.some(({ pathname }) => pathname.endsWith(SYNTHETIC_EXPIRED_TARGET.jobId)),
  );
  assert(!syntheticApi.requests.some(({ pathname }) => pathname.includes(INVALID_JOB_ID)));
  process.stdout.write("PASS exact credentialless/bodyless synthetic upstream boundary\n");
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`FAIL ${error?.stack ?? error}\n`);
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await closeServer(webServer);
    } finally {
      try {
        await nextApplication?.close?.();
      } finally {
        await closeServer(syntheticApi.server);
        for (const [name, value] of Object.entries(originalEnvironment)) {
          if (value === undefined) Reflect.deleteProperty(process.env, name);
          else Reflect.set(process.env, name, value);
        }
      }
    }
  }
}
