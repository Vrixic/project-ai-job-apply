import { spawnSync } from "node:child_process";
import path from "node:path";

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
const registryOmittedExceptions = new Set();
const unaccepted = [];
const changedExpectedExceptions = [];
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
    if (cves.some((cve) => exceptions.has(cve))) {
      changedExpectedExceptions.push({
        advisory: advisory.github_advisory_id ?? "unknown",
        cves,
        module: advisory.module_name ?? "unknown",
        patchedVersions: advisory.patched_versions ?? "unknown",
        pathCount: paths.length,
        pathsAreMobileMetroOnly,
        samplePaths: paths.slice(0, 3),
        severity: advisory.severity ?? "unknown",
        versions: [...versions],
      });
    }
    unaccepted.push(
      `${advisory.github_advisory_id ?? "unknown advisory"} (${advisory.module_name ?? "unknown package"})`,
    );
  }
}

let missingExceptions = [...exceptions.keys()].filter((cve) => !observedExceptions.has(cve));
if (missingExceptions.length > 0 && unaccepted.length === 0) {
  const why = spawnSync(process.execPath, [pnpmCli, "why", "image-size", "--recursive", "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (why.error) {
    throw why.error;
  }
  if (why.status !== 0) {
    process.stderr.write(why.stderr);
    throw new Error(`pnpm why failed with exit code ${why.status}.`);
  }

  let dependencyRoots;
  try {
    dependencyRoots = JSON.parse(why.stdout);
  } catch {
    throw new Error("pnpm why did not return a valid JSON dependency graph.");
  }

  const imageSizePaths = [];
  const visitDependencies = (dependencies, dependencyPath, root) => {
    for (const [name, dependency] of Object.entries(dependencies ?? {})) {
      const nextPath = [...dependencyPath, { name, version: dependency.version }];
      if (name === "image-size") {
        imageSizePaths.push({ root, dependencies: nextPath });
      }
      visitDependencies(dependency.dependencies, nextPath, root);
    }
  };
  for (const root of Array.isArray(dependencyRoots) ? dependencyRoots : []) {
    visitDependencies(root.dependencies, [], {
      name: root.name,
      path: root.path,
    });
  }

  const expectedMobilePath = path.join(process.cwd(), "frontend", "mobile");
  const graphMatchesApprovedBoundary =
    imageSizePaths.length > 0 &&
    imageSizePaths.every(({ root, dependencies }) => {
      const dependencyNames = dependencies.map(({ name }) => name);
      return (
        root.name === "@ai-job-apply/mobile" &&
        path.resolve(root.path) === expectedMobilePath &&
        dependencyNames[0] === "expo" &&
        dependencyNames.at(-2) === "metro" &&
        dependencyNames.at(-1) === "image-size" &&
        dependencies.at(-1)?.version === "1.2.1"
      );
    });

  if (graphMatchesApprovedBoundary) {
    for (const cve of missingExceptions) {
      observedExceptions.add(cve);
      registryOmittedExceptions.add(cve);
    }
    missingExceptions = [];
  }
}

if (unaccepted.length > 0 || missingExceptions.length > 0) {
  if (unaccepted.length > 0) {
    process.stderr.write(`Unaccepted high-severity advisories: ${unaccepted.join(", ")}\n`);
  }
  if (missingExceptions.length > 0) {
    process.stderr.write(
      `Stale or changed dependency exceptions require removal/review: ${missingExceptions.join(", ")}\n`,
    );
    if (changedExpectedExceptions.length > 0) {
      process.stderr.write(
        `Changed expected exception records: ${JSON.stringify(changedExpectedExceptions)}\n`,
      );
    }
  }
  process.exit(1);
}

process.stdout.write(
  `Dependency audit passed with ${observedExceptions.size} exact, expiring mobile-build exceptions${
    registryOmittedExceptions.size > 0
      ? ` (${registryOmittedExceptions.size} omitted by the registry feed and independently verified in the installed graph)`
      : ""
  }.\n`,
);
