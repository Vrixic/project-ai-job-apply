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
const SECOND_SYNTHETIC_JOB_ID = "00000000-0000-7000-8000-000000000009";
const SYNTHETIC_DOCUMENT_ID = "00000000-0000-7000-8000-000000000003";
const SYNTHETIC_PROPOSAL_ID = "00000000-0000-7000-8000-000000000004";
const REPORT_REASONS = [
  "job_closed",
  "job_not_found",
  "job_inaccurate",
  "suspected_scam",
  "duplicate_listing",
  "other_catalog_issue",
];
const MATCH_REVIEW_HEADING = "Review the available evidence";
const MATCH_REVIEW_SUMMARY =
  "No exact hard conflict was found in the currently comparable attributes.";
const MATCH_CONFLICT_HEADING = "Known preference conflict";
const MATCH_CONFLICT_SUMMARY =
  "At least one exact stated job attribute conflicts with your saved preferences.";
const MATCH_NONCLAIM =
  "This is deterministic evidence, not a score, eligibility decision, ranking, or application outcome. Unknown evidence never counts as a conflict.";
const MATCH_REVIEW_EVIDENCE = [
  { state: "satisfied", reason: "The job’s stated work mode is one you selected." },
  { state: "satisfied", reason: "The job’s stated employment type is one you selected." },
  { state: "satisfied", reason: "The normalized job title exactly overlaps a target role." },
  { state: "unknown", reason: "A location match is not established." },
  {
    state: "unknown",
    reason:
      "Compensation cannot be compared because cadence and base-versus-total meaning are unavailable.",
  },
  {
    state: "unknown",
    reason: "Authorization and sponsorship are not assessed in this general-preferences boundary.",
  },
  {
    state: "unknown",
    reason: "Seniority is not yet represented by a comparable taxonomy.",
  },
  { state: "unknown", reason: "Blocked-company preferences are not available." },
  { state: "unknown", reason: "Qualification evidence is not assessed by this baseline." },
];
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

const SYNTHETIC_SAVED_JOB_ID = "00000000-0000-7000-8000-000000000020";
const syntheticSavedJob = {
  id: SYNTHETIC_SAVED_JOB_ID,
  requestedJobId: SYNTHETIC_JOB_ID,
  snapshot: {
    jobIdAtSave: SYNTHETIC_JOB_ID,
    company: syntheticJob.company,
    title: syntheticJob.title,
    locations: syntheticJob.locations,
    firstObservedAt: syntheticJob.firstObservedAt,
    lastVerifiedAt: syntheticJob.lastVerifiedAt,
    expiresAt: syntheticJob.expiresAt,
  },
  availability: { state: "available", currentJob: syntheticJob },
  savedAt: "2026-08-16T12:01:00.000Z",
};

const syntheticUnavailableSavedJob = {
  ...syntheticSavedJob,
  availability: { state: "unavailable" },
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

function createGate() {
  let release;
  let markStarted;
  let markCompleted;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const started = new Promise((resolveStarted) => {
    markStarted = resolveStarted;
  });
  const completed = new Promise((resolveCompleted) => {
    markCompleted = resolveCompleted;
  });
  return { completed, gate, markCompleted, markStarted, release, started };
}

function syntheticMatchAssessment(jobId, { conflict = false } = {}) {
  return {
    schemaVersion: 1,
    requestedJobId: jobId,
    canonicalJobId: jobId,
    preferenceSetId: "00000000-0000-7000-8000-000000000010",
    preferenceVersion: 2,
    preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
    catalogRevision: "9",
    assessedAt: "2026-08-16T12:00:00.000Z",
    gate: conflict ? "excluded" : "review_required",
    evidence: [
      {
        constraint: "work_mode",
        state: conflict ? "conflict" : "satisfied",
        reasonCode: conflict ? "work_mode_conflict" : "work_mode_selected",
      },
      {
        constraint: "employment_type",
        state: "satisfied",
        reasonCode: "employment_type_selected",
      },
      {
        constraint: "target_role",
        state: "satisfied",
        reasonCode: "target_role_exact_overlap",
      },
      { constraint: "location", state: "unknown", reasonCode: "location_not_established" },
      {
        constraint: "compensation",
        state: "unknown",
        reasonCode: "compensation_semantics_unavailable",
      },
      {
        constraint: "authorization_sponsorship",
        state: "unknown",
        reasonCode: "authorization_sponsorship_unavailable",
      },
      {
        constraint: "seniority",
        state: "unknown",
        reasonCode: "seniority_semantics_unavailable",
      },
      {
        constraint: "blocked_company",
        state: "unknown",
        reasonCode: "blocked_company_preferences_unavailable",
      },
      {
        constraint: "qualifications",
        state: "unknown",
        reasonCode: "qualification_evidence_unavailable",
      },
    ],
  };
}

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

async function installSyntheticEntitlementBff(page) {
  const entitlementRequests = [];
  const retryGate = createGate();
  const jsonHeaders = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/platform/entitlements" && request.method() === "GET") {
      entitlementRequests.push({
        body: request.postData(),
        method: request.method(),
        url: request.url(),
      });
      const requestNumber = entitlementRequests.length;
      if (requestNumber === 1) {
        await route.fulfill({
          status: 503,
          headers: { ...jsonHeaders, "content-type": "application/problem+json" },
          json: {
            type: "urn:ai-job-apply:problem:entitlement_unavailable",
            title: "Private entitlement failure",
            status: 503,
            code: "private_entitlement_failure",
            detail: PRIVATE_CANARY,
          },
        });
        return;
      }
      if (requestNumber === 2) {
        retryGate.markStarted();
        await withTimeout(retryGate.gate, "deferred entitlement retry release");
        try {
          await route.fulfill({
            status: 200,
            headers: jsonHeaders,
            json: {
              plan: "free",
              accessState: "active",
              grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
              version: 1,
              evaluatedAt: "2026-08-16T12:01:00.000Z",
            },
          });
        } catch {
          // An aborted retry is the expected result after the candidate signs out.
        } finally {
          retryGate.markCompleted();
        }
        return;
      }
      await route.fulfill({
        status: 503,
        headers: { ...jsonHeaders, "content-type": "application/problem+json" },
        json: { status: 503, detail: PRIVATE_CANARY },
      });
      return;
    }
    if (url.pathname === "/api/platform/saved-jobs/search") {
      await route.fulfill({ status: 200, headers: jsonHeaders, json: { items: [] } });
      return;
    }
    await route.fulfill({ status: 404, headers: jsonHeaders, json: { code: "not_found" } });
  });
  return { entitlementRequests, retryGate };
}

