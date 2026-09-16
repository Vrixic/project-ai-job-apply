import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import axe from "axe-core";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../../..");
const extension = process.env.D2_EXTENSION_DIST
  ? resolve(process.env.D2_EXTENSION_DIST)
  : join(root, "frontend", "extension", "dist");
const builtManifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
const inferredUiMode =
  builtManifest.name === "ApplyDash Job Capture (Development)"
    ? "development"
    : builtManifest.name === "ApplyDash Job Capture (Default Dark)"
      ? "product"
      : undefined;
if (!inferredUiMode) throw new Error("Unknown D2 extension artifact mode");
const uiMode = process.env.D2_EXTENSION_UI_MODE || inferredUiMode;
if (!["product", "development"].includes(uiMode)) throw new Error("Invalid D2 extension UI mode");
if (uiMode !== inferredUiMode)
  throw new Error("D2 extension artifact does not match requested UI mode");
const developmentUi = uiMode === "development";
for (const surface of ["popup", "sidepanel"]) {
  const html = await readFile(join(extension, `${surface}.html`), "utf8");
  for (const id of ["queue-panel", "contributions-panel", "appeal-form"]) {
    assert(
      html.includes(`id="${id}"`) === developmentUi,
      `${surface} ${id} violates ${uiMode} output boundary`,
    );
  }
  if (!developmentUi) {
    assert(!/Your shared jobs|Delivery queue/u.test(html), `${surface} includes diagnostic copy`);
  }
}
const fixture = await readFile(
  join(import.meta.dirname, "fixtures", "provider-pages.html"),
  "utf8",
);
const executable =
  process.env.D2_EXTENSION_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserName = process.env.D2_EXTENSION_BROWSER_NAME || "edge";
const profile = await mkdtemp(join(tmpdir(), "applydash-extension-assurance-"));
const server = createServer((request, response) => {
  if (request.url?.startsWith("/synthetic/")) {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(fixture);
  } else {
    response.writeHead(404);
    response.end();
  }
});

function fail(message) {
  throw new Error(`D2 installed-browser assurance failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function openAssurancePopup(context, extensionId, scenario, surface = "popup") {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/${surface}.html?assurance=${scenario}`);
  await popup.waitForFunction(
    () => document.querySelector("#auth-status")?.textContent !== "Checking…",
  );
  return popup;
}

async function inspectSyntheticCapture(popup) {
  const inspect = popup.locator("#inspect");
  await inspect.focus();
  await inspect.press("Enter");
  await popup.locator("#preview:not([hidden])").waitFor();
}

async function keyboardFocusGeometry(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const width = Number.parseFloat(style.outlineWidth);
    const extent = width + Number.parseFloat(style.outlineOffset);
    const ring = {
      left: rect.left - extent,
      right: rect.right + extent,
      top: rect.top - extent,
      bottom: rect.bottom + extent,
    };
    let clipped = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      const clipsX = /^(clip|hidden|scroll|auto)$/u.test(parentStyle.overflowX);
      const clipsY = /^(clip|hidden|scroll|auto)$/u.test(parentStyle.overflowY);
      if (
        (clipsX && (ring.left < bounds.left - 0.5 || ring.right > bounds.right + 0.5)) ||
        (clipsY && (ring.top < bounds.top - 0.5 || ring.bottom > bounds.bottom + 0.5))
      )
        clipped = true;
    }
    return {
      focused: document.activeElement === element && element.matches(":focus-visible"),
      outlined: style.outlineStyle !== "none" && width > 0,
      clipped,
      ring,
      inViewport:
        ring.left >= -0.5 &&
        ring.right <= innerWidth + 0.5 &&
        ring.top >= -0.5 &&
        ring.bottom <= innerHeight + 0.5,
    };
  });
}

