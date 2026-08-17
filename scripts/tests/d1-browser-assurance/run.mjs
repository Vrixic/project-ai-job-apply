import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { chromium } from "playwright-core";
import {
  isAllowedBrowserAssuranceRequest,
  resolveBrowserAssuranceConfiguration,
  startBrowserAssuranceServer,
} from "./server.mjs";

const PRIVATE_CANARY = "synthetic-private-browser-canary-never-render";
const SYNTHETIC_JOB_ID = "00000000-0000-7000-8000-000000000001";
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessRoot, "../../..");
const webRoot = resolve(repositoryRoot, "frontend/web");

const syntheticJob = {
  id: SYNTHETIC_JOB_ID,
  company: {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Synthetic Assurance Company",
  },
  title: "Synthetic Platform Engineer",
  locations: ["Remote - US"],
  status: "active",
  firstObservedAt: "2026-08-10T12:00:00.000Z",
  lastVerifiedAt: "2026-08-16T12:00:00.000Z",
  expiresAt: "2026-09-16T12:00:00.000Z",
};

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return nested.flat();
}

async function assertProductionBoundary() {
  assert(
    relative(webRoot, harnessRoot).startsWith(".."),
    "Harness must remain outside frontend/web",
  );
  const packageJson = JSON.parse(await readFile(resolve(webRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  assert(!dependencyNames.some((name) => /axe|playwright/i.test(name)));
  assert(
    !Object.values(packageJson.scripts).some((script) =>
      /browser-assurance|playwright/i.test(script),
    ),
  );

  const productionRoots = [resolve(webRoot, "app"), resolve(webRoot, "lib")];
  const productionFiles = (await Promise.all(productionRoots.map(filesUnder))).flat();
  productionFiles.push(resolve(webRoot, "proxy.ts"));
  for (const path of productionFiles.filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
    const source = await readFile(path, "utf8");
    assert(!/d1-browser-assurance|tests[\\/]browser|playwright[\\/]gallery/.test(source));
  }

  assert.throws(() => resolveBrowserAssuranceConfiguration({}), /NODE_ENV must equal test/);
  assert.throws(
    () =>
      resolveBrowserAssuranceConfiguration({
        NODE_ENV: "test",
        D1_BROWSER_ASSURANCE_MODE: "development",
      }),
    /refusing to start/,
  );
  const configuration = resolveBrowserAssuranceConfiguration({
    NODE_ENV: "test",
    D1_BROWSER_ASSURANCE_MODE: "generated-synthetic",
  });
  assert.equal(configuration.host, "127.0.0.1");
  assert(isAllowedBrowserAssuranceRequest("GET", "/bundle.js"));
  assert(!isAllowedBrowserAssuranceRequest("POST", "/bundle.js"));
  assert(!isAllowedBrowserAssuranceRequest("GET", "/api/platform/jobs/search"));
}

async function findSystemChrome() {
  const candidates = [
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
      // Continue through fixed local candidates. This command never downloads a browser.
    }
  }
  throw new Error(
    "A local Chrome binary is required; set D1_BROWSER_ASSURANCE_CHROME_PATH (downloads are disabled)",
  );
}

async function installSyntheticBff(page, { failFirstSearch = false, deferredSearchNumber } = {}) {
  const searchRequests = [];
  let releaseDeferredSearch;
  let resolveDeferredSearchCompleted;
  const deferredSearchGate = new Promise((resolveGate) => {
    releaseDeferredSearch = resolveGate;
  });
  const deferredSearchCompleted = new Promise((resolveCompleted) => {
    resolveDeferredSearchCompleted = resolveCompleted;
  });
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    };
    if (path === "/api/platform/saved-jobs/search") {
      await route.fulfill({ status: 200, headers, json: { items: [] } });
      return;
    }
    if (path === "/api/platform/entitlements") {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          plan: "free",
          accessState: "active",
          grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
          version: 0,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
        },
      });
      return;
    }
    if (path === "/api/platform/jobs/search") {
      searchRequests.push({ url: request.url(), body: request.postData() });
      const searchNumber = searchRequests.length;
      if (deferredSearchNumber === searchNumber) await deferredSearchGate;
      if (failFirstSearch && searchNumber === 1) {
        await route.fulfill({
          status: 503,
          headers: { ...headers, "content-type": "application/problem+json" },
          json: {
            type: "urn:ai-job-apply:problem:job_search_unavailable",
            title: "Job search unavailable",
            status: 503,
            code: "job_search_unavailable",
            detail: PRIVATE_CANARY,
          },
        });
      } else {
        await route.fulfill({ status: 200, headers, json: { items: [syntheticJob] } });
      }
      if (deferredSearchNumber === searchNumber) resolveDeferredSearchCompleted();
      return;
    }
    if (path === "/api/platform/saved-jobs" && request.method() === "POST") {
      await route.fulfill({ status: 201, headers, json: { id: "synthetic" } });
      return;
    }
    await route.fulfill({ status: 404, headers, json: { code: "not_found" } });
  });
  return {
    deferredSearchCompleted,
    releaseDeferredSearch,
    searchRequests,
  };
}

