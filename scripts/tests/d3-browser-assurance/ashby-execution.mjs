import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// Real Chromium against a generated synthetic Ashby-shaped page; every request is intercepted
// locally and nothing is sent anywhere. Not installed-extension or provider acceptance.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bundle = await build({
  entryPoints: [resolve(root, "scripts/tests/d3-browser-assurance/ashby-execution-entry.mjs")],
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
assert(executablePath, "An installed Chrome binary is required");
const browser = await chromium.launch({ executablePath, headless: true });
const url = "https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application";
const modes = [
  "success",
  "off",
  "candidate-incomplete",
  "wrong-form",
  "no-message",
  "challenge-at-start",
  "challenge-after-click",
  "navigation",
];
const unexpected = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const request = route.request();
    // The fixture's reCAPTCHA frames load nothing: they are answered locally with an empty page.
    if (request.method() === "GET" && request.url().includes("recaptcha.net/recaptcha/")) {
      await route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "" });
      return;
    }
    if (request.method() !== "GET" || ![url, `${url}/fixture.js`].includes(request.url())) {
      unexpected.push({ method: request.method(), kind: "unexpected_request" });
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
        : '<!doctype html><html lang="en"><title>Synthetic Ashby execution</title><body><script type="module" src="/synthetic/00000000-0000-4000-8000-000000000001/application/fixture.js"></script></body></html>',
    });
  });
  const page = await context.newPage();
  for (const mode of modes) {
    await page.goto(url);
    await page.waitForFunction(() => typeof window.runAshbyExecutionFixture === "function");
    const result = await page.evaluate((mode) => window.runAshbyExecutionFixture(mode), mode);
    const text = `${mode}: ${JSON.stringify(result)}`;
    assert.equal(result.result.kind === "confirmed", mode === "success", text);
    assert.equal(result.resumeCleared, mode !== "success" ? true : result.resumeCleared, text);
    assert.equal(
      result.submits,
      ["success", "no-message", "challenge-after-click", "navigation"].includes(mode) ? 1 : 0,
      text,
    );
    if (mode === "success") {
      assert.equal(result.name, undefined, "the confirmation replaced the form");
      assert.equal(result.result.confirmation.kind, "provider_confirmation_page", text);
      assert.equal(result.result.confirmation.providerReference, undefined, text);
      assert.deepEqual(
        result.attached.map((entry) => entry.name),
        ["tailored_resume.pdf"],
        text,
      );
    }
    if (["off", "candidate-incomplete", "wrong-form"].includes(mode)) {
      assert.equal(result.effects, 0, text);
      assert.equal(result.result.kind, "precondition_failed", text);
    }
    if (mode === "challenge-at-start") {
      // Everything is prepared for the candidate, but the submit control is never used.
      assert.equal(result.result.kind, "challenge_required", text);
      assert.ok(result.effects > 0, "challenge-at-start must prepare the form");
    }
    if (mode === "challenge-after-click")
      assert.equal(result.result.kind, "challenge_required", text);
    if (mode === "no-message")
      // Either way the click happened and nothing confirmed it, so the candidate settles it.
      assert.ok(["timeout", "unrecognized_response"].includes(result.result.kind), text);
    if (mode === "navigation") assert.equal(result.result.kind, "unrecognized_response", text);
  }
  assert.deepEqual(unexpected, []);
  console.log(
    JSON.stringify({
      profile: "d3_ashby_execution_generated_synthetic_v1",
      cases: modes.length,
      externalRequests: 0,
      providerUploads: 0,
      installedExtensionAcceptance: false,
      passed: true,
    }),
  );
} finally {
  await browser.close();
}
