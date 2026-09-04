import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../../..");
const output = join(root, "frontend", "extension", "dist");
const requiredPermissions = [
  "activeTab",
  "alarms",
  "identity",
  "scripting",
  "sidePanel",
  "storage",
];
const forbiddenPermissions = new Set([
  "bookmarks",
  "browsingData",
  "clipboardRead",
  "cookies",
  "debugger",
  "declarativeNetRequest",
  "downloads",
  "geolocation",
  "history",
  "management",
  "nativeMessaging",
  "notifications",
  "proxy",
  "tabs",
  "topSites",
  "webNavigation",
  "webRequest",
  "webRequestBlocking",
]);

function fail(message) {
  throw new Error(`D2 extension assurance failed: ${message}`);
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
    else fail(`non-regular output entry ${relative(output, path)}`);
  }
  return result;
}

const manifestPath = join(output, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!/^0\.2\.\d+$/u.test(manifest.version ?? "")) fail("release version is not a D2 version");
if (JSON.stringify(manifest.permissions) !== JSON.stringify(requiredPermissions)) {
  fail("permission inventory differs from the reviewed minimum");
}
for (const permission of manifest.permissions) {
  if (forbiddenPermissions.has(permission)) fail(`forbidden permission ${permission}`);
}
if (manifest.content_scripts !== undefined) fail("persistent content scripts are forbidden");
if (manifest.externally_connectable !== undefined)
  fail("external extension messaging is forbidden");
if (manifest.web_accessible_resources !== undefined)
  fail("web-accessible resources are not required");
if (manifest.update_url !== undefined) fail("an unreviewed update URL is present");
if (manifest.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'self'") {
  fail("extension CSP differs from the self-only policy");
}
if (
  manifest.background?.service_worker !== "background.js" ||
  manifest.background?.type !== "module"
) {
  fail("background worker boundary is invalid");
}
if (manifest.side_panel?.default_path !== "sidepanel.html") fail("side panel is missing");
const expectedIcons = {
  16: "icon-16.png",
  32: "icon-32.png",
  48: "icon-48.png",
  128: "icon-128.png",
};
if (
  JSON.stringify(manifest.icons) !== JSON.stringify(expectedIcons) ||
  JSON.stringify(manifest.action?.default_icon) !== JSON.stringify(expectedIcons)
) {
  fail("manifest and toolbar icon mappings differ from the reviewed four-size set");
}

const providerHosts = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.ashbyhq.com",
]);
for (const pattern of manifest.host_permissions ?? []) {
  if (pattern === "<all_urls>" || pattern.includes("*://") || pattern.startsWith("http://")) {
    fail("broad or insecure host permission is present");
  }
  const match = /^https:\/\/([^/*]+)\/\*$/u.exec(pattern);
  if (!match) fail("host permission is not one exact HTTPS host");
  if (providerHosts.has(match[1].toLowerCase())) {
    fail("provider page access must come only from explicit activeTab activation");
  }
}

const outputFiles = await files(output);
const allowedNames = new Set([
  "background.js",
  "icon-128.png",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "sidepanel.html",
]);
for (const path of outputFiles) {
  const name = relative(output, path).replaceAll("\\", "/");
  if (!allowedNames.has(name)) fail(`unexpected output file ${name}`);
  const metadata = await stat(path);
  if (metadata.size > 256 * 1024) fail(`oversized output file ${name}`);
  if (extname(path) === ".map") fail(`source map ${name}`);
}
for (const name of allowedNames) {
  if (!outputFiles.some((path) => relative(output, path).replaceAll("\\", "/") === name)) {
    fail(`required output file ${name} is missing`);
  }
}

const popupHtml = await readFile(join(output, "popup.html"), "utf8");
const sidePanelHtml = await readFile(join(output, "sidepanel.html"), "utf8");
if (!popupHtml.includes('data-extension-surface="popup"')) {
  fail("popup output is missing its fixed-width surface marker");
}
if (
  !sidePanelHtml.includes('data-extension-surface="side-panel"') ||
  sidePanelHtml.includes('data-extension-surface="popup"')
) {
  fail("side-panel output is missing its responsive surface marker");
}

const textOutputs = await Promise.all(
  outputFiles
    .filter((path) => [".js", ".html", ".json"].includes(extname(path)))
    .map(async (path) => ({ name: relative(output, path), text: await readFile(path, "utf8") })),
);
for (const { name, text } of textOutputs) {
  if (/\beval\s*\(|\bnew\s+Function\s*\(/u.test(text)) fail(`remote-code primitive in ${name}`);
  if (name.endsWith(".html")) {
    const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];
    if (
      scripts.length !== 1 ||
      !/\bsrc="popup\.js"/u.test(scripts[0][1]) ||
      !/\btype="module"/u.test(scripts[0][1]) ||
      scripts[0][2].trim() !== ""
    ) {
      fail(`HTML script boundary differs from the one local module in ${name}`);
    }
  }
  if (/client[_-]?secret|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/iu.test(text)) {
    fail(`credential-like material in ${name}`);
  }
}
const background = await readFile(join(output, "background.js"), "utf8");
if (!background.includes("d2-synthetic-default-dark-v1")) {
  fail("default-dark capability revision marker is missing");
}

process.stdout.write(
  `${JSON.stringify({
    profile: "d2_extension_release_source_v1",
    manifestVersion: manifest.manifest_version,
    permissions: manifest.permissions.length,
    hostPermissions: (manifest.host_permissions ?? []).length,
    outputFiles: outputFiles.length,
    persistentContentScripts: 0,
    providerHostPermissions: 0,
    defaultDarkMarker: true,
  })}\n`,
);