async function installSyntheticSavedJobsBff(
  page,
  { deleteResponses = [], savedSearchResponses = [] } = {},
) {
  const requests = { deletes: [], saves: [], searches: [] };
  const jsonHeaders = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/platform/entitlements") {
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
    if (path === "/api/platform/jobs/search" && method === "POST") {
      await route.fulfill({ status: 200, headers: jsonHeaders, json: { items: [syntheticJob] } });
      return;
    }
    if (path === "/api/platform/saved-jobs" && method === "POST") {
      requests.saves.push({ body: request.postData(), headers: request.headers() });
      await route.fulfill({ status: 201, headers: jsonHeaders, json: syntheticSavedJob });
      return;
    }
    if (path === "/api/platform/saved-jobs/search" && method === "POST") {
      requests.searches.push({ body: request.postData(), headers: request.headers() });
      const response = savedSearchResponses[requests.searches.length - 1];
      assert(response, `Unexpected synthetic saved-jobs search ${requests.searches.length}`);
      response.gate?.markStarted();
      if (response.gate) {
        await withTimeout(response.gate.gate, "deferred saved-jobs search release");
      }
      try {
        await route.fulfill({
          status: response.status ?? 200,
          headers: {
            ...jsonHeaders,
            "content-type":
              response.status && response.status >= 400
                ? "application/problem+json; charset=utf-8"
                : jsonHeaders["content-type"],
          },
          json: response.body,
        });
      } catch (error) {
        if (!response.allowAborted) throw error;
      } finally {
        response.gate?.markCompleted();
      }
      return;
    }
    if (/^\/api\/platform\/saved-jobs\/[^/]+$/.test(path) && method === "DELETE") {
      requests.deletes.push({ body: request.postData(), headers: request.headers(), path });
      const response = deleteResponses[requests.deletes.length - 1];
      assert(response, `Unexpected synthetic saved-job delete ${requests.deletes.length}`);
      await route.fulfill({
        status: response.status ?? 204,
        headers:
          response.status && response.status >= 400
            ? { ...jsonHeaders, "content-type": "application/problem+json; charset=utf-8" }
            : { "cache-control": "no-store" },
        ...(response.body ? { json: response.body } : {}),
      });
      return;
    }
    await route.fulfill({ status: 404, headers: jsonHeaders, json: { code: "not_found" } });
  });
  return requests;
}

async function installSyntheticReportBff(page, responses) {
  const requests = [];
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^\/api\/platform\/jobs\/[^/]+\/reports$/.test(url.pathname)) {
      await route.fulfill({ status: 404, headers, json: { code: "not_found" } });
      return;
    }
    requests.push({
      body: request.postData(),
      headers: request.headers(),
      method: request.method(),
      url: request.url(),
    });
    const response = responses[requests.length - 1];
    assert(response, `Unexpected synthetic report request ${requests.length}`);
    if (response.kind === "abort") {
      await route.abort("connectionfailed");
      return;
    }
    if (response.gate) {
      response.gate.markStarted();
      await withTimeout(response.gate.gate, "deferred report response release");
    }
    try {
      await route.fulfill({
        status: response.status ?? 201,
        headers: {
          ...headers,
          "content-type":
            response.status && response.status >= 400
              ? "application/problem+json; charset=utf-8"
              : headers["content-type"],
        },
        json: response.body ?? { accepted: true },
      });
    } catch (error) {
      if (!response.allowAborted) throw error;
    } finally {
      response.gate?.markCompleted();
    }
  });
  return requests;
}

