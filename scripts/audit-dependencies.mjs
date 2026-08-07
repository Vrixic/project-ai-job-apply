import { spawnSync } from "node:child_process";

const exceptionExpiry = Date.parse("2026-09-08T00:00:00Z");
const exceptions = new Map([
  [
    "CVE-2025-71329",
    {
      advisory: "GHSA-5p2g-fcmc-qvqq",
      package: "image-size",
      version: "1.2.1",
    },
  ],
  [
    "CVE-2025-71330",
    {
      advisory: "GHSA-w3rx-r6r6-pgpr",
      package: "image-size",
      version: "1.2.1",
    },
  ],
]);

if (Date.now() >= exceptionExpiry) {
  throw new Error(
    "The exact image-size audit exceptions expired; reassess and remove or explicitly renew them.",
  );
}

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  throw new Error("Run the centralized dependency audit through pnpm audit:dependencies.");
}
const audit = spawnSync(process.execPath, [pnpmCli, "audit", "--audit-level", "high", "--json"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (audit.error) {
  throw audit.error;
}
if (audit.status !== 0 && audit.status !== 1) {
  process.stderr.write(audit.stderr);
  throw new Error(`pnpm audit failed with unexpected exit code ${audit.status}.`);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr);
  throw new Error("pnpm audit did not return a valid JSON report.");
}

const observedExceptions = new Set();
const unaccepted = [];
for (const advisory of Object.values(report.advisories ?? {})) {
  const cves = Array.isArray(advisory.cves) ? advisory.cves : [];
  const exception = cves.length === 1 ? exceptions.get(cves[0]) : undefined;
  const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []);
  const versions = new Set((advisory.findings ?? []).map((finding) => finding.version));
  const pathsAreMobileMetroOnly =
    paths.length > 0 &&
    paths.every(
      (path) => path.startsWith("frontend__mobile>expo>") && path.endsWith(">metro>image-size"),
    );
  const exactException =
    exception !== undefined &&
    advisory.github_advisory_id === exception.advisory &&
    advisory.module_name === exception.package &&
    advisory.severity === "high" &&
    advisory.patched_versions === "<0.0.0" &&
    versions.size === 1 &&
    versions.has(exception.version) &&
    pathsAreMobileMetroOnly;

  if (exactException) {
    observedExceptions.add(cves[0]);
  } else {
    unaccepted.push(
      `${advisory.github_advisory_id ?? "unknown advisory"} (${advisory.module_name ?? "unknown package"})`,
    );
  }
}

const missingExceptions = [...exceptions.keys()].filter((cve) => !observedExceptions.has(cve));
if (unaccepted.length > 0 || missingExceptions.length > 0) {
  if (unaccepted.length > 0) {
    process.stderr.write(`Unaccepted high-severity advisories: ${unaccepted.join(", ")}\n`);
  }
  if (missingExceptions.length > 0) {
    process.stderr.write(
      `Stale or changed dependency exceptions require removal/review: ${missingExceptions.join(", ")}\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(
  `Dependency audit passed with ${observedExceptions.size} exact, expiring mobile-build exceptions.\n`,
);
