import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const browserHarness = join(import.meta.dirname, "browser.mjs");

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path));
}

function chromeForTesting() {
  const explicit = process.env.D2_EXTENSION_CHROME_FOR_TESTING;
  if (explicit) return firstExisting([explicit]);
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined);
  if (!base || !existsSync(base)) return undefined;
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, "en", { numeric: true }))
    .map((entry) => join(base, entry.name, "chrome-win64", "chrome.exe"))
    .find((path) => existsSync(path));
}

const edge = firstExisting([
  process.env.D2_EXTENSION_EDGE_BROWSER,
  process.env["ProgramFiles(x86)"]
    ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
    : undefined,
  process.env.ProgramFiles
    ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    : undefined,
]);
const chrome = chromeForTesting();

for (const [name, executable] of [
  ["edge", edge],
  ["chrome-for-testing", chrome],
]) {
  if (!executable) {
    throw new Error(`D2 installed-browser assurance could not locate ${name}`);
  }
  const result = spawnSync(process.execPath, [browserHarness], {
    env: {
      ...process.env,
      D2_EXTENSION_BROWSER: executable,
      D2_EXTENSION_BROWSER_NAME: name,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`D2 installed-browser assurance failed for ${name}`);
  }
}

process.stdout.write(
  `${JSON.stringify({ profile: "d2_extension_installed_browser_matrix_v1", browsersExecuted: 2, passed: true })}\n`,
);