async function installSyntheticMatchBff(page, responses) {
  const requests = [];
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
  await page.route("**/api/platform/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^\/api\/platform\/jobs\/[^/]+\/match-assessment$/.test(url.pathname)) {
      await route.fulfill({ status: 404, headers, json: { code: "not_found" } });
      return;
    }
    requests.push({
      body: request.postData(),
      headers: request.headers(),
      method: request.method(),
      url: request.url(),
    });
    const response = responses[requests.length - 1];
    assert(response, `Unexpected synthetic match request ${requests.length}`);
    if (response.gate) {
      response.gate.markStarted();
      await withTimeout(response.gate.gate, "deferred match response release");
    }
    try {
      await route.fulfill({
        status: response.status ?? 200,
        headers: {
          ...headers,
          "content-type":
            response.status && response.status >= 400
              ? "application/problem+json; charset=utf-8"
              : headers["content-type"],
        },
        json: response.body,
      });
    } catch (error) {
      if (!response.allowAborted) throw error;
    } finally {
      response.gate?.markCompleted();
    }
  });
  return requests;
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

async function mountCandidateSurface(page, origin, story, props) {
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(5_000);
  const response = await page.goto(origin);
  assert(response, "Gallery document response is required");
  assert.equal(response.headers()["cache-control"], "no-store");
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  await page.waitForFunction(() => typeof window.mount === "function");
  await page.evaluate(
    ({ storyName, storyProps }) => window.mount({ story: storyName, props: storyProps }),
    { storyName: story, storyProps: props },
  );
  return page.locator("#root");
}

async function settleBrowserRender(page) {
  await withTimeout(
    page.evaluate(
      () =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
        ),
    ),
    "browser render settlement",
    5_000,
  );
}

async function assertVisibleFocus(locator) {
  await locator.focus();
  assert(await locator.evaluate((element) => document.activeElement === element));
  const focusStyle = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert.notEqual(focusStyle.outlineStyle, "none");
  assert(Number.parseFloat(focusStyle.outlineWidth) > 0);
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

async function waitForSavedJobsText(page, text) {
  await page.waitForFunction((expected) => {
    const section = document.querySelector(".saved-jobs");
    return Boolean(
      section && section.getClientRects().length > 0 && section.innerText.includes(expected),
    );
  }, text);
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

async function runEntitlementRecoveryAndSessionScenario(browser, origin) {
  const recoveryContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await recoveryContext.newPage();
    const { entitlementRequests, retryGate } = await installSyntheticEntitlementBff(page);
    const component = await mountCandidateCatalog(page, origin);
    const entitlement = component.locator(".entitlement-status");
    await entitlement
      .getByText("Access status is temporarily unavailable.", { exact: true })
      .waitFor();
    assert.equal(entitlementRequests.length, 1);
    assert(!(await entitlement.textContent()).includes(PRIVATE_CANARY));

    const retry = entitlement.getByRole("button", { name: "Retry access status" });
    await assertVisibleFocus(retry);
    await retry.press("Enter");
    await withTimeout(retryGate.started, "entitlement retry start");
    assert.equal(entitlementRequests.length, 2);
    for (const request of entitlementRequests) {
      assert.equal(request.method, "GET");
      assert.equal(request.body, null);
      assert.equal(new URL(request.url).search, "");
    }
    await entitlement.getByText("Loading access status…", { exact: true }).waitFor();
    assert.equal(await entitlement.getByRole("button", { name: "Retry access status" }).count(), 0);

    retryGate.release();
    await withTimeout(retryGate.completed, "entitlement retry completion");
    await entitlement.getByText("Free access", { exact: true }).waitFor();
    const entitlementText = await entitlement.textContent();
    assert(!entitlementText.includes(PRIVATE_CANARY));
    assert(!/upgrade|payment|price|quota/i.test(entitlementText));
    assert.equal(entitlementRequests.length, 2);
    await assertNoWcagViolations(page);
  } finally {
    await recoveryContext.close();
  }

  const staleContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await staleContext.newPage();
    const { entitlementRequests, retryGate } = await installSyntheticEntitlementBff(page);
    const component = await mountCandidateCatalog(page, origin);
    const entitlement = component.locator(".entitlement-status");
    await entitlement
      .getByText("Access status is temporarily unavailable.", { exact: true })
      .waitFor();
    await entitlement.getByRole("button", { name: "Retry access status" }).click();
    await withTimeout(retryGate.started, "stale entitlement retry start");

    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: false },
      }),
    );
    await entitlement.getByText("Sign in to view your current access.", { exact: true }).waitFor();
    retryGate.release();
    await withTimeout(retryGate.completed, "stale entitlement retry completion");
    await settleBrowserRender(page);

    assert.equal(entitlementRequests.length, 2);
    const entitlementText = await entitlement.textContent();
    assert(!entitlementText.includes("Free access"));
    assert(!entitlementText.includes(PRIVATE_CANARY));
    await assertNoWcagViolations(page);
  } finally {
    await staleContext.close();
  }
}

async function runSavedJobsLifecycleScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const requests = await installSyntheticSavedJobsBff(page, {
      deleteResponses: [{ status: 204 }],
      savedSearchResponses: [
        { body: { items: [] } },
        { body: { items: [syntheticSavedJob] } },
        { body: { items: [] } },
      ],
    });
    const component = await mountCandidateCatalog(page, origin);
    await waitForSavedJobsText(page, "No jobs saved yet.");

    const keywords = component.getByRole("searchbox", { name: /^Keywords/ });
    await keywords.fill("synthetic saved lifecycle");
    await keywords.press("Enter");
    const searchRegion = component.getByRole("region", { name: "Search current jobs" });
    await searchRegion.getByRole("status").getByText("1 job loaded.", { exact: true }).waitFor();
    await searchRegion.getByRole("button", { name: "Save job" }).press("Enter");
    await searchRegion.getByText("Job saved to your private list.", { exact: true }).waitFor();
    await component.getByRole("heading", { name: syntheticJob.title }).nth(1).waitFor();

    assert.equal(requests.saves.length, 1);
    assert.deepEqual(JSON.parse(requests.saves[0].body), { jobId: SYNTHETIC_JOB_ID });
    assert.match(requests.saves[0].headers["idempotency-key"], /^saved-job-[0-9a-f-]{36}$/);
    assert.equal(requests.searches.length, 2);
    assert.deepEqual(
      requests.searches.map(({ body }) => JSON.parse(body)),
      [{ pageSize: 20 }, { pageSize: 20 }],
    );

    await component.getByRole("button", { name: "Remove" }).press("Enter");
    await waitForSavedJobsText(page, "Saved job removed.");
    assert.equal(await component.getByRole("button", { name: "Remove" }).count(), 0);
    assert.equal(await page.locator(".saved-jobs output").getAttribute("aria-live"), "polite");
    assert.equal(requests.deletes.length, 1);
    assert.equal(requests.deletes[0].path, `/api/platform/saved-jobs/${SYNTHETIC_SAVED_JOB_ID}`);
    assert.equal(requests.searches.length, 3);
    assert.deepEqual(JSON.parse(requests.searches[2].body), { pageSize: 20 });
    assert(
      await component
        .getByRole("heading", { name: "Saved jobs" })
        .evaluate((element) => document.activeElement === element),
    );
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runSavedJobsFaultRecoveryAndSessionScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const staleRefreshGate = createGate();
  try {
    const page = await context.newPage();
    const requests = await installSyntheticSavedJobsBff(page, {
      deleteResponses: [
        {
          status: 503,
          body: { code: "saved_jobs_unavailable", detail: PRIVATE_CANARY },
        },
        { status: 204 },
      ],
      savedSearchResponses: [
        { body: { items: [syntheticUnavailableSavedJob], nextCursor: "private.cursor" } },
        {
          status: 503,
          body: { code: "saved_jobs_unavailable", detail: PRIVATE_CANARY },
        },
        {
          body: {
            items: [
              {
                ...syntheticUnavailableSavedJob,
                id: "00000000-0000-7000-8000-000000000021",
                snapshot: {
                  ...syntheticUnavailableSavedJob.snapshot,
                  title: "Recovered Synthetic Engineer",
                },
              },
            ],
          },
        },
        {
          gate: staleRefreshGate,
          allowAborted: true,
          body: {
            items: [
              {
                ...syntheticUnavailableSavedJob,
                snapshot: { ...syntheticUnavailableSavedJob.snapshot, title: PRIVATE_CANARY },
              },
            ],
          },
        },
      ],
    });
    const component = await mountCandidateCatalog(page, origin);
    await waitForSavedJobsText(page, "This posting is no longer available in the active catalog.");
    await component.getByRole("button", { name: "Load more saved jobs" }).waitFor();

    await component.getByRole("button", { name: "Remove" }).press("Enter");
    await waitForSavedJobsText(page, "Saved jobs are temporarily unavailable.");
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(requests.deletes.length, 1);
    assert.equal(await component.getByRole("heading", { name: syntheticJob.title }).count(), 1);

    await component.getByRole("button", { name: "Remove" }).press("Enter");
    await waitForSavedJobsText(page, "Saved jobs are temporarily unavailable.");
    assert.equal(requests.deletes.length, 2);
    assert.equal(await component.getByRole("heading", { name: syntheticJob.title }).count(), 0);
    assert.equal(await component.getByRole("button", { name: "Load more saved jobs" }).count(), 0);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.deepEqual(JSON.parse(requests.searches[1].body), { pageSize: 20 });

    await page.evaluate(() => window.dispatchEvent(new Event("ai-job-apply:saved-jobs-changed")));
    await waitForSavedJobsText(page, "Recovered Synthetic Engineer");
    assert.equal(requests.searches.length, 3);
    assert.deepEqual(JSON.parse(requests.searches[2].body), { pageSize: 20 });
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));

    await page.evaluate(() => window.dispatchEvent(new Event("ai-job-apply:saved-jobs-changed")));
    await withTimeout(staleRefreshGate.started, "deferred saved-jobs refresh start");
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: false },
      }),
    );
    await component.getByText("Sign in to keep a private list of jobs.").waitFor();
    staleRefreshGate.release();
    await withTimeout(staleRefreshGate.completed, "deferred saved-jobs refresh completion");
    await settleBrowserRender(page);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(await component.getByRole("heading", { name: syntheticJob.title }).count(), 0);
    await assertNoWcagViolations(page);
  } finally {
    staleRefreshGate.release();
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

async function runJobReportScenario(browser, origin) {
  const retryContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await retryContext.newPage();
    const requests = await installSyntheticReportBff(page, [
      { kind: "abort" },
      { kind: "abort" },
      { kind: "success" },
    ]);
    const component = await mountCandidateSurface(
      page,
      origin,
      "d1-candidate-surfaces/CandidateJobReport",
      { jobId: SYNTHETIC_JOB_ID },
    );
    const summary = component.getByText("Report a catalog issue", { exact: true });
    await summary.waitFor();
    await assertVisibleFocus(summary);
    await summary.press("Enter");

    const reason = component.getByLabel("Issue");
    await reason.waitFor();
    await assertVisibleFocus(reason);
    assert.deepEqual(
      await reason
        .locator("option")
        .evaluateAll((options) => options.slice(1).map((option) => option.value)),
      REPORT_REASONS,
    );
    assert.equal(await reason.locator("option").count(), REPORT_REASONS.length + 1);

    await reason.selectOption("suspected_scam");
    const submit = component.getByRole("button", { name: "Submit report" });
    await assertVisibleFocus(submit);
    await submit.press("Enter");
    const liveOutput = component.locator('output[aria-live="polite"]');
    await liveOutput
      .getByText("The report could not be submitted. Retry to safely check the same report.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      new URL(requests[0].url).pathname,
      `/api/platform/jobs/${SYNTHETIC_JOB_ID}/reports`,
    );
    assert.equal(new URL(requests[0].url).search, "");
    assert.equal(requests[0].body, '{"reason":"suspected_scam"}');
    assert.equal(requests[0].headers["content-type"], "application/json");
    assert.match(requests[0].headers["idempotency-key"], /^job-report-[0-9a-f-]{36}$/);

    await assertVisibleFocus(submit);
    await submit.press("Enter");
    await liveOutput
      .getByText("The report could not be submitted. Retry to safely check the same report.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body, requests[0].body);
    assert.equal(requests[1].headers["idempotency-key"], requests[0].headers["idempotency-key"]);

    await reason.selectOption("duplicate_listing");
    assert.equal(await liveOutput.count(), 0);
    await assertVisibleFocus(submit);
    await submit.press("Enter");
    await component
      .getByText("Report received for review. Reporting does not automatically change this job.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].body, '{"reason":"duplicate_listing"}');
    assert.notEqual(requests[2].headers["idempotency-key"], requests[0].headers["idempotency-key"]);
    await component
      .getByText(
        "Reports are reviewed. They do not automatically remove a job or pause a source.",
        {
          exact: true,
        },
      )
      .waitFor();
    const reportText = await component.textContent();
    assert(
      !/will (?:remove|suppress) (?:the |this )?job|will pause (?:the |this )?source/i.test(
        reportText,
      ),
    );
    await assertNoWcagViolations(page);
  } finally {
    await retryContext.close();
  }

  const redactionContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await redactionContext.newPage();
    await installSyntheticReportBff(page, [
      {
        kind: "problem",
        status: 503,
        body: { code: "private_internal_report_failure", detail: PRIVATE_CANARY },
      },
    ]);
    const component = await mountCandidateSurface(
      page,
      origin,
      "d1-candidate-surfaces/CandidateJobReport",
      { jobId: SYNTHETIC_JOB_ID },
    );
    await component.getByText("Report a catalog issue", { exact: true }).click();
    await component.getByLabel("Issue").selectOption("other_catalog_issue");
    await component.getByRole("button", { name: "Submit report" }).press("Enter");
    await component
      .getByText("The report could not be submitted. Try again.", { exact: true })
      .waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    await assertNoWcagViolations(page);
  } finally {
    await redactionContext.close();
  }

  const staleContext = await browser.newContext({ serviceWorkers: "block" });
  const staleGate = createGate();
  try {
    const page = await staleContext.newPage();
    await installSyntheticReportBff(page, [
      {
        kind: "success",
        gate: staleGate,
        allowAborted: true,
        body: { accepted: true, detail: PRIVATE_CANARY },
      },
    ]);
    const component = await mountCandidateSurface(
      page,
      origin,
      "d1-candidate-surfaces/CandidateJobReport",
      { jobId: SYNTHETIC_JOB_ID },
    );
    await component.getByText("Report a catalog issue", { exact: true }).click();
    await component.getByLabel("Issue").selectOption("job_closed");
    await component.getByRole("button", { name: "Submit report" }).press("Enter");
    await withTimeout(staleGate.started, "deferred report request start");
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: false },
      }),
    );
    await component.getByText("Sign in to search the candidate job catalog.").waitFor();
    staleGate.release();
    await withTimeout(staleGate.completed, "deferred report request completion");
    await settleBrowserRender(page);
    const signedOutText = await component.textContent();
    assert(!signedOutText.includes(PRIVATE_CANARY));
    assert(!signedOutText.includes("Report received for review"));
    assert.equal(await component.getByText("Report a catalog issue", { exact: true }).count(), 0);
    await assertNoWcagViolations(page);
  } finally {
    staleGate.release();
    await staleContext.close();
  }
}

