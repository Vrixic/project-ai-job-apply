import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateInstalledDependencyAudit,
  parseToolJson,
  verifyImageSizeRemediation,
} from "./lib/dependency-remediations.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
// biome-ignore lint/suspicious/noUndeclaredEnvVars: This root CLI runs directly through pnpm, outside Turbo caching.
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || path.resolve(process.cwd()) !== repositoryRoot.replace(/[\\/]$/u, "")) {
  throw new Error(
    "Run the centralized dependency audit through pnpm audit:dependencies at the root.",
  );
}

function runPnpm(arguments_, acceptedStatuses) {
  return parseToolJson(
    spawnSync(process.execPath, [pnpmCli, ...arguments_], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    acceptedStatuses,
  );
}

try {
  // Always verify the actual installation, including when the registry omits known advisories.
  const dependencyRoots = runPnpm(["why", "image-size", "--recursive", "--json"], [0]);
  const remediation = verifyImageSizeRemediation({ repositoryRoot, dependencyRoots });
  const report = runPnpm(["audit", "--audit-level", "high", "--json"], [0, 1]);
  const additionalRoots = runPnpm(
    ["why", "node-forge", "braces", "deepmerge", "--recursive", "--json"],
    [0],
  );
  const result = evaluateInstalledDependencyAudit({
    repositoryRoot,
    dependencyRoots: additionalRoots,
    report,
  });
  process.stdout.write(
    `Dependency audit passed: exact local image-size, braces and deepmerge remediation and the exact upstream node-forge release verified across ${remediation.dependencyPaths + result.dependencyPaths} mobile build paths; ${result.remediatedAdvisories} known advisory records remediated, ${result.registryOmittedAdvisories} omitted by the registry. No risk exceptions.\n`,
  );
} catch {
  process.stderr.write(
    "Dependency audit failed: local remediation, dependency boundary, registry results, or audit execution requires review.\n",
  );
  process.exitCode = 1;
}