async function assertSequentialHistoryAccess(context, extensionId, surface) {
  const page = await openAssurancePopup(context, extensionId, "configured-long", surface);
  await page.setViewportSize({ width: surface === "popup" ? 448 : 320, height: 600 });
  assert(await page.locator("#preview").isHidden(), `${surface} keyboard fixture has a preview`);
  // Establish the user's reported starting point only; every subsequent focus move uses Tab.
  await page.locator("#inspect").focus();
  const expectVisibleFocus = async (selector) => {
    const focus = await keyboardFocusGeometry(page, selector);
    assert(focus.focused, `${surface} sequential keyboard focus did not reach ${selector}`);
    assert(focus.outlined, `${surface} ${selector} lacks a visible focus outline`);
    assert(!focus.clipped, `${surface} ${selector} focus outline is clipped by an ancestor`);
    assert(
      focus.inViewport,
      `${surface} ${selector} focus outline is outside the viewport ${JSON.stringify(focus.ring)}`,
    );
  };
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#queue-panel > summary");
  // Reproduce the former external ring inside the overflow-clipped card in this page only.
  const oldStyle = await page.addStyleTag({
    content: ".disclosure > summary:focus-visible { outline-offset: 2px !important; }",
  });
  assert(
    (await keyboardFocusGeometry(page, "#queue-panel > summary")).clipped,
    `${surface} focus geometry misses the former clipped-outline regression`,
  );
  await oldStyle.evaluate((element) => element.remove());
  await expectVisibleFocus("#queue-panel > summary");
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#contributions-panel > summary");
  const panel = page.locator("#contributions-panel");
  assert(!(await panel.evaluate((element) => element.open)), `${surface} history starts expanded`);
  await page.keyboard.press("Enter");
  assert(await panel.evaluate((element) => element.open), `${surface} Enter cannot expand history`);
  await page.keyboard.press("Space");
  assert(
    !(await panel.evaluate((element) => element.open)),
    `${surface} Space cannot collapse history`,
  );
  await page.keyboard.press("Space");
  assert(await panel.evaluate((element) => element.open), `${surface} Space cannot expand history`);
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#refresh-shared-jobs");
  // Returning through the same native order must not trap or skip either summary.
  await page.keyboard.press("Shift+Tab");
  await expectVisibleFocus("#contributions-panel > summary");
  await page.keyboard.press("Shift+Tab");
  await expectVisibleFocus("#queue-panel > summary");
  await page.keyboard.press("Shift+Tab");
  await expectVisibleFocus("#inspect");
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#queue-panel > summary");
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#contributions-panel > summary");
  await page.keyboard.press("Tab");
  await expectVisibleFocus("#refresh-shared-jobs");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#contributions-status")?.textContent === "No shared jobs",
  );
  await page.close();
}

async function inspectLayout(popup, width, zoom = 1) {
  await popup.setViewportSize({ width, height: 900 });
  await popup.evaluate((nextZoom) => {
    // CSS zoom does not reduce the layout viewport the way browser page zoom does. Constrain the
    // root to the equivalent CSS-pixel viewport so this exercises real 200% reflow geometry.
    document.documentElement.style.width = nextZoom === 1 ? "" : `${100 / nextZoom}%`;
    document.documentElement.style.zoom = String(nextZoom);
    window.scrollTo(0, 0);
  }, zoom);
  await popup.locator("#preview:not([hidden])").waitFor();
  return popup.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
    };
    const intersects = (left, right) =>
      left.left < right.right - 0.5 &&
      left.right > right.left + 0.5 &&
      left.top < right.bottom - 0.5 &&
      left.bottom > right.top + 0.5;
    const overlappingFieldRows = [...document.querySelectorAll(".field-row")]
      .filter(visible)
      .flatMap((row, index) => {
        const marker = row.querySelector(".required-field, .field-requirement, input[data-field]");
        const label = row.querySelector(".field-label, strong");
        if (!marker || !label || !visible(marker) || !visible(label)) return [];
        return intersects(marker.getBoundingClientRect(), label.getBoundingClientRect())
          ? [index]
          : [];
      });
    const clippedControls = [
      ...document.querySelectorAll(
        "button:not([hidden]), input:not([hidden]), textarea:not([hidden]), details > summary",
      ),
    ]
      .filter(visible)
      .flatMap((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > window.innerWidth + 0.5
          ? [control.id || control.textContent?.trim() || control.tagName]
          : [];
      });
    return {
      clippedControls,
      clientWidth: document.documentElement.clientWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlappingFieldRows,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function assertAxeClean(page, surface) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map((violation) => violation.id).sort();
  });
  assert(violations.length === 0, `${surface} has axe violations: ${violations.join(",")}`);
  return violations.length;
}

