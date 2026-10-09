import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

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
  assert.deepEqual(violations, []);
  console.log(
    "PASS production handoff UI/background and static validators under MV3 script CSP: approved false answer, per-copy reads, mandatory confirmation reset, changed-tab refusal, no answer persistence. Auth/Chrome APIs/API responses synthetic; clipboard real Chromium. No employer requests or submissions.",
  );
} finally {
  await browser.close();
}