async function runMatchAssessmentScenario(browser, origin) {
  const matchContext = await browser.newContext({ serviceWorkers: "block" });
  const initialGate = createGate();
  const staleGate = createGate();
  try {
    const page = await matchContext.newPage();
    const requests = await installSyntheticMatchBff(page, [
      {
        gate: initialGate,
        body: syntheticMatchAssessment(SYNTHETIC_JOB_ID),
      },
      {
        gate: staleGate,
        allowAborted: true,
        body: { ...syntheticMatchAssessment(SYNTHETIC_JOB_ID), privateDetail: PRIVATE_CANARY },
      },
      {
        body: syntheticMatchAssessment(SECOND_SYNTHETIC_JOB_ID, { conflict: true }),
      },
    ]);
    const component = await mountCandidateSurface(
      page,
      origin,
      "d1-candidate-surfaces/CandidateMatchAssessment",
      { jobId: SYNTHETIC_JOB_ID },
    );
    const check = component.getByRole("button", { name: "Check match evidence" });
    await assertVisibleFocus(check);
    await check.press("Enter");
    await withTimeout(initialGate.started, "initial match request start");
    const matchRegion = component.getByRole("region", { name: "Match evidence" });
    assert.equal(await matchRegion.getAttribute("aria-busy"), "true");
    const matchLiveRegion = component.locator('div[aria-live="polite"]');
    await matchLiveRegion.getByText("Checking match evidence…", { exact: true }).waitFor();
    initialGate.release();
    await withTimeout(initialGate.completed, "initial match request completion");
    await component.getByText(MATCH_REVIEW_HEADING, { exact: true }).waitFor();
    await component.getByText(MATCH_REVIEW_SUMMARY, { exact: true }).waitFor();
    await component.getByText(MATCH_NONCLAIM, { exact: true }).waitFor();
    const evidenceItems = component.locator(".match-assessment-result li");
    assert.deepEqual(
      await evidenceItems.allTextContents(),
      MATCH_REVIEW_EVIDENCE.map(({ state, reason }) => `${state} ${reason}`),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].body, null);
    assert.equal(
      new URL(requests[0].url).pathname,
      `/api/platform/jobs/${SYNTHETIC_JOB_ID}/match-assessment`,
    );
    assert.equal(new URL(requests[0].url).search, "");
    const positiveMatchCopy = (await component.textContent()).replace(MATCH_NONCLAIM, "");
    assert(!/\b(?:score\w*|rank\w*|fit\w*|outcome\w*|eligib\w*)\b/i.test(positiveMatchCopy));
    await assertNoWcagViolations(page);

    const refresh = component.getByRole("button", { name: "Refresh match evidence" });
    await refresh.press("Enter");
    await withTimeout(staleGate.started, "stale match request start");
    await page.evaluate(
      ({ nextJobId }) =>
        window.mount({
          story: "d1-candidate-surfaces/CandidateMatchAssessment",
          props: { jobId: nextJobId },
        }),
      { nextJobId: SECOND_SYNTHETIC_JOB_ID },
    );
    await component.getByRole("button", { name: "Check match evidence" }).waitFor();
    assert.equal(await matchRegion.getAttribute("aria-busy"), "false");
    assert.equal(await component.getByText(MATCH_REVIEW_HEADING, { exact: true }).count(), 0);
    staleGate.release();
    await withTimeout(staleGate.completed, "stale match request completion");
    await settleBrowserRender(page);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(await component.getByText(MATCH_REVIEW_HEADING, { exact: true }).count(), 0);

    await component.getByRole("button", { name: "Check match evidence" }).press("Enter");
    await component.getByText(MATCH_CONFLICT_HEADING, { exact: true }).waitFor();
    await component.getByText(MATCH_CONFLICT_SUMMARY, { exact: true }).waitFor();
    const conflictItems = component.locator(".match-assessment-result li");
    assert.deepEqual(await conflictItems.allTextContents(), [
      "conflict The job’s stated work mode conflicts with your selections.",
      ...MATCH_REVIEW_EVIDENCE.slice(1).map(({ state, reason }) => `${state} ${reason}`),
    ]);
    assert.equal(await component.locator('li[data-state="conflict"]').count(), 1);
    assert.equal(requests.length, 3);
    assert.equal(
      new URL(requests[2].url).pathname,
      `/api/platform/jobs/${SECOND_SYNTHETIC_JOB_ID}/match-assessment`,
    );
    await assertNoWcagViolations(page);
  } finally {
    initialGate.release();
    staleGate.release();
    await matchContext.close();
  }

  const redactionContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await redactionContext.newPage();
    await installSyntheticMatchBff(page, [
      {
        status: 503,
        body: { code: "private_internal_match_failure", detail: PRIVATE_CANARY },
      },
    ]);
    const component = await mountCandidateSurface(
      page,
      origin,
      "d1-candidate-surfaces/CandidateMatchAssessment",
      { jobId: SYNTHETIC_JOB_ID },
    );
    await component.getByRole("button", { name: "Check match evidence" }).press("Enter");
    await component
      .getByText("Match evidence is temporarily unavailable.", { exact: true })
      .waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    await assertNoWcagViolations(page);
  } finally {
    await redactionContext.close();
  }
}

