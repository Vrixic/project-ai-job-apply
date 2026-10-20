import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { startD3BrowserAssuranceServer } from "./server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureBundle = await build({
  entryPoints: [resolve(root, "frontend/extension/tests/application-handoff-fixture.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { handoffFixture, LINK } = await import(
  `data:text/javascript;base64,${Buffer.from(fixtureBundle.outputFiles[0].text).toString("base64")}`
);
const bundle = await build({
  entryPoints: [resolve(root, "scripts/tests/d3-browser-assurance/handoff-entry.mjs")],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  write: false,
  define: {
    __APPLICATION_HANDOFF_WEB_ORIGIN__: '"https://candidate.example"',
    __EXTENSION_API_ORIGIN__: '"https://api.example"',
  },
  plugins: [
    {
      name: "synthetic-extension-authentication",
      setup(builder) {
        builder.onLoad({ filter: /frontend[\\/]extension[\\/]lib[\\/]protocol\.ts$/ }, () => ({
          contents: `export const authenticatedApiSession = async () => ({accessToken:"synthetic-token",identityFence:"synthetic-owner"}); export const authenticationStatus = async () => ({configured:true,authenticated:true,apiConfigured:true,refreshAvailable:false}); export const login=async()=>{};export const logout=async()=>{};export const refresh=async()=>{};`,
          loader: "js",
        }));
      },
    },
  ],
});
const candidates = [
  Reflect.get(process.env, "D3_BROWSER_ASSURANCE_CHROME_PATH"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    /* Try the next installed browser. */
  }
}
assert(executablePath, "A local Chrome binary is required");
const browser = await chromium.launch({ executablePath, headless: true });
let webServer;
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const fixture = handoffFixture();
  const calls = [];
  const violations = [];
  const html = (
    await readFile(resolve(root, "frontend/extension/static/popup.html"), "utf8")
  ).replace('src="popup.js"', 'src="handoff.js"');
  await context.route("https://extension.example/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html",
        "content-security-policy":
          "script-src 'self'; object-src 'self'; connect-src https://api.example",
        "cache-control": "no-store",
      },
      body: path.endsWith(".js")
        ? bundle.outputFiles[0].text
        : path.endsWith(".css")
          ? await readFile(resolve(root, "frontend/extension/static/popup.css"))
          : html,
    });
  });
  await context.route("https://api.example/**", async (route) => {
    const request = route.request();
    calls.push({
      url: request.url(),
      method: request.method(),
      authorization: request.headers().authorization,
    });
    const path = new URL(request.url()).pathname;
    const body = path.includes("/authorization")
      ? fixture.proof
      : path.includes("/v1/jobs/")
        ? fixture.job
        : path.includes("/v1/applications/")
          ? fixture.application
          : {};
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "https://extension.example",
        "access-control-allow-headers": "authorization",
      },
      body: JSON.stringify(body),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => violations.push(error.message));
  await page.goto("https://extension.example/popup.html");
  await page.getByLabel("Application review link").fill(LINK);
  await page.getByRole("button", { name: "Load approved answers", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy authorization.us_authorized", exact: true });
  await copy.waitFor();
  assert.equal(await copy.isEnabled(), false);
  await page
    .getByRole("checkbox", {
      name: "I checked this answer and the employer question/context match.",
      exact: true,
    })
    .check();
  await copy.click();
  await page
    .getByText(
      "Approved answer copied. Check it in the employer form before submitting yourself.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "No");
  assert.equal(await copy.isEnabled(), false);
  assert.equal(calls.filter((call) => call.url.includes("/v1/applications/")).length, 6);
  assert(calls.every((call) => call.method === "GET"));
  assert(
    calls
      .filter((call) => !call.url.includes("contribution-capability-policy"))
      .every((call) => call.authorization === "Bearer synthetic-token"),
  );
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert(
    !JSON.stringify(await page.evaluate(() => window.handoffSyntheticBoundary.storage())).includes(
      "synthetic@example.test",
    ),
  );
  await page.evaluate(() => window.handoffSyntheticBoundary.navigate("https://other.example/"));
  await page
    .getByRole("checkbox", {
      name: "I checked this answer and the employer question/context match.",
      exact: true,
    })
    .check();
  await copy.click();
  await page
    .getByText(
      "Open the matching employer page and reload an approved, unexpired application review link. Sign in again if needed.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await copy.count(), 0);
  await page.evaluate(() =>
    window.handoffSyntheticBoundary.navigate("https://employer.example/jobs/synthetic"),
  );
  await page.getByLabel("Application review link").fill(LINK);
  await page.getByRole("button", { name: "Copy employer question structure", exact: true }).click();
  await page.getByText(/Question structure copied without entered answers/u).waitFor();
  const observedText = await page.evaluate(() => navigator.clipboard.readText());
  const observed = JSON.parse(observedText);
  assert.equal(observed.schema, "application-observed-form.v1");
  assert(!observedText.includes("PRIVATE"));
  assert(!observedText.includes("private-y"));
  webServer = await startD3BrowserAssuranceServer();
  const web = await context.newPage();
  web.on("pageerror", (error) => violations.push(error.message));
  await web.goto(webServer.origin);
  await web.evaluate(() => window.showD3SavedAnswerJourney());
  await web.getByLabel("Employer question structure", { exact: true }).fill(observedText);
  await web.getByRole("button", { name: "Review captured questions", exact: true }).click();
  await web.waitForFunction(
    () =>
      document.querySelector('section[aria-label="Select saved application answers"] select') ||
      document
        .querySelector('section[aria-label="Select saved application answers"] [role="status"]')
        ?.textContent?.includes("unavailable"),
  );
  await web
    .getByLabel("Saved answer for Are you legally authorized to work in the United States?", {
      exact: true,
    })
    .selectOption("00000000-0000-7000-8000-000000000022:7");
  const prepareSaved = web.getByRole("button", {
    name: "Prepare with selected saved answers",
    exact: true,
  });
  assert.equal(await prepareSaved.isEnabled(), false);
  await web
    .getByRole("checkbox", {
      name: "I checked this employer question means exactly the same thing in the selected saved context.",
      exact: true,
    })
    .check();
  await web.addScriptTag({ content: axe.source });
  assert.deepEqual(
    (await web.evaluate(async () => (await window.axe.run(document)).violations)).map(
      (violation) => violation.id,
    ),
    [],
  );
  await prepareSaved.click();
  await web.getByText(/Saved answer version 7. Context: us.explicit./u).waitFor();
  // Sensitive and reviewable answers stay explicit: Apply is blocked until each is checked.
  const applySaved = web.getByRole("button", { name: "Apply", exact: true });
  assert.equal(await applySaved.isEnabled(), false);
  await web.getByRole("checkbox", { name: "I checked contact.email", exact: true }).check();
  assert.equal(await applySaved.isEnabled(), false);
  await web
    .getByRole("checkbox", { name: "I checked authorization.us_authorized", exact: true })
    .check();
  assert.equal(await applySaved.isEnabled(), true);
  // The employer page is a local stub; nothing leaves this machine.
  await web
    .context()
    .route(/^https:\/\/employer\.example\//u, (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<p>stub</p>" }),
    );
  const employerTab = web.context().waitForEvent("page");
  await applySaved.click();
  await (await employerTab).close();
  await web.getByRole("dialog").waitFor();
  // A form-bound packet cannot be recorded until the current form is explicitly confirmed.
  assert.equal(
    await web.getByRole("button", { name: "I submitted it", exact: true }).isEnabled(),
    false,
  );
  await page.bringToFront();
  await page.getByLabel("Application review link").fill(LINK);
  await page.getByRole("button", { name: "Copy employer question structure", exact: true }).click();
  await page.getByText(/Question structure copied without entered answers/u).waitFor();
  const freshText = await page.evaluate(() => navigator.clipboard.readText());
  await web.bringToFront();
  await web.getByLabel("Current employer question structure", { exact: true }).fill(freshText);
  await web.getByRole("button", { name: "Check current form", exact: true }).click();
  await web
    .getByRole("checkbox", {
      name: "I confirm these are the current employer questions and I will use the answers and materials I approved.",
      exact: true,
    })
    .check();
  await web.getByRole("button", { name: "I submitted it", exact: true }).click();
  await web.getByText("Submitted and confirmed.", { exact: true }).waitFor();
  await web.getByText("Submission confirmed by you.", { exact: true }).waitFor();
  const webCalls = await web.evaluate(() => window.readD3AssuranceCalls());
  const manualRequest = webCalls.find((call) => call.url.endsWith("/manual-submissions"));
  assert.equal(manualRequest.body.observedForm.confirmed, true);
  assert.equal(manualRequest.body.observedForm.capturedAtEpochMs, JSON.parse(freshText).capturedAt);
  const savedRequest = webCalls.find((call) => call.url.endsWith("/packets"));
  assert.equal(savedRequest.body.vaultSelections[0].version, 7);
  assert.equal(savedRequest.body.vaultSelections[0].context, "us.explicit");
  assert(
    !JSON.stringify(savedRequest.body).includes(
      "Are you legally authorized to work in the United States?",
    ),
  );
  assert(!JSON.stringify(savedRequest.body).includes('"value"'));
  assert.equal(await web.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(violations, []);
  console.log(
    "PASS production handoff UI/background and static validators under MV3 script CSP: approved false answer, per-copy reads, mandatory confirmation reset, changed-tab refusal, no answer persistence. Auth/Chrome APIs/API responses synthetic; clipboard real Chromium. No employer requests or submissions.",
  );
  console.log(
    "PASS explicit question capture -> real Chromium clipboard -> exact saved-version/context selection -> protected packet-shaped review of No -> approval -> manual confirmation/history; values excluded from capture, raw questions excluded from preparation; zero browser storage or employer submission. Chrome/auth/service responses synthetic; not installed/live acceptance.",
  );
} finally {
  await browser.close();
  await webServer?.close();
}
