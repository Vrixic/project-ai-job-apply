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
const SYNTHETIC_DOCUMENT_ID = "00000000-0000-7000-8000-000000000003";
const SYNTHETIC_PROPOSAL_ID = "00000000-0000-7000-8000-000000000004";
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessRoot, "../../..");
const webRoot = resolve(repositoryRoot, "frontend/web");

async function withTimeout(promise, label, timeoutMilliseconds = 10_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`)),
      timeoutMilliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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

const syntheticResume = {
  id: SYNTHETIC_DOCUMENT_ID,
  fileName: "synthetic-browser-resume.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4096,
  sha256: "a".repeat(64),
  status: "parsed",
  pageCount: 1,
  characterCount: 32,
  createdAt: "2026-08-16T12:00:00.000Z",
  updatedAt: "2026-08-16T12:00:02.000Z",
};

const syntheticProposal = {
  id: SYNTHETIC_PROPOSAL_ID,
  kind: "skill",
  key: "browser_review_skill",
  value: "Synthetic TypeScript",
  verification: "proposed",
  sensitivity: "confidential",
  source: { type: "resume", reference: "resume:opaque" },
  evidence: {
    supportingSpans: [
      {
        documentId: SYNTHETIC_DOCUMENT_ID,
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        blockIndex: 0,
        startOffset: 0,
        endOffset: 20,
        page: 1,
      },
    ],
  },
  version: 1,
  createdAt: "2026-08-16T12:00:02.000Z",
  updatedAt: "2026-08-16T12:00:02.000Z",
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
  await assert.rejects(
    withTimeout(new Promise(() => undefined), "browser assurance timeout probe", 5),
    /browser assurance timeout probe timed out after 5ms/,
  );
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
      if (deferredSearchNumber === searchNumber) {
        await withTimeout(deferredSearchGate, "deferred search release");
      }
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

async function installSyntheticOnboardingBff(page, { legacySponsorship = false } = {}) {
  const requests = {
    factCreates: [],
    factPatches: [],
    preferenceWrites: [],
    resumeRegistrations: [],
  };
  const jsonHeaders = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/platform/job-preferences" && method === "GET") {
      if (!legacySponsorship) {
        await route.fulfill({ status: 404, headers: jsonHeaders, json: { title: "Not found" } });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: {
          id: "00000000-0000-7000-8000-000000000005",
          version: 1,
          updatedAt: "2026-08-16T12:00:00.000Z",
          targetRoles: ["Synthetic Platform Engineer"],
          locations: [],
          workModes: ["remote"],
          employmentTypes: ["full_time"],
          requiresSponsorship: true,
        },
      });
      return;
    }
    if (path === "/api/platform/job-preferences" && method === "PUT") {
      const body = JSON.parse(request.postData() ?? "null");
      requests.preferenceWrites.push({ body, headers: request.headers() });
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: {
          preferences: {
            id: "00000000-0000-7000-8000-000000000005",
            version: 1,
            updatedAt: "2026-08-16T12:00:00.000Z",
            ...body,
          },
          operationId: "00000000-0000-7000-8000-000000000006",
        },
      });
      return;
    }
    if (path === "/api/platform/resumes" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: { documents: [syntheticResume] },
      });
      return;
    }
    if (path === "/api/platform/resumes" && method === "POST") {
      requests.resumeRegistrations.push({
        body: JSON.parse(request.postData() ?? "null"),
        headers: request.headers(),
      });
      await route.fulfill({
        status: 500,
        headers: jsonHeaders,
        json: { title: "Unexpected registration" },
      });
      return;
    }
    if (path === "/api/platform/profile-facts" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: { facts: [syntheticProposal], confirmedCount: 0, proposedCount: 1 },
      });
      return;
    }
    if (path === "/api/platform/profile-facts" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "null");
      requests.factCreates.push({ body, headers: request.headers() });
      await route.fulfill({
        status: 201,
        headers: jsonHeaders,
        json: {
          id: "00000000-0000-7000-8000-000000000007",
          ...body,
          verification: "confirmed",
          source: { type: "user", reference: "direct-entry" },
          version: 1,
          createdAt: "2026-08-16T12:00:03.000Z",
          updatedAt: "2026-08-16T12:00:03.000Z",
        },
      });
      return;
    }
    if (path === `/api/platform/profile-facts/${SYNTHETIC_PROPOSAL_ID}` && method === "PATCH") {
      const body = JSON.parse(request.postData() ?? "null");
      requests.factPatches.push({ body, headers: request.headers() });
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: {
          ...syntheticProposal,
          ...body,
          version: 2,
          updatedAt: "2026-08-16T12:00:04.000Z",
        },
      });
      return;
    }
    if (path.startsWith("/api/platform/operations/") && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
        json: {
          id: "00000000-0000-7000-8000-000000000006",
          kind: "profile_readiness",
          state: "succeeded",
          result: {
            completionPercent: 100,
            missingFields: [],
            calculatedAt: "2026-08-16T12:00:05.000Z",
          },
          createdAt: "2026-08-16T12:00:03.000Z",
          updatedAt: "2026-08-16T12:00:05.000Z",
        },
      });
      return;
    }
    if (path === "/api/platform/saved-jobs/search" && method === "GET") {
      await route.fulfill({ status: 200, headers: jsonHeaders, json: { items: [] } });
      return;
    }
    if (path === "/api/platform/entitlements" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: jsonHeaders,
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
    await route.fulfill({ status: 404, headers: jsonHeaders, json: { code: "not_found" } });
  });
  return requests;
}

async function installDeferredOnboardingBff(page) {
  const deferredPaths = [
    "/api/platform/job-preferences",
    "/api/platform/resumes",
    "/api/platform/profile-facts",
  ];
  const releases = new Map();
  const started = new Map();
  const completed = new Map();
  for (const path of deferredPaths) {
    let release;
    const gate = new Promise((resolveGate) => {
      release = resolveGate;
    });
    let finish;
    const completion = new Promise((resolveCompletion) => {
      finish = resolveCompletion;
    });
    let markStarted;
    const start = new Promise((resolveStart) => {
      markStarted = resolveStart;
    });
    releases.set(path, { gate, release });
    started.set(path, { markStarted, start });
    completed.set(path, { completion, finish });
  }
  await page.route("**/api/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (deferredPaths.includes(path)) {
      started.get(path).markStarted();
      await withTimeout(releases.get(path).gate, `${path} deferred response release`);
      const json =
        path === "/api/platform/job-preferences"
          ? {
              id: "00000000-0000-7000-8000-000000000008",
              version: 1,
              updatedAt: "2026-08-16T12:00:00.000Z",
              targetRoles: [`${PRIVATE_CANARY}-role`],
              locations: [],
              workModes: ["remote"],
              employmentTypes: ["full_time"],
            }
          : path === "/api/platform/resumes"
            ? {
                documents: [{ ...syntheticResume, fileName: `${PRIVATE_CANARY}-resume.pdf` }],
              }
            : {
                facts: [
                  {
                    ...syntheticProposal,
                    key: `${PRIVATE_CANARY}-fact`,
                    value: `${PRIVATE_CANARY}-value`,
                  },
                ],
                confirmedCount: 0,
                proposedCount: 1,
              };
      try {
        await route.fulfill({
          status: 200,
          headers: { "cache-control": "no-store", "content-type": "application/json" },
          json,
        });
      } catch {
        // An aborted account-bound request is an expected sign-out result.
      } finally {
        completed.get(path).finish();
      }
      return;
    }
    if (path === "/api/platform/saved-jobs/search") {
      await route.fulfill({ status: 200, json: { items: [] } });
      return;
    }
    if (path === "/api/platform/entitlements") {
      await route.fulfill({
        status: 200,
        json: {
          plan: "free",
          accessState: "active",
          grants: [],
          version: 0,
          evaluatedAt: "2026-08-16T12:00:00.000Z",
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { code: "not_found" } });
  });
  return {
    releaseAll() {
      for (const { release } of releases.values()) release();
    },
    started: Promise.all([...started.values()].map(({ start }) => start)),
    completed: Promise.all([...completed.values()].map(({ completion }) => completion)),
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

async function mountCandidateOnboarding(page, origin, authenticated = true) {
  const response = await page.goto(origin);
  assert(response, "Gallery document response is required");
  assert.equal(response.headers()["cache-control"], "no-store");
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  await page.waitForFunction(() => typeof window.mount === "function");
  await page.evaluate(
    ({ signedIn }) =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateOnboarding",
        props: { authenticated: signedIn },
      }),
    { signedIn: authenticated },
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
    await withTimeout(deferredSearchCompleted, "deferred search completion");
    assert(!(await component.textContent()).includes(syntheticJob.title));
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runOnboardingTruthAndWcagScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const requests = await installSyntheticOnboardingBff(page);
    const component = await mountCandidateOnboarding(page, origin);
    await component.getByText(syntheticResume.fileName, { exact: true }).waitFor();
    await component.getByText(syntheticProposal.value, { exact: true }).waitFor();

    const targetRole = component.getByLabel(/^Target role 1/);
    assert.equal(await targetRole.inputValue(), "");
    for (const name of [
      "Remote",
      "Hybrid",
      "On-site",
      "Full-time",
      "Part-time",
      "Contract",
      "Internship",
    ]) {
      assert.equal(await component.getByRole("checkbox", { name }).isChecked(), false);
    }
    await targetRole.focus();
    const focusStyle = await targetRole.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notEqual(focusStyle.outlineStyle, "none");
    assert(Number.parseFloat(focusStyle.outlineWidth) > 0);

    await targetRole.fill(" Platform Engineer, Core ");
    const addRole = component.getByRole("button", { name: "Add target role" });
    await addRole.focus();
    await addRole.press("Enter");
    await component.getByLabel(/^Target role 2/).fill("Platform Engineer, Core");
    await addRole.press("Enter");
    await component.getByLabel(/^Target role 3/).fill(" Systems Engineer ");
    await component.getByRole("button", { name: "Add location" }).click();
    await component.getByLabel(/^Location 1/).fill(" New York, NY ");
    await component.getByRole("checkbox", { name: "Remote" }).check();
    await component.getByRole("checkbox", { name: "Hybrid" }).check();
    await component.getByRole("checkbox", { name: "Full-time" }).check();
    await component.getByRole("checkbox", { name: "Contract" }).check();
    await component.getByRole("button", { name: "Save preferences" }).click();
    await component.getByText("Preferences saved. Checking optional preference details.").waitFor();
    assert.equal(requests.preferenceWrites.length, 1);
    assert.deepEqual(requests.preferenceWrites[0].body, {
      targetRoles: ["Platform Engineer, Core", "Systems Engineer"],
      locations: ["New York, NY"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time", "contract"],
    });
    assert.match(requests.preferenceWrites[0].headers["idempotency-key"], /^preferences-/);
    assert(!Object.hasOwn(requests.preferenceWrites[0].body, "requiresSponsorship"));

    await component.getByLabel("Fact category").selectOption("skill");
    await component.getByLabel(/^Fact name/).fill("browser_direct_skill");
    await component.getByLabel("Confirmed value").fill("Synthetic Rust");
    await component.getByRole("button", { name: "Add confirmed fact" }).click();
    await component.getByText("Profile fact saved as confirmed user input.").waitFor();
    assert.equal(requests.factCreates.length, 1);
    assert.deepEqual(requests.factCreates[0].body, {
      kind: "skill",
      key: "browser_direct_skill",
      value: "Synthetic Rust",
      sensitivity: "confidential",
    });
    assert(!Object.hasOwn(requests.factCreates[0].body, "source"));
    assert(!Object.hasOwn(requests.factCreates[0].body, "verification"));
    assert.match(requests.factCreates[0].headers["idempotency-key"], /^profile-fact-/);

    await component.getByRole("button", { name: `Confirm ${syntheticProposal.key}` }).click();
    await component.getByText(/browser_review_skill.*confirmed.*version 2/).waitFor();
    assert.equal(requests.factPatches.length, 1);
    assert.deepEqual(requests.factPatches[0].body, {
      expectedVersion: 1,
      verification: "confirmed",
    });
    assert.match(requests.factPatches[0].headers["idempotency-key"], /^profile-fact-/);

    const resumeInput = component.getByLabel(/^Resume file/);
    await resumeInput.setInputFiles({
      name: "adversarial-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("generated synthetic content", "utf8"),
    });
    await component.getByRole("button", { name: "Upload resume" }).click();
    await component
      .getByText("Choose a PDF or DOCX file whose extension and media type agree.")
      .waitFor();
    assert.equal(requests.resumeRegistrations.length, 0);
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runOnboardingLegacyAndSessionScenario(browser, origin) {
  const legacyContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await legacyContext.newPage();
    const requests = await installSyntheticOnboardingBff(page, { legacySponsorship: true });
    const component = await mountCandidateOnboarding(page, origin);
    await component
      .getByText(
        "These saved preferences contain a legacy sponsorship answer. It is not shown here, and saving is unavailable until it moves to the restricted-data boundary.",
      )
      .waitFor();
    assert.equal(
      await component
        .getByRole("form", { name: "Job preferences" })
        .getByRole("textbox")
        .first()
        .inputValue(),
      "Synthetic Platform Engineer",
    );
    assert.equal(await component.getByRole("checkbox", { name: /sponsor/i }).count(), 0);
    assert.equal(await component.getByRole("textbox", { name: /sponsor/i }).count(), 0);
    await component.getByRole("button", { name: "Save preferences" }).click();
    await component
      .getByText(
        "These saved preferences contain a legacy sponsorship answer. Saving is unavailable until that answer moves to the restricted-data boundary.",
      )
      .waitFor();
    assert.equal(requests.preferenceWrites.length, 0);
    await assertNoWcagViolations(page);
  } finally {
    await legacyContext.close();
  }

  const sessionContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await sessionContext.newPage();
    const deferred = await installDeferredOnboardingBff(page);
    const component = await mountCandidateOnboarding(page, origin);
    await withTimeout(deferred.started, "onboarding deferred requests start");
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateOnboarding",
        props: { authenticated: false },
      }),
    );
    await component.getByText("Sign in to search the candidate job catalog.").waitFor();
    deferred.releaseAll();
    await withTimeout(deferred.completed, "onboarding deferred requests complete");
    await page.waitForTimeout(50);
    const text = await component.textContent();
    assert(!text.includes(PRIVATE_CANARY));
    assert.equal(await component.getByRole("form", { name: "Job preferences" }).count(), 0);
    assert.equal(await component.getByRole("button", { name: "Upload resume" }).count(), 0);
    assert.equal(await component.getByRole("button", { name: "Add confirmed fact" }).count(), 0);
    await assertNoWcagViolations(page);
  } finally {
    await sessionContext.close();
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
  await runOnboardingTruthAndWcagScenario(browser, server.origin);
  process.stdout.write("PASS onboarding/preferences/direct-facts/resume/WCAG scenario\n");
  await runOnboardingLegacyAndSessionScenario(browser, server.origin);
  process.stdout.write("PASS onboarding restricted-data/session-fencing/WCAG scenario\n");
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
