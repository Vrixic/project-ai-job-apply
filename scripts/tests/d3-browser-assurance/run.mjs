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
let page;
try {
  browser = await chromium.launch({ executablePath: await findChrome(), headless: true });
  page = await browser.newPage();
  await page.goto(server.origin);
  await page.getByRole("button", { name: "Search", exact: true }).press("Enter");
  await page.getByRole("button", { name: "View details and sources", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Prepare application", exact: true }).press("Enter");
  const approve = page.getByRole("button", { name: "Approve this packet", exact: true });
  await approve.waitFor();
  assert.equal(await approve.isEnabled(), false);
  await page.getByRole("checkbox", { name: "I reviewed contact.email", exact: true }).check();
  await approve.press("Enter");
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
  if (before.length)
    process.stderr.write(
      `${JSON.stringify(
        before.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
        null,
        2,
      )}\n`,
    );
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
  const approval = calls.find((call) => call.url.endsWith("/approval"));
  assert.deepEqual(approval?.body.acknowledgedFieldKeys, ["contact.email"]);
  assert.equal(calls.filter((call) => call.url === "/api/platform/applications").length, 1);
  await page.getByRole("tab", { name: "Applied", exact: true }).click();
  await page.getByText("Submission confirmed by you.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);

  const after = await page.evaluate(async () => (await window.axe.run(document)).violations);
  assert.deepEqual(
    after.map((violation) => violation.id),
    [],
  );
  await page.evaluate(() => window.showD3ExpiryPreview());
  await page.getByText("Generated synthetic one-off preview", { exact: true }).waitFor();
  await page
    .getByText("Your generated resume expired. Prepare again to review a new version.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByText("Generated synthetic one-off preview", { exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  process.stdout.write(
    "PASS search/prepare/review/approve/manual-Apply/candidate-confirmation/history/idle-preview-expiry/keyboard/WCAG (simulated BFF and native preview, no live generation or external submission)\n",
  );
} catch (error) {
  // This harness contains generated fixtures only; report visible failure state for diagnosis.
  if (page) process.stderr.write(`${await page.locator("body").innerText()}\n`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