function syntheticJobDetail(overrides = {}) {
  return {
    ...syntheticJob,
    description:
      "Synthetic employer description.\n<script>synthetic-untrusted-description</script>",
    sources: [
      {
        provider: "greenhouse",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.synthetic.example/positions/one",
        firstObservedAt: syntheticJob.firstObservedAt,
        lastVerifiedAt: syntheticJob.lastVerifiedAt,
        validThrough: syntheticJob.expiresAt,
      },
      {
        provider: "ugc",
        provenance: "explicit_ugc",
        canonicalUrl: "https://careers.synthetic.example/positions/one",
        firstObservedAt: syntheticJob.firstObservedAt,
        lastVerifiedAt: syntheticJob.lastVerifiedAt,
      },
    ],
    ...overrides,
  };
}

async function installSyntheticJobDetailBff(page, responses) {
  const catalog = await installSyntheticBff(page);
  const detailRequests = [];
  await page.route("**/api/platform/jobs/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^\/api\/platform\/jobs\/[a-f0-9-]{36}$/.test(url.pathname)) {
      await route.fallback();
      return;
    }
    detailRequests.push({
      body: request.postData(),
      headers: request.headers(),
      method: request.method(),
      url: request.url(),
    });
    const response = responses[detailRequests.length - 1];
    assert(response, "Unexpected generated job detail request");
    if (response.gate) {
      response.gate.markStarted();
      await withTimeout(response.gate.gate, "deferred job detail response release");
    }
    try {
      await route.fulfill({
        status: response.status ?? 200,
        headers: {
          "cache-control": "no-store",
          "content-type":
            response.status && response.status >= 400
              ? "application/problem+json; charset=utf-8"
              : "application/json; charset=utf-8",
        },
        json: response.body,
      });
    } catch (error) {
      if (!response.allowAborted) throw error;
    } finally {
      response.gate?.markCompleted();
    }
  });
  return { ...catalog, detailRequests };
}

