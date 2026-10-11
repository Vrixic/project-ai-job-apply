import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bundle = await build({
  entryPoints: [resolve(root, "scripts/tests/d3-browser-assurance/greenhouse-entry.mjs")],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  write: false,
});
let executablePath;
for (const candidate of [
  Reflect.get(process.env, "D3_BROWSER_ASSURANCE_CHROME_PATH"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
].filter(Boolean)) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    /* Next installed browser. */
  }
}
assert(executablePath, "A local Chrome binary is required");
const browser = await chromium.launch({ executablePath, headless: true });
const url = "https://boards.greenhouse.io/synthetic/jobs/123";
const refusedNetwork = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || ![url, `${url}/fixture.js`].includes(request.url())) {
      refusedNetwork.push({ method: request.method(), kind: "unexpected_request" });
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": request.url().endsWith(".js") ? "text/javascript" : "text/html",
        "cache-control": "no-store",
        "content-security-policy": "script-src 'self'; connect-src 'none'; form-action 'none'",
      },
      body: request.url().endsWith(".js")
        ? bundle.outputFiles[0].text
        : '<!doctype html><html lang="en"><title>Synthetic adapter primitive</title><body><form id="application_form"><label for="email">Email</label><input id="email" name="email" type="email" required></form><script type="module" src="/synthetic/jobs/123/fixture.js"></script></body></html>',
    });
  });
  const page = await context.newPage();
  for (const mode of [
    "off",
    "fill",
    "challenge",
    "replace",
    "cancel",
    "hidden",
    "readonly",
    "inert",
    "revert",
    "number",
    "invalid",
    "pattern",
    "invalid-change",
    "select-disabled",
    "optgroup-disabled",
  ]) {
    await page.goto(url);
    await page.waitForFunction(() => typeof window.runGreenhousePrimitiveFixture === "function");
    const result = await page.evaluate((mode) => window.runGreenhousePrimitiveFixture(mode), mode);
    assert.equal(result.submits, 0);
    assert.equal(result.reviewRequired, mode !== "fill");
    assert.equal(result.changes, ["fill", "invalid-change"].includes(mode) ? 1 : 0);
    assert.deepEqual(result.filled, ["off", "cancel"].includes(mode) ? [] : ["f0"]);
    if (["off", "cancel"].includes(mode)) assert.equal(result.value, "");
  }
  assert.deepEqual(refusedNetwork, []);
  console.log(
    JSON.stringify({
      passed: true,
      cases: 15,
      browser: "installed headless Chromium",
      providerPages: "generated synthetic; every request intercepted locally",
      externalRequests: 0,
      realIdentity: false,
      uploads: 0,
      submissions: 0,
      installedExtensionAccepted: false,
    }),
  );
} finally {
  await browser.close();
}
