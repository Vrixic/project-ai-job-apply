import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bundle = await build({
  entryPoints: [resolve(root, "scripts/tests/d3-browser-assurance/greenhouse-execution-entry.mjs")],
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
const url = "https://boards.greenhouse.io/synthetic/jobs/123";
const modes = [
  "success",
  "off",
  "unbound-version",
  "unbound-implementation",
  "candidate-incomplete",
  "wrong-form",
  "expired",
  "claim-denied",
  "proof-failure",
  "preexisting-confirmation",
  "changed-structure",
  "same-size-swap",
  "cross-file-swap",
  "file-cleared",
  "ordinary-reverted",
  "kill-during-file",
  "cancel-during-file",
  "challenge-during-file",
  "challenge-at-start",
  "confirmation-and-challenge",
  "challenge-during-final-proof",
  "stalled-confirmation-hash",
  "generic-thank-you",
  "navigation",
  "uploaded-docx",
  "uploaded-docx-not-accepted",
];
const unexpected = [];
try {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const request = route.request();
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
        : '<!doctype html><html lang="en"><title>Synthetic execution</title><body><script type="module" src="/synthetic/jobs/123/fixture.js"></script></body></html>',
    });
  });
  const page = await context.newPage();
  for (const mode of modes) {
    await page.goto(url);
    await page.waitForFunction(() => typeof window.runGreenhouseExecutionFixture === "function");
    const result = await page.evaluate((mode) => window.runGreenhouseExecutionFixture(mode), mode);
    assert.equal(
      result.result.kind === "confirmed",
      ["success", "uploaded-docx"].includes(mode),
      `${mode}: ${JSON.stringify(result)}`,
    );
    assert.equal(result.filesCleared, true, `${mode}: file controls must be cleared`);
    assert.equal(
      result.submits,
      [
        "success",
        "uploaded-docx",
        "confirmation-and-challenge",
        "challenge-during-final-proof",
        "stalled-confirmation-hash",
        "generic-thank-you",
        "navigation",
      ].includes(mode)
        ? 1
        : 0,
      mode,
    );
    assert.equal(
      result.attestation,
      mode !== "candidate-incomplete",
      `${mode}: candidate-only answer changed`,
    );
    if (
      [
        "off",
        "unbound-version",
        "unbound-implementation",
        "candidate-incomplete",
        "wrong-form",
        "expired",
        "claim-denied",
        "proof-failure",
        "preexisting-confirmation",
      ].includes(mode)
    )
      assert.equal(result.effects, 0, mode);
    if (mode === "uploaded-docx") {
      // The candidate's own file keeps its format and is not given the generated-file name.
      assert.deepEqual(
        result.attached.map((entry) => entry.name),
        ["resume.docx"],
        mode,
      );
    }
    if (mode === "uploaded-docx-not-accepted")
      assert.deepEqual(result.attached, [], "a form that refuses Word never receives it");
    if (["confirmation-and-challenge", "challenge-during-final-proof"].includes(mode))
      assert.equal(result.result.kind, "challenge_required", mode);
    if (mode === "challenge-at-start") {
      // Everything is prepared for the candidate, but the submit control is never used.
      assert.equal(result.result.kind, "challenge_required", mode);
      assert.equal(result.submits, 0, mode);
      assert.ok(result.effects > 0, "challenge-at-start must prepare the form");
    }
  }
  assert.deepEqual(unexpected, []);
  console.log(
    JSON.stringify({
      profile: "d3_greenhouse_execution_generated_synthetic_v1",
      cases: modes.length,
      uploadedResumeCases: 2,
      confirmationCases: 2,
      falsePositiveConfirmations: 0,
      externalRequests: 0,
      providerUploads: 0,
      realDataTransferFileIdentity: true,
      registryIdentityOwnerProviderAuthority: "simulated",
      installedExtensionAcceptance: false,
      passed: true,
    }),
  );
} finally {
  await browser.close();
}
