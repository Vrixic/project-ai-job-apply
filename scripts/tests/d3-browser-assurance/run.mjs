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
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(server.origin);
  assert.equal(
    await page.evaluate(
      (popupOrigin) =>
        new Promise((resolve) => {
          let popup;
          const receive = (event) => {
            if (
              event.origin !== popupOrigin ||
              event.source !== popup ||
              event.data !== "synthetic-popup-ready"
            )
              return;
            clearTimeout(timer);
            window.removeEventListener("message", receive);
            resolve(true);
          };
          const timer = setTimeout(() => {
            window.removeEventListener("message", receive);
            popup?.close();
            resolve(false);
          }, 3000);
          window.addEventListener("message", receive);
          popup = window.open(
            popupOrigin,
            "synthetic-popup-proof",
            "popup=yes,width=400,height=400",
          );
        }),
      server.popupOrigin,
    ),
    true,
  );
  await page.getByRole("button", { name: "Search", exact: true }).press("Enter");
  await page.getByRole("button", { name: "View details and sources", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Prepare application", exact: true }).press("Enter");
  const approve = page.getByRole("button", { name: "Approve this packet", exact: true });
  await approve.waitFor();
  assert.equal(await approve.isEnabled(), false);
  await page.getByRole("checkbox", { name: "I reviewed contact.email", exact: true }).check();
  await approve.press("Enter");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("input")].some(
      (input) => input.readOnly && input.value.includes("/jobs?application="),
    ),
  );
  const handoffLink = new URL(
    await page.getByLabel("Application review link", { exact: true }).inputValue(),
  );
  assert.equal(handoffLink.origin, server.origin);
  assert.deepEqual([...handoffLink.searchParams.keys()], ["application", "job"]);
  assert.equal(handoffLink.searchParams.get("application"), "00000000-0000-7000-8000-000000000001");
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
  await page.evaluate(() => window.showD3CoverLetterPreparation());
  await page
    .getByRole("checkbox", {
      name: "Prepare a cover letter with OpenAI using these terms",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Prepare resume and cover letter", exact: true })
    .press("Enter");
  await page.getByText("Preparing your resume and cover letter.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Approve this packet", exact: true }).count(),
    0,
  );
  await page
    .getByText(
      "Preparation finished. Review the current packet and its exact generated materials before approving.",
      { exact: true },
    )
    .waitFor();
  calls = await page.evaluate(() => window.readD3AssuranceCalls());
  const preparationCommands = calls.filter((call) => call.url.endsWith("/packets"));
  assert.equal(preparationCommands.length, 1);
  assert.deepEqual(preparationCommands[0]?.body.coverLetter, {
    disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
  });
  assert.equal(calls.filter((call) => call.url.includes("/preparations/")).length, 2);
  assert.equal(
    await page.getByRole("button", { name: "Approve this packet", exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Prepare a cover letter with OpenAI using these terms",
        exact: true,
      })
      .isChecked(),
    false,
  );
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  const preparationA11y = await page.evaluate(
    async () => (await window.axe.run(document)).violations,
  );
  assert.deepEqual(
    preparationA11y.map((violation) => violation.id),
    [],
  );
  await page.clock.install();
  await page.evaluate(() => window.showD3NativeJourney());
  await page.getByRole("button", { name: "Search", exact: true }).press("Enter");
  await page.getByRole("button", { name: "View details and sources", exact: true }).press("Enter");
  await page
    .getByRole("checkbox", {
      name: "Prepare a cover letter with OpenAI using these terms",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Prepare resume and cover letter", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .press("Enter");
  await page.getByText("Native synthetic resume preview", { exact: true }).waitFor();
  await page.getByText("Native synthetic grounded cover letter", { exact: true }).waitFor();
  await page.clock.fastForward(600_001);
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .waitFor();
  assert.equal(await page.getByText("Native synthetic resume preview", { exact: true }).count(), 0);
  assert.equal(await approve.isEnabled(), false);
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .press("Enter");
  await page.getByText("Native synthetic grounded cover letter", { exact: true }).waitFor();

  await page.getByRole("checkbox", { name: "I reviewed contact.email", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "I reviewed this generated resume.", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "I reviewed this generated cover letter.", exact: true })
    .check();
  assert.equal(await approve.isEnabled(), true);
  const signedOutTab = await page.context().newPage();
  try {
    await signedOutTab.goto(server.origin);
    await signedOutTab.evaluate(() => window.showD3SignedOut());
    await page
      .getByRole("button", { name: "Sign in to view generated materials", exact: true })
      .waitFor();
    assert.equal(await approve.isEnabled(), false);
    assert.equal(
      await page.getByText("Native synthetic resume preview", { exact: true }).count(),
      0,
    );
  } finally {
    await signedOutTab.close();
  }
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .press("Enter");
  await page.getByText("Native synthetic grounded cover letter", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Disconnect material access", exact: true })
    .press("Enter");
  assert.equal(await approve.isEnabled(), false);
  assert.equal(await page.getByText("Native synthetic resume preview", { exact: true }).count(), 0);
  await page
    .getByRole("button", { name: "Sign in to view generated materials", exact: true })
    .press("Enter");
  await page.getByText("Native synthetic grounded cover letter", { exact: true }).waitFor();
  await approve.press("Enter");
  for (const kind of ["resume", "cover letter"]) {
    for (const [label, extension] of [
      ["PDF", "pdf"],
      ["Word (DOCX)", "docx"],
    ]) {
      const waiting = page.waitForEvent("download");
      await page
        .getByRole("button", { name: `Download ${kind} ${label}`, exact: true })
        .press("Enter");
      const download = await waiting;
      assert.equal(
        download.suggestedFilename(),
        `${kind === "resume" ? "tailored-resume" : "cover-letter"}.${extension}`,
      );
      assert.equal(await download.failure(), null);
      await download.delete();
    }
  }
  const nativeA11y = await page.evaluate(async () => (await window.axe.run(document)).violations);
  for (const label of ["PDF", "Word"]) {
    await page
      .getByRole("button", { name: `Send approved ${label} files to extension`, exact: true })
      .press("Enter");
    await page
      .getByText(
        "Approved files reached the selected extension tab. No application has been submitted.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Withdraw extension file transfer", exact: true })
      .press("Enter");
  }
  assert.deepEqual(await page.evaluate(() => window.readD3TransferCalls()), [
    "application-native-transfer-begin.v1",
    "application-native-transfer-commit.v1",
    "application-native-transfer-discard.v1",
    "application-native-transfer-begin.v1",
    "application-native-transfer-commit.v1",
    "application-native-transfer-discard.v1",
  ]);
  assert.deepEqual(
    nativeA11y.map((violation) => violation.id),
    [],
  );
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.getByRole("button", { name: "Record submission status", exact: true }).press("Enter");
  await page.getByRole("button", { name: "I submitted it", exact: true }).press("Enter");
  await page.getByText("Submitted and confirmed.", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Native synthetic grounded cover letter", { exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "Applied", exact: true }).click();
  await page.getByText("Submission confirmed by you.", { exact: true }).waitFor();
  calls = await page.evaluate(() => window.readD3AssuranceCalls());
  assert.equal(
    calls.filter((call) => call.url.startsWith("https://") && call.url.includes("/file?")).length,
    8,
  );
  process.stdout.write(
    "PASS search/prepare/review/approve/manual-Apply/candidate-confirmation/history/idle-preview-expiry/explicit-cover-letter-preparation/native-resume-cover-review/disconnect/four-approved-downloads/two-format-file-transfer-withdrawal/keyboard/WCAG (simulated authentication, BFF, native service and Chrome receiver; no installed-extension acceptance, live generation or external submission)\n",
  );
} catch (error) {
  // This harness contains generated fixtures only; report visible failure state for diagnosis.
  if (page) process.stderr.write(`${await page.locator("body").innerText()}\n`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