async function mountCandidateCatalog(page, origin) {
  const response = await page.goto(origin);
  assert(response, "Gallery document response is required");
  assert.equal(response.headers()["cache-control"], "no-store");
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  await page.waitForFunction(() => typeof window.mount === "function");
  await page.evaluate(() =>
    window.mount({ story: "d1-candidate-surfaces/CandidateCatalog", props: {} }),
  );
  return page.locator("#root");
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

async function runKeyboardAndWcagScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const { searchRequests } = await installSyntheticBff(page);
    const component = await mountCandidateCatalog(page, origin);
    await component.getByText("Free access").waitFor();
    await component.getByText("No jobs saved yet.").waitFor();
    const keywords = component.getByRole("searchbox", { name: /^Keywords/ });
    await keywords.focus();
    assert(await keywords.evaluate((element) => document.activeElement === element));
    const focusStyle = await keywords.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notEqual(focusStyle.outlineStyle, "none");
    assert(Number.parseFloat(focusStyle.outlineWidth) > 0);

    await keywords.fill("synthetic platform");
    await keywords.press("Enter");
    const searchRegion = component.getByRole("region", { name: "Search current jobs" });
    await searchRegion.getByRole("status").getByText("1 job loaded.", { exact: true }).waitFor();
    await component.getByRole("heading", { name: syntheticJob.title }).waitFor();
    assert(await keywords.evaluate((element) => document.activeElement === element));
    assert.equal(searchRequests.length, 1);
    assert.equal(new URL(searchRequests[0].url).search, "");
    assert.equal(JSON.parse(searchRequests[0].body).query, "synthetic platform");

    const reportSummary = component.getByText("Report a catalog issue", { exact: true });
    await reportSummary.focus();
    await reportSummary.press("Enter");
    await component.getByLabel("Issue").waitFor();
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runRedactionAndSessionScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const { deferredSearchCompleted, releaseDeferredSearch } = await installSyntheticBff(page, {
      failFirstSearch: true,
      deferredSearchNumber: 2,
    });
    const component = await mountCandidateCatalog(page, origin);
    const keywords = component.getByRole("searchbox", { name: /^Keywords/ });
    await keywords.fill(PRIVATE_CANARY);
    await keywords.press("Enter");
    const searchRegion = component.getByRole("region", { name: "Search current jobs" });
    await searchRegion
      .getByText("Job search is temporarily unavailable.", { exact: true })
      .waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert(await keywords.evaluate((element) => document.activeElement === element));

    await keywords.fill("private pending query");
    await keywords.press("Enter");
    await component.getByRole("button", { name: "Searching…" }).waitFor();
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: false },
      }),
    );
    await component.getByText("Sign in to search the candidate job catalog.").waitFor();
    await component.getByText("Sign in to keep a private list of jobs.").waitFor();
    await component.getByText("Sign in to view your current access.").waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert(!(await component.textContent()).includes("private pending query"));
    assert.equal(await component.locator("form").count(), 0);
    releaseDeferredSearch();
    await deferredSearchCompleted;
    assert(!(await component.textContent()).includes(syntheticJob.title));
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

await assertProductionBoundary();
const chromePath = await findSystemChrome();
const server = await startBrowserAssuranceServer({
  NODE_ENV: "test",
  D1_BROWSER_ASSURANCE_MODE: "generated-synthetic",
});
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  await runKeyboardAndWcagScenario(browser, server.origin);
  process.stdout.write("PASS keyboard/focus/live-status/body-only/WCAG scenario\n");
  await runRedactionAndSessionScenario(browser, server.origin);
  process.stdout.write("PASS redaction/session-fencing/WCAG scenario\n");
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