await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Synthetic server did not bind");
let context;
let externalRequestsBlocked = 0;
let operationalPolicyRequestsBlocked = 0;
let unexpectedExternalRequests = 0;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol === "chrome-extension:" ||
      (url.hostname === "127.0.0.1" && url.port === String(address.port))
    ) {
      await route.continue();
    } else {
      externalRequestsBlocked += 1;
      if (
        route.request().method() === "GET" &&
        url.pathname === "/v1/extension/contribution-capability-policy"
      ) {
        operationalPolicyRequestsBlocked += 1;
      } else {
        unexpectedExternalRequests += 1;
      }
      await route.abort("blockedbyclient");
    }
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).hostname;
  const manifest = await worker.evaluate(async () => chrome.runtime.getManifest());
  const optionalDenied = await worker.evaluate(
    async () =>
      !(await chrome.permissions.contains({ origins: ["https://boards.greenhouse.io/*"] })),
  );
  const page = await context.newPage();
  for (const provider of ["greenhouse", "lever", "ashby"]) {
    await page.goto(`http://127.0.0.1:${address.port}/synthetic/${provider}`, {
      waitUntil: "domcontentloaded",
    });
  }
  await page.close();

  await context.addInitScript(() => {
    if (location.protocol !== "chrome-extension:") return;
    const scenario = new URLSearchParams(location.search).get("assurance") ?? "unconfigured-long";
    const configured = scenario.startsWith("configured");
    const missing = scenario.endsWith("missing");
    const longDescription = `${"A grounded synthetic responsibility statement. ".repeat(24)}End.`;
    const longUrl = `https://boards.greenhouse.io/synthetic/jobs/12345?${new URLSearchParams({
      department: "platform-engineering-and-reliability-".repeat(8),
      location: "distributed-north-america-".repeat(8),
    })}`;
    const capture = {
      adapterVersion: "d2-job-page-v1",
      capturedAt: "2026-09-03T12:00:00.000Z",
      pageVariant: "greenhouse-board-v1",
      provider: "greenhouse",
      sourceUrl: longUrl,
      title: "Synthetic Principal Platform Engineer With A Deliberately Long Grounded Title",
      ...(missing
        ? {}
        : {
            company: "Synthetic Company",
            description: longDescription,
            externalJobId: "synthetic-12345",
            location: "Distributed · North America",
            workMode: "remote",
          }),
    };
    const status = {
      apiConfigured: configured,
      authenticated: configured,
      configured,
      refreshAvailable: configured,
    };
    const delivery = {
      contribution: {
        ready: configured,
        reason: configured ? "ready" : "identity_configuration_required",
      },
      privateSave: {
        ready: configured,
        reason: configured ? "ready" : "identity_configuration_required",
      },
    };
    const response = async (message) => {
      if (message?.action === "capture") {
        return {
          capture,
          delivery,
          ok: true,
          queue: { blocked: 0, pending: 0, stopped: 0 },
          status,
        };
      }
      return {
        delivery,
        ok: !(message?.action === "enqueue" && scenario.endsWith("rejected")),
        error:
          message?.action === "enqueue" && scenario.endsWith("rejected")
            ? "The request was rejected."
            : undefined,
        deliveryOutcome:
          message?.action === "enqueue"
            ? scenario.endsWith("pending")
              ? "pending"
              : "acknowledged"
            : undefined,
        ownerAction: message?.action === "enqueue" ? "ok" : undefined,
        queue: { blocked: 0, pending: 0, stopped: 0 },
        receipts: [],
        sharedJobsState: message?.action === "shared_jobs_refresh" ? "refreshed" : "cached",
        status,
      };
    };
    Object.defineProperty(chrome.runtime, "sendMessage", {
      configurable: true,
      value: response,
    });
  });

  for (const surface of ["popup", "sidepanel"]) {
    if (developmentUi) await assertSequentialHistoryAccess(context, extensionId, surface);
    for (const [scenario, expected] of [
      ["configured-long", "Job received for review."],
      ["configured-pending", "Job saved on this device, but delivery is not confirmed."],
      ["configured-rejected", "The request was rejected."],
    ]) {
      const productPage = await openAssurancePopup(context, extensionId, scenario, surface);
      for (const selector of ["#queue-panel", "#contributions-panel", "#appeal-form"]) {
        assert(
          (await productPage.locator(selector).count()) === (developmentUi ? 1 : 0),
          `${surface} ${selector} DOM boundary failed`,
        );
      }
      await inspectSyntheticCapture(productPage);
      assert(
        await productPage.locator("#contribute").isEnabled(),
        `${surface} add action disabled`,
      );
      await productPage.locator("#contribute").click();
      await productPage.waitForFunction(
        (text) => document.querySelector("#detail")?.textContent?.includes(text),
        expected,
      );
      await productPage.close();
    }
  }

  const popup = await openAssurancePopup(context, extensionId, "unconfigured-long");
  assert(await popup.locator("#inspect").isEnabled(), "inspection is gated by delivery setup");
  await inspectSyntheticCapture(popup);
  assert(
    (await popup.locator("#save-private").count()) === 0,
    "private-save action is still shown",
  );
  assert(
    await popup.locator("#contribute").isDisabled(),
    "shared-job action is enabled without delivery setup",
  );
  const locationRow = popup.locator('.field-row:has(.field-label:text-is("Location"))');
  const workTypeRow = popup.locator('.field-row:has(.field-label:text-is("Work type"))');
  assert((await locationRow.count()) === 1, "location does not have its own preview row");
  assert((await workTypeRow.count()) === 1, "work type does not have its own preview row");
  assert(
    (await locationRow.locator(".field-value").textContent())?.trim() ===
      "Distributed · North America",
    "location preview value is not preserved independently",
  );
  assert(
    (await workTypeRow.locator(".field-value").textContent())?.trim() === "Remote",
    "work type preview value is not displayed independently",
  );
  const deliveryReadiness = popup.locator("#delivery-readiness");
  assert((await deliveryReadiness.count()) === 1, "delivery readiness status is missing");
  assert(
    (await deliveryReadiness.getAttribute("aria-live")) !== null ||
      (await deliveryReadiness.getAttribute("role")) === "status",
    "delivery readiness is not exposed as an async status",
  );
  assert(
    /add public auth0 settings/iu.test((await deliveryReadiness.textContent()) ?? "") &&
      !((await deliveryReadiness.textContent()) ?? "").includes("undefined"),
    "unconfigured delivery readiness lacks an actionable explanation",
  );

  const selectionSummary = popup.locator("#selection-summary");
  assert((await selectionSummary.count()) === 1, "selection summary is missing");
  assert(
    (await selectionSummary.getAttribute("aria-live")) !== null ||
      (await selectionSummary.getAttribute("role")) === "status",
    "selection changes are not exposed as an async status",
  );
  const initialSelectionSummary = (await selectionSummary.textContent())?.trim();
  const firstOptional = popup.locator("input[data-field]").first();
  await firstOptional.uncheck();
  const changedSelectionSummary = (await selectionSummary.textContent())?.trim();
  assert(
    Boolean(initialSelectionSummary) && initialSelectionSummary !== changedSelectionSummary,
    "selection summary does not update after optional-field removal",
  );

  const expanders = popup.locator("button[data-expand-field]");
  assert((await expanders.count()) >= 2, "long URL and description do not expose expand controls");
  const firstExpander = expanders.first();
  const controlledValueId = await firstExpander.getAttribute("aria-controls");
  assert(Boolean(controlledValueId), "long-value expand control lacks aria-controls");
  assert(
    (await firstExpander.getAttribute("aria-expanded")) === "false",
    "long value is not initially collapsed",
  );
  await firstExpander.focus();
  await firstExpander.press("Enter");
  assert(
    (await firstExpander.getAttribute("aria-expanded")) === "true",
    "long-value expand control is not keyboard operable",
  );
  assert(
    (await popup.locator(`#${controlledValueId}`).count()) === 1,
    "long-value expand control does not reference a value",
  );

  for (const disclosureId of [
    "source-details",
    ...(developmentUi ? ["queue-panel", "contributions-panel"] : []),
  ]) {
    const disclosure = popup.locator(`#${disclosureId}`);
    assert((await disclosure.count()) === 1, `${disclosureId} disclosure is missing`);
    const summary = disclosure.locator(":scope > summary");
    assert((await summary.count()) === 1, `${disclosureId} lacks a semantic summary`);
    await summary.focus();
    await summary.press("Enter");
    assert(
      await disclosure.evaluate((element) => element.open),
      `${disclosureId} is not keyboard operable`,
    );
  }

  const semanticControlFailures = await popup.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
    };
    return [...document.querySelectorAll("button, input, textarea")]
      .filter(visible)
      .flatMap((control) => {
        const labels = "labels" in control ? [...control.labels] : [];
        const name =
          control.getAttribute("aria-label")?.trim() ||
          control.getAttribute("aria-labelledby")?.trim() ||
          labels.map((label) => label.textContent?.trim()).join(" ") ||
          control.textContent?.trim();
        return name ? [] : [control.id || control.tagName];
      });
  });
  assert(semanticControlFailures.length === 0, "visible controls lack semantic names");

  const preferredPopupWidth = await popup.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  );
  assert(preferredPopupWidth >= 448, "the extension popup is not twice the original width");
  const popupAxeViolations = await assertAxeClean(popup, "popup");

  const responsiveSurface = await openAssurancePopup(
    context,
    extensionId,
    "unconfigured-long",
    "sidepanel",
  );
  await inspectSyntheticCapture(responsiveSurface);
  const layoutProfiles = [];
  for (const width of [320, 360, 480]) {
    const result = await inspectLayout(responsiveSurface, width);
    assert(
      !result.horizontalOverflow,
      `${width}px layout has horizontal overflow (${result.scrollWidth}/${result.clientWidth})`,
    );
    assert(result.overlappingFieldRows.length === 0, `${width}px field markers overlap labels`);
    assert(result.clippedControls.length === 0, `${width}px layout clips controls`);
    layoutProfiles.push({ width, zoom: 1 });
  }
  const zoomedLayout = await inspectLayout(responsiveSurface, 640, 2);
  assert(!zoomedLayout.horizontalOverflow, "200% zoom layout has horizontal overflow");
  assert(zoomedLayout.overlappingFieldRows.length === 0, "200% zoom field markers overlap labels");
  assert(zoomedLayout.clippedControls.length === 0, "200% zoom layout clips controls");
  layoutProfiles.push({ width: 640, zoom: 2 });
  const sidePanelAxeViolations = await assertAxeClean(responsiveSurface, "side panel");

  const missingPopup = await openAssurancePopup(context, extensionId, "unconfigured-missing");
  await inspectSyntheticCapture(missingPopup);
  const unavailableFields = missingPopup.locator('[data-field-kind="unavailable"]');
  assert((await unavailableFields.count()) >= 2, "missing grounded fields are not disclosed");
  assert(
    await unavailableFields.evaluateAll((rows) =>
      rows.every((row) => /not detected|unavailable/iu.test(row.textContent ?? "")),
    ),
    "missing grounded fields lack an explicit unavailable state",
  );

  const configuredPopup = await openAssurancePopup(context, extensionId, "configured-long");
  await inspectSyntheticCapture(configuredPopup);
  assert(
    await configuredPopup.locator("#contribute").isEnabled(),
    "ready shared-job action remains disabled",
  );
  assert(
    (await configuredPopup.locator("#contribution-consent").count()) === 0,
    "a redundant contribution-consent checkbox is still shown",
  );

  await configuredPopup.locator("#contribute").focus();
  const focusedControl = await configuredPopup.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.id,
  );
  const focusStyleVisible = await configuredPopup.locator("#contribute").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  });
  assert(focusedControl === "contribute", "keyboard order does not reach shared-job action");
  assert(focusStyleVisible, "keyboard focus indicator is not visible");

  const sensitiveStorageAbsent = await worker.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    const value = JSON.stringify({ local, session });
    return !value.includes("must-never-leave-page") && !value.includes("javascript:alert");
  });
  assert(unexpectedExternalRequests === 0, "the harness observed unexpected external traffic");
  assert(sensitiveStorageAbsent, "synthetic page artifacts were retained in extension storage");

  process.stdout.write(
    `${JSON.stringify({ profile: "d2_extension_installed_synthetic_v5", browserName, uiMode, browserExecuted: true, manifestVersion: manifest.manifest_version, syntheticProviderPages: 3, popupScenarios: 7, sidePanelScenarios: 5, addOutcomeScenarios: 6, diagnosticBoundarySurfaces: 2, sequentialKeyboardSurfaces: developmentUi ? 2 : 0, clippedFocusNegativeControls: developmentUi ? 2 : 0, preferredPopupWidth, layoutProfiles, externalRequestsAllowed: 0, externalRequestsBlocked, operationalPolicyRequestsBlocked, unexpectedExternalRequests, optionalProviderPermissionDenied: optionalDenied, keyboardFocusVisible: focusStyleVisible, semanticControlFailures: semanticControlFailures.length, axeViolations: popupAxeViolations + sidePanelAxeViolations, axeSurfaces: 2, horizontalOverflowProfiles: 0, fieldOverlapProfiles: 0, clippedControlProfiles: 0, longValueExpanders: await expanders.count(), progressiveDisclosures: developmentUi ? 3 : 1, missingFieldStatesValidated: await unavailableFields.count(), separatedLocationAndWorkTypeFields: 2, deliveryStatesValidated: 2, sensitiveArtifactsRetained: !sensitiveStorageAbsent, telemetryRequests: 0 })}\n`,
  );
} finally {
  await context?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