async function runJobDetailDisclosureScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const loading = createGate();
    const requests = await installSyntheticJobDetailBff(page, [
      { gate: loading, body: syntheticJobDetail({ id: SECOND_SYNTHETIC_JOB_ID }) },
      {
        status: 503,
        body: { title: PRIVATE_CANARY, detail: PRIVATE_CANARY, code: PRIVATE_CANARY },
      },
      { body: syntheticJobDetail() },
    ]);
    const component = await mountCandidateCatalog(page, origin);
    await component.getByRole("searchbox", { name: /^Keywords/ }).press("Enter");
    await component.getByRole("heading", { name: syntheticJob.title }).waitFor();
    const ordering = await component.locator(".job-results article > h3").allTextContents();
    const trigger = component.getByRole("button", {
      name: "View details and sources",
      exact: true,
    });
    assert.equal(requests.detailRequests.length, 0);
    await assertVisibleFocus(trigger);
    await trigger.press("Enter");
    await withTimeout(loading.started, "job detail request start");
    const panel = component.getByRole("region", { name: "Job details and sources", exact: true });
    await panel
      .getByRole("status")
      .getByText("Loading job details and sources…", { exact: true })
      .waitFor();
    await settleBrowserRender(page);
    assert(
      await panel
        .getByRole("heading", { name: "Job details and sources" })
        .evaluate((element) => document.activeElement === element),
    );
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert(await trigger.isDisabled());
    loading.release();
    await withTimeout(loading.completed, "job detail response completion");
    await panel.getByText("Job details loaded.", { exact: true }).waitFor();
    assert.equal(
      await panel.locator(".job-detail-description").textContent(),
      syntheticJobDetail().description,
    );
    assert.equal(await panel.locator("script").count(), 0);
    assert.equal(await panel.locator("a").count(), 2);
    assert.equal(await panel.getByText("Authorized test fixture", { exact: true }).count(), 1);
    assert.equal(await panel.getByText("Community contribution", { exact: true }).count(), 1);
    for (const link of await panel.locator("a").all()) {
      assert((await link.getAttribute("href")).startsWith("https://"));
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
      assert.equal(await link.getAttribute("referrerpolicy"), "no-referrer");
      assert((await link.textContent()).includes("opens in a new tab"));
    }
    assert.equal(requests.detailRequests.length, 1);
    const request = requests.detailRequests[0];
    assert.equal(new URL(request.url).pathname, `/api/platform/jobs/${SYNTHETIC_JOB_ID}`);
    assert.equal(new URL(request.url).search, "");
    assert.equal(request.method, "GET");
    assert.equal(request.body, null);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.referer, undefined);
    assert.deepEqual(
      await component.locator(".job-results article > h3").allTextContents(),
      ordering,
    );
    assert.equal(await component.getByRole("button", { name: "Save job", exact: true }).count(), 1);
    assert.equal(
      await component.getByRole("button", { name: "Check match evidence", exact: true }).count(),
      1,
    );
    assert.equal(await component.locator('a[href^="/jobs/"]').count(), 0);
    await assertNoWcagViolations(page);

    await panel.getByRole("button", { name: "Close details", exact: true }).press("Escape");
    await settleBrowserRender(page);
    assert.equal(await panel.count(), 0);
    assert(await trigger.evaluate((element) => document.activeElement === element));
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.press("Enter");
    await panel
      .getByRole("alert")
      .getByText("Job details are temporarily unavailable. Try again.", { exact: true })
      .waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(requests.detailRequests.length, 2);
    const retry = panel.getByRole("button", { name: "Retry details", exact: true });
    await assertVisibleFocus(retry);
    await retry.press("Enter");
    await panel.getByText("Job details loaded.", { exact: true }).waitFor();
    assert.equal(requests.detailRequests.length, 3);
    assert.deepEqual(
      await component.locator(".job-results article > h3").allTextContents(),
      ordering,
    );
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runJobDetailSessionScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const stale = createGate();
    const requests = await installSyntheticJobDetailBff(page, [
      {
        gate: stale,
        allowAborted: true,
        body: syntheticJobDetail({ description: PRIVATE_CANARY }),
      },
      { body: syntheticJobDetail({ id: SECOND_SYNTHETIC_JOB_ID }) },
    ]);
    const component = await mountCandidateCatalog(page, origin);
    await component.getByRole("searchbox", { name: /^Keywords/ }).press("Enter");
    await component
      .getByRole("button", { name: "View details and sources", exact: true })
      .press("Enter");
    await withTimeout(stale.started, "stale job detail request start");
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: false },
      }),
    );
    await component.getByText("Sign in to search the candidate job catalog.").waitFor();
    assert.equal(await component.locator(".job-detail").count(), 0);
    stale.release();
    await withTimeout(stale.completed, "stale job detail response completion");
    await settleBrowserRender(page);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(requests.detailRequests.length, 1);
    await page.evaluate(() =>
      window.mount({
        story: "d1-candidate-surfaces/CandidateCatalog",
        props: { authenticated: true },
      }),
    );
    await component.getByRole("searchbox", { name: /^Keywords/ }).press("Enter");
    await component
      .getByRole("button", { name: "View details and sources", exact: true })
      .press("Enter");
    await component.getByText("Job details loaded.", { exact: true }).waitFor();
    assert.equal(requests.detailRequests.length, 2);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
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
  await runEntitlementRecoveryAndSessionScenario(browser, server.origin);
  process.stdout.write("PASS entitlement/manual-retry/redaction/session-fencing/WCAG scenario\n");
  await runSavedJobsLifecycleScenario(browser, server.origin);
  process.stdout.write("PASS saved-jobs lifecycle/reconciliation/focus/WCAG scenario\n");
  await runSavedJobsFaultRecoveryAndSessionScenario(browser, server.origin);
  process.stdout.write("PASS saved-jobs fault/redaction/recovery/session/WCAG scenario\n");
  await runOnboardingTruthAndWcagScenario(browser, server.origin);
  process.stdout.write("PASS onboarding/preferences/direct-facts/resume/WCAG scenario\n");
  await runOnboardingLegacyAndSessionScenario(browser, server.origin);
  process.stdout.write("PASS onboarding restricted-data/session-fencing/WCAG scenario\n");
  await runJobReportScenario(browser, server.origin);
  process.stdout.write("PASS report/retry/redaction/session-fencing/WCAG scenario\n");
  await runMatchAssessmentScenario(browser, server.origin);
  process.stdout.write("PASS match-evidence/copy/redaction/job-fencing/WCAG scenario\n");
  await runJobDetailDisclosureScenario(browser, server.origin);
  process.stdout.write("PASS job-details/alias/plain-text/sources/keyboard/retry/WCAG scenario\n");
  await runJobDetailSessionScenario(browser, server.origin);
  process.stdout.write("PASS job-details/session-abort/stale-response/WCAG scenario\n");
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
