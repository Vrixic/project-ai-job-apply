import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import axe from "axe-core";
import { chromium } from "playwright-core";
import { startD3BrowserAssuranceServer } from "./server.mjs";

const candidates = [
  Reflect.get(process.env, "D3_BROWSER_ASSURANCE_CHROME_PATH"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
].filter(Boolean);
let executablePath;
for (const path of candidates) {
  try {
    await access(path);
    executablePath = path;
    break;
  } catch {}
}
assert(executablePath, "Installed Chrome required");
const server = await startD3BrowserAssuranceServer();
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.origin);
  await page.evaluate(() => window.showD3WithdrawalRecovery("approved"));
  await page.getByRole("button", { name: "Reopen for preparation" }).click();
  await page.getByRole("button", { name: "Prepare a new packet" }).click();
  await page.getByText("candidate@example.test", { exact: true }).waitFor();
  const calls = await page.evaluate(() => window.readD3AssuranceCalls());
  assert.deepEqual(calls.find((call) => call.url.endsWith("/packets")).body, {
    expectedRevision: 4,
  });
  assert.equal(await page.getByRole("link", { name: /Open.*application/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Approve/ }).isDisabled(), true);
  await page.evaluate(() => window.showD3WithdrawalRecovery("takeover"));
  await page.getByRole("button", { name: "I submitted it", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "It was not submitted", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("button", { name: "Prepare a new packet" }).count(), 0);
  await page.getByRole("button", { name: "I submitted it", exact: true }).click();
  await page.getByText("Submitted and confirmed.", { exact: true }).waitFor();
  assert.equal(await page.getByText("candidate@example.test", { exact: true }).count(), 0);
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(() =>
    window.axe.run(document, { rules: { "color-contrast": { enabled: false } } }),
  );
  assert.deepEqual(
    accessibility.violations.map((item) => item.id),
    [],
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS real Chromium withheld approval -> reopen -> fresh preparation/review; withheld manual attempt -> explicit reconciliation -> confirmed metadata. Authentication/API synthetic, no employer effects or live acceptance.",
  );
} finally {
  await browser?.close();
  await server.close();
}
