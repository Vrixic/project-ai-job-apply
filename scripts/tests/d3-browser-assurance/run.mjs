import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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

// Optional visual evidence for the owner: D3_SCREENSHOT_DIR=<folder> writes one PNG per state.
const screenshotDirectory = Reflect.get(process.env, "D3_SCREENSHOT_DIR");
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const shot = async (page, name) => {
  if (screenshotDirectory)
    await page.screenshot({ path: resolve(screenshotDirectory, `${name}.png`), fullPage: true });
};

const REMOVED_COPY = [
  "Sign in to view generated materials",
  "Disconnect material access",
  "Approve this packet",
  "I reviewed this generated",
  "Cancel application",
  "Replace the current preparation",
  "Check generated resume",
  "may still be preparing",
  "Edit again",
  "Word (DOCX)",
];
const EMPLOYER = "https://boards.example.test/jobs/1";

const server = await startD3BrowserAssuranceServer();
let browser;
let page;
try {
  browser = await chromium.launch({ executablePath: await findChrome(), headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1000, height: 900 },
  });
  // The employer's page is a local stub: no request ever leaves this machine.
  const external = [];
  await context.route(/^https:\/\/(?:boards|employer)\.example\.test\//u, async (route) => {
    external.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/html", "cache-control": "no-store" },
      body: "<!doctype html><title>Synthetic employer</title><p>Synthetic employer application page</p>",
    });
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const noRemovedCopy = async (label) => {
    const text = await page.locator("body").innerText();
    for (const removed of REMOVED_COPY)
      assert.equal(text.includes(removed), false, `${label}: ${removed}`);
  };
  const a11y = async (label) => {
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(
      async () =>
        (await window.axe.run(document, { rules: { "color-contrast": { enabled: false } } }))
          .violations,
    );
    assert.deepEqual(
      violations.map((violation) => violation.id),
      [],
      `${label}: ${JSON.stringify(violations.map((v) => v.nodes.map((n) => n.target)))}`,
    );
  };
  const storage = async (label) =>
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, label);
  const openJob = async () => {
    await page.getByRole("button", { name: "Search", exact: true }).press("Enter");
    await page
      .getByRole("button", { name: "View details and sources", exact: true })
      .press("Enter");
    await page.getByRole("button", { name: "Generate resume", exact: true }).waitFor();
  };
  const callsOf = () => page.evaluate(() => window.readD3AssuranceCalls());
  const messagesOf = () => page.evaluate(() => window.readD3ExtensionMessages());

  // ---- 1. Generate, loading, ready, Apply with the generated PDF, extension hand-off.
  await page.clock.install();
  await page.goto(server.origin);
  await page.evaluate(() => window.showD3ApplyJourney("ready", 2));
  await openJob();
  await noRemovedCopy("idle");
  assert.equal(await page.getByRole("button", { name: "Apply", exact: true }).isEnabled(), true);
  await shot(page, "01-idle-generate-or-apply");
  await a11y("idle");

  await page.getByRole("button", { name: "Generate resume", exact: true }).press("Enter");
  const loading = page.getByRole("status").filter({ hasText: "Generating your resume" });
  await loading.waitFor();
  assert.match(await loading.innerText(), /usually takes 1 to 2 minutes/u);
  assert.match(await loading.innerText(), /updates by itself/u);
  assert.equal(
    await page.getByRole("button", { name: /Check (?:generated|preparation)/u }).count(),
    0,
  );
  await noRemovedCopy("loading");
  await shot(page, "02-generating");
  await a11y("loading");
  await page.clock.runFor(3100);
  await page.getByText("Generating your resume", { exact: false }).first().waitFor();
  await page.clock.runFor(3100);
  await page.getByText("Built the billing service", { exact: true }).waitFor();
  assert.equal(await page.getByText("Generating your resume").count(), 0);
  assert.equal(await page.getByText("(Moved up)", { exact: true }).count(), 1);
  assert.equal(await page.getByText("(Left out for this job)", { exact: true }).count(), 1);
  assert.match(
    await page.locator("body").innerText(),
    /deleted 30 minutes after it was made, in about 30 min/u,
  );
  await noRemovedCopy("ready");
  await shot(page, "03-ready-preview");
  await a11y("ready");

  const waitingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).press("Enter");
  const download = await waitingDownload;
  assert.equal(download.suggestedFilename(), "tailored-resume.pdf");
  assert.equal(await download.failure(), null);
  await download.delete();
  assert.equal(await page.getByRole("button", { name: /Word|DOCX/u }).count(), 0);

  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
  const employer = await opened;
  await employer.waitForURL(EMPLOYER);
  assert.equal(await employer.evaluate(() => window.opener), null);
  await page.getByText("Open the ApplyDash extension", { exact: false }).waitFor();
  await shot(page, "04-apply-waiting-for-extension");
  let calls = await callsOf();
  const approval = calls.find((call) => call.url.endsWith("/approval"));
  assert.deepEqual(approval?.body.acknowledgedFieldKeys, ["documents.resume"]);
  assert.equal(calls.filter((call) => call.url.endsWith("/packets")).length, 1);
  assert.equal(
    calls.some((call) => /location|authorization|signin|token/iu.test(call.url)),
    false,
  );
  let messages = await messagesOf();
  const intent = messages.find((message) => message.schema === "application-apply-intent.v1");
  assert.deepEqual(intent?.keys, ["applicationId", "jobId", "packetHash", "packetId", "schema"]);
  assert.equal(
    new URL(page.url()).pathname + new URL(page.url()).search,
    "/jobs?application=00000000-0000-7000-8000-000000000001&job=00000000-0000-7000-8000-000000000002",
  );
  // The candidate opens the extension on the employer page; the next retry delivers the PDF.
  await page.evaluate(() => window.setD3ExtensionSelected(true));
  await page.clock.runFor(2100);
  await page.waitForFunction(() =>
    window
      .readD3ExtensionMessages()
      .some((message) => message.schema === "application-native-transfer-commit.v1"),
  );
  messages = await messagesOf();
  assert.deepEqual(
    [...new Set(messages.map((message) => message.schema))],
    [
      "application-apply-intent.v1",
      "application-native-transfer-begin.v1",
      "application-native-transfer-commit.v1",
    ],
  );
  await shot(page, "05-resume-sent-to-extension");
  await a11y("apply");
  await storage("generated journey");

  // The outcome dialog opened by itself when Apply sent the candidate to the employer's page.
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "I submitted it", exact: true }).press("Enter");
  await page.getByText("Submitted and confirmed.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Applied", exact: true }).click();
  await page.getByText("Submission confirmed by you.", { exact: true }).waitFor();
  await employer.close();

  // ---- 2. The generated resume expires: shown clearly, regenerated in one click.
  await page.evaluate(() => window.showD3ApplyJourney("ready", 2));
  await openJob();
  await page.getByRole("button", { name: "Generate resume", exact: true }).press("Enter");
  await page.clock.runFor(3100);
  await page.clock.runFor(3100);
  await page.getByText("Built the billing service", { exact: true }).waitFor();
  await page.clock.runFor(1_800_001);
  await page.getByText("expired and was deleted", { exact: false }).waitFor();
  assert.equal(await page.getByText("Built the billing service", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Generate again", exact: true }).count(), 1);
  assert.match(await page.locator("body").innerText(), /Apply will use your own uploaded resume/u);
  await shot(page, "06-expired");
  await a11y("expired");
  // Applying now falls back to the uploaded resume and never attaches the expired file.
  const fallbackTab = context.waitForEvent("page");
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
  const fallback = await fallbackTab;
  await fallback.waitForURL(EMPLOYER);
  await page.getByText("Finish on the employer's page", { exact: true }).waitFor();
  calls = await callsOf();
  assert.deepEqual(
    calls.filter((call) => call.url.endsWith("/packets")).at(-1)?.body.resume,
    "uploaded",
  );
  messages = await messagesOf();
  // Leaving the previous workspace may withdraw its earlier hand-off; no file is sent for this one.
  assert.equal(
    messages.some((message) => /transfer-(?:begin|commit)/u.test(message.schema)),
    false,
    JSON.stringify(messages),
  );
  await fallback.close();

  // ---- 3. A failed generation says so clearly and offers a retry.
  await page.evaluate(() => window.showD3ApplyJourney("failed", 1));
  await openJob();
  await page.getByRole("button", { name: "Generate resume", exact: true }).press("Enter");
  await page.clock.runFor(3100);
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "could not generate your resume this time" });
  await alert.waitFor();
  assert.equal(await page.getByRole("button", { name: "Try again", exact: true }).count(), 1);
  await noRemovedCopy("failed");
  await shot(page, "07-failed");
  await a11y("failed");

  // ---- 4. Apply directly with the uploaded resume, with no generation at all.
  await page.evaluate(() => window.showD3ApplyJourney("ready", 2));
  await openJob();
  const directTab = context.waitForEvent("page");
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
  const direct = await directTab;
  await direct.waitForURL(EMPLOYER);
  await page.getByText("Finish on the employer's page", { exact: true }).waitFor();
  calls = await callsOf();
  assert.deepEqual(
    calls.filter((call) => call.url.endsWith("/packets")).map((call) => call.body),
    [{ expectedRevision: 2, resume: "uploaded" }],
  );
  assert.deepEqual(
    calls.find((call) => call.url.endsWith("/approval"))?.body.acknowledgedFieldKeys,
    ["documents.resume"],
  );
  await page.getByText("It will use your uploaded resume", { exact: false }).waitFor();
  await shot(page, "08-applied-directly");
  await a11y("direct apply");
  await direct.close();
  await storage("direct journey");

  // ---- 5. No extension answers: the manual path remains, and the candidate is told plainly.
  await page.evaluate(() => {
    window.showD3ApplyJourney("ready", 2);
    window.setD3ExtensionAnswers(false);
  });
  await openJob();
  const manualTab = context.waitForEvent("page");
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
  await (await manualTab).close();
  await page.getByText("The extension did not answer", { exact: false }).waitFor();

  // ---- 6. The optional cover letter keeps its own explicit flow, with no approval ceremony.
  await page.evaluate(() => window.showD3CoverLetterPreparation());
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await shot(page, "09-cover-letter-step");
  await page.getByRole("button", { name: "Generate cover letter", exact: true }).press("Enter");
  await page.getByText("Preparing your resume and cover letter.", { exact: true }).waitFor();
  await page.clock.runFor(2100);
  await page.clock.runFor(2100);
  await page.getByText("Native synthetic grounded cover letter", { exact: true }).waitFor();
  calls = await callsOf();
  const preparationCommands = calls.filter((call) => call.url.endsWith("/packets"));
  assert.equal(preparationCommands.length, 1);
  assert.deepEqual(preparationCommands[0]?.body.coverLetter, {
    disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
  });
  await noRemovedCopy("cover letter");
  await a11y("cover letter");
  await storage("cover letter journey");

  // ---- 7. Signing out in another tab withdraws what this page holds for the extension.
  await page.evaluate(() => window.showD3ApplyJourney("ready", 2));
  await openJob();
  await page.getByRole("button", { name: "Generate resume", exact: true }).press("Enter");
  await page.clock.runFor(3100);
  await page.clock.runFor(3100);
  await page.getByText("Built the billing service", { exact: true }).waitFor();
  const waitingTab = context.waitForEvent("page");
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter");
  await (await waitingTab).close();
  await page.getByText("Open the ApplyDash extension", { exact: false }).waitFor();
  const signedOutTab = await context.newPage();
  try {
    await signedOutTab.goto(server.origin);
    await signedOutTab.evaluate(() => window.showD3SignedOut());
    await page.waitForFunction(
      () => !document.body.innerText.includes("Open the ApplyDash extension"),
    );
  } finally {
    await signedOutTab.close();
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(
    [...new Set(external)],
    [EMPLOYER],
    "only the stubbed employer page may be opened, and only by the candidate's click",
  );
  process.stdout.write(
    "PASS generate -> honest loading -> ready PDF preview/download -> Apply -> employer tab + extension hand-off; expiry -> uploaded fallback; failure/retry; direct Apply; no-extension manual path; cover letter; sign-out withdrawal; keyboard/WCAG (simulated authentication, BFF, native process and Chrome receiver; no installed-extension acceptance, live generation or employer submission)\n",
  );
} catch (error) {
  // This harness contains generated fixtures only; report visible failure state for diagnosis.
  if (page) process.stderr.write(`${await page.locator("body").innerText()}\n`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
