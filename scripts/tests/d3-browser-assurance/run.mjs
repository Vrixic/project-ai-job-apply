import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import axe from "axe-core";
import { chromium } from "playwright-core";
import { startD3BrowserAssuranceServer } from "./server.mjs";

async function findChrome() {
  const candidates = [
    Reflect.get(process.env, "D3_BROWSER_ASSURANCE_CHROME_PATH"),
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
  throw new Error("A local Chrome binary is required; set D3_BROWSER_ASSURANCE_CHROME_PATH");
}

const server = await startD3BrowserAssuranceServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await findChrome(), headless: true });
  const page = await browser.newPage();
  await page.goto(server.origin);
  const record = page.getByRole("button", { name: "Record submission status", exact: true });
  await record.waitFor();
  await record.focus();
  await record.press("Enter");

  const confirmation = page.getByRole("region", { name: "Confirm the submission status" });
  await confirmation.waitFor();
  assert.match(await confirmation.textContent(), /I submitted it/);
  let calls = await page.evaluate(() => window.readD3AssuranceCalls());
  const manual = calls.find((call) => call.url.endsWith("/manual-submissions"));
  assert.deepEqual(manual?.body, { expectedRevision: 3 });
  assert.match(manual?.idempotencyKey ?? "", /^web-manual-submission-3-/);

  await page.addScriptTag({ content: axe.source });
  const before = await page.evaluate(async () => (await window.axe.run(document)).violations);
  assert.deepEqual(
    before.map((violation) => violation.id),
    [],
  );

  await page.getByRole("button", { name: "I submitted it", exact: true }).press("Enter");
  await page.getByText("Submitted and confirmed.", { exact: true }).waitFor();
  calls = await page.evaluate(() => window.readD3AssuranceCalls());
  const reconciliation = calls.find((call) => call.url.endsWith("/reconciliation"));
  assert.equal(reconciliation?.body.kind, "user_attested_submitted");
  assert(!calls.some((call) => call.url.includes("/submissions") && !call.url.includes("manual")));

  const after = await page.evaluate(async () => (await window.axe.run(document)).violations);
  assert.deepEqual(
    after.map((violation) => violation.id),
    [],
  );
  process.stdout.write("PASS manual-start/candidate-attestation/keyboard/WCAG scenario\n");
} finally {
  await browser?.close();
  await server.close();
}
