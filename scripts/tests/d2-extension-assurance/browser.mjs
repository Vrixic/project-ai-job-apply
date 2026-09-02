import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../../..");
const extension = join(root, "frontend", "extension", "dist");
const fixture = await readFile(join(import.meta.dirname, "fixtures", "provider-pages.html"), "utf8");
const executable = process.env.D2_EXTENSION_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "applydash-extension-assurance-"));
const server = createServer((request, response) => {
  if (request.url?.startsWith("/synthetic/")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixture);
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Synthetic server did not bind");
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:" || (url.hostname === "127.0.0.1" && url.port === String(address.port))) await route.continue();
    else await route.abort("blockedbyclient");
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const manifest = await worker.evaluate(async () => chrome.runtime.getManifest());
  const optionalDenied = await worker.evaluate(async () => !(await chrome.permissions.contains({ origins: ["https://boards.greenhouse.io/*"] })));
  const page = await context.newPage();
  for (const provider of ["greenhouse", "lever", "ashby"]) {
    await page.goto(`http://127.0.0.1:${address.port}/synthetic/${provider}`, { waitUntil: "domcontentloaded" });
  }
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.keyboard.press("Tab");
  const focusVisible = await popup.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body);
  await popup.evaluate(() => { document.body.style.zoom = "2"; });
  const horizontalOverflowAt200 = await popup.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const sensitiveStorageAbsent = await worker.evaluate(async () => {
    const local = await chrome.storage.local.get(null); const session = await chrome.storage.session.get(null);
    const value = JSON.stringify({ local, session });
    return !value.includes("must-never-leave-page") && !value.includes("javascript:alert");
  });
  process.stdout.write(`${JSON.stringify({ profile: "d2_extension_installed_synthetic_v1", browserExecuted: true, manifestVersion: manifest.manifest_version, syntheticProviderPages: 3, externalRequestsAllowed: 0, optionalProviderPermissionDenied: optionalDenied, keyboardFocusVisible: focusVisible, horizontalOverflowAt200, sensitiveArtifactsRetained: !sensitiveStorageAbsent, telemetryRequests: 0 })}\n`);
} finally {
  await context?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
