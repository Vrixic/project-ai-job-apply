import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { chromium } from "playwright-core";
import {
  isAllowedAdminAssuranceRequest,
  resolveAdminAssuranceConfiguration,
  startAdminAssuranceServer,
} from "./server.mjs";

const PRIVATE_CANARY = "synthetic-private-operator-canary-never-render";
const JOB_ID = "00000000-0000-7000-8000-000000000001";
const CASE_ID = "00000000-0000-7000-8000-000000000010";
const SOURCE_CASE_ID = "00000000-0000-7000-8000-000000000011";
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessRoot, "../../..");
const adminRoot = resolve(repositoryRoot, "frontend/admin");

const jobCase = Object.freeze({
  id: CASE_ID,
  openReasonCode: "candidate_reports",
  openedAt: "2026-08-22T12:00:00.000Z",
  status: "open",
  target: { jobId: JOB_ID, kind: "job" },
  version: 0,
});
const sourceCase = Object.freeze({
  id: SOURCE_CASE_ID,
  openReasonCode: "source_integrity",
  openedAt: "2026-08-22T12:01:00.000Z",
  status: "open",
  target: {
    adapterConfigSha256: "a".repeat(64),
    adapterVersion: "synthetic-v1",
    kind: "source",
    sourceId: "synthetic-source",
  },
  version: 0,
});

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
    } catch {}
  }
  throw new Error("A local Chrome installation is required for D1 admin browser assurance");
}

async function assertProductionBoundary() {
  assert(relative(adminRoot, harnessRoot).startsWith(".."));
  const packageJson = JSON.parse(await readFile(resolve(adminRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  assert(!dependencyNames.some((name) => /axe|playwright/i.test(name)));
  assert.throws(() => resolveAdminAssuranceConfiguration({}), /NODE_ENV must equal test/);
  assert(isAllowedAdminAssuranceRequest("GET", "/bundle.js"));
  assert(!isAllowedAdminAssuranceRequest("POST", "/bundle.js"));
  assert(!isAllowedAdminAssuranceRequest("GET", "/api/moderation/cases/search"));
}

async function mountAdmin(page, origin) {
  page.setDefaultTimeout(5_000);
  const response = await page.goto(origin);
  assert(response);
  assert.equal(response.headers()["cache-control"], "no-store");
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  await page.waitForFunction(() => typeof window.mountAdmin === "function");
  await page.evaluate(() => window.mountAdmin());
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

async function runModerationControlScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const requests = [];
    let searchCount = 0;
    await page.route("**/api/moderation/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ body: request.postData(), method: request.method(), pathname: url.pathname });
      if (url.pathname === "/api/moderation/cases/search") {
        searchCount += 1;
        const body = JSON.parse(request.postData() ?? "{}");
        const items = body.cursor ? [sourceCase] : searchCount === 1 ? [jobCase] : [];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            items,
            ...(!body.cursor && searchCount === 1 && { nextCursor: "next.page" }),
          }),
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/report-summary")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            canonicalJobId: JOB_ID,
            counts: {
              duplicate_listing: 0,
              job_closed: 1,
              job_inaccurate: 1,
              job_not_found: 0,
              other_catalog_issue: 0,
              suspected_scam: 1,
            },
            total: 3,
          }),
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith(`/cases/${CASE_ID}/resolve`)) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ...jobCase,
            resolution: "block_job",
            resolutionReasonCode: "report_confirmed",
            resolvedAt: "2026-08-22T12:10:00.000Z",
            status: "resolved",
            version: 1,
          }),
          status: 200,
        });
        return;
      }
      await route.fulfill({ contentType: "application/problem+json", body: "{}", status: 500 });
    });

    const component = await mountAdmin(page, origin);
    await component.getByText("1 cases loaded.", { exact: true }).waitFor();
    await component.getByText(JOB_ID, { exact: true }).waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));

    await component.getByRole("button", { name: "Load more cases" }).click();
    await component.getByText("1 more cases loaded.", { exact: true }).waitFor();
    await component.getByText("synthetic-source / synthetic-v1", { exact: true }).waitFor();
    const pageRequest = JSON.parse(
      requests.find((request) => request.body?.includes("next.page")).body,
    );
    assert.deepEqual(pageRequest, { cursor: "next.page", pageSize: 50, status: "open" });

    await component.getByRole("button", { name: "View aggregate reports" }).click();
    await component.getByRole("heading", { name: "Aggregate reports: 3" }).waitFor();
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));

    await component.getByRole("button", { name: "Block job" }).click();
    const confirmation = component.getByRole("complementary", {
      name: "Confirm moderation decision",
    });
    await confirmation.waitFor();
    assert.equal(
      await confirmation
        .getByRole("button", { name: "Confirm decision" })
        .evaluate((element) => document.activeElement === element),
      true,
    );
    assert.equal(requests.filter((request) => request.pathname.endsWith("/resolve")).length, 0);
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    assert.equal(await confirmation.count(), 0);

    await component.getByRole("button", { name: "Block job" }).click();
    await component.getByRole("button", { name: "Confirm decision" }).click();
    await component.getByText("Moderation decision recorded.", { exact: true }).waitFor();
    const resolutionRequest = requests.find((request) => request.pathname.endsWith("/resolve"));
    assert.deepEqual(JSON.parse(resolutionRequest.body), {
      expectedVersion: 0,
      reasonCode: "report_confirmed",
      resolution: "block_job",
    });

    const kind = component.getByLabel("Target type");
    await kind.selectOption("source");
    assert.equal(await component.getByLabel("Job UUID").count(), 0);
    assert.equal(await component.getByLabel("Source ID").getAttribute("required"), "");
    assert.equal(await component.getByLabel("Adapter version").getAttribute("required"), "");
    assert.equal(await component.getByLabel("Adapter config SHA-256").getAttribute("required"), "");
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

async function runStaleQueueAndRedactionScenario(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    let releaseOpen;
    const openGate = new Promise((resolveGate) => {
      releaseOpen = resolveGate;
    });
    await page.route("**/api/moderation/cases/search", async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");
      if (body.status === "open") {
        await openGate;
        try {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ items: [{ ...jobCase, privateOperator: PRIVATE_CANARY }] }),
            status: 200,
          });
        } catch {}
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
        status: 200,
      });
    });
    const component = await mountAdmin(page, origin);
    await component.getByLabel("Case status").selectOption("resolved");
    await component.getByText("No resolved cases.", { exact: true }).waitFor();
    releaseOpen();
    await page.waitForTimeout(50);
    assert(!(await component.textContent()).includes(PRIVATE_CANARY));
    assert.equal(await component.getByText(JOB_ID, { exact: true }).count(), 0);
    await assertNoWcagViolations(page);
  } finally {
    await context.close();
  }
}

await assertProductionBoundary();
const chromePath = await findSystemChrome();
const server = await startAdminAssuranceServer({
  NODE_ENV: "test",
  D1_ADMIN_ASSURANCE_MODE: "generated-synthetic",
});
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  await runModerationControlScenario(browser, server.origin);
  process.stdout.write("PASS admin pagination/confirmation/exact-target/WCAG scenario\n");
  await runStaleQueueAndRedactionScenario(browser, server.origin);
  process.stdout.write("PASS admin stale-queue/redaction/WCAG scenario\n");
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
