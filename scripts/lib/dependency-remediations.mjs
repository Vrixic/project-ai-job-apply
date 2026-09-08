import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

// Exact reviewed local source remediation, not an expiring vulnerability acceptance.
export const IMAGE_SIZE_REMEDIATION = Object.freeze({
  package: "image-size",
  version: "1.2.1",
  patchPath: "patches/image-size@1.2.1.patch",
  patchSha256: "37a40e9556d8c610cb8627de7b5a141d10ae9a78b768915aefda1809f9aed608",
  lockPatchHash: "37a40e9556d8c610cb8627de7b5a141d10ae9a78b768915aefda1809f9aed608",
  installedTreeSha256: "69353bb092411adf01d204d8d1d423770834e57af1a15e42b9c7ca4e4a937c07",
});
const remediatedAdvisories = new Map([
  ["CVE-2025-71329", "GHSA-5p2g-fcmc-qvqq"],
  ["CVE-2025-71330", "GHSA-w3rx-r6r6-pgpr"],
]);
const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = () => {
  throw new Error("Dependency remediation verification failed.");
};

export function parseToolJson(result, acceptedStatuses) {
  if (
    result.error ||
    result.signal ||
    !acceptedStatuses.includes(result.status) ||
    typeof result.stdout !== "string"
  ) {
    fail();
  }
  try {
    const value = JSON.parse(result.stdout);
    if (isRecord(value) && (Object.hasOwn(value, "error") || Object.hasOwn(value, "message")))
      fail();
    return value;
  } catch {
    fail();
  }
}

export function imageSizeDependencyPaths(dependencyRoots, repositoryRoot) {
  if (!Array.isArray(dependencyRoots) || dependencyRoots.length === 0) fail();
  const matches = [];
  let visited = 0;
  function visit(dependencies, trail, root) {
    if (dependencies === undefined) return;
    if (!isRecord(dependencies) || trail.length > 64) fail();
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!isRecord(dependency) || ++visited > 50_000) fail();
      const next = [...trail, { ...dependency, name }];
      if (name === "image-size" || dependency.from === "image-size") {
        const names = next.map((entry) => entry.name);
        if (
          root.name !== "@ai-job-apply/mobile" ||
          typeof root.path !== "string" ||
          path.resolve(root.path) !== path.resolve(repositoryRoot, "frontend/mobile") ||
          names[0] !== "expo" ||
          names.at(-2) !== "metro" ||
          names.at(-1) !== "image-size" ||
          dependency.version !== IMAGE_SIZE_REMEDIATION.version ||
          typeof dependency.path !== "string" ||
          !path.isAbsolute(dependency.path)
        ) {
          fail();
        }
        matches.push(dependency.path);
      }
      for (const section of dependencySections) visit(dependency[section], next, root);
    }
  }
  for (const root of dependencyRoots) {
    if (!isRecord(root)) fail();
    for (const section of dependencySections) visit(root[section], [], root);
  }
  if (matches.length === 0) fail();
  return matches;
}

export function installedPackageTreeSha256(directory) {
  const entries = [];
  let bytes = 0;
  function visit(relative) {
    const fullPath = path.join(directory, relative);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) fail();
    if (stat.isDirectory()) {
      for (const name of readdirSync(fullPath).sort())
        visit(relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (entries.length >= 256 || bytes > 4 * 1024 * 1024) fail();
      entries.push([relative, digest(readFileSync(fullPath))]);
    } else {
      fail();
    }
  }
  visit("");
  if (entries.length === 0) fail();
  return digest(JSON.stringify(entries));
}

export function verifyImageSizeRemediation({ repositoryRoot, dependencyRoots }) {
  const remediation = IMAGE_SIZE_REMEDIATION;
  const rootPackage = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const patch = path.join(repositoryRoot, remediation.patchPath);
  if (
    rootPackage.pnpm?.patchedDependencies?.["image-size@1.2.1"] !== remediation.patchPath ||
    rootPackage.pnpm?.auditConfig !== undefined ||
    lstatSync(patch).isSymbolicLink() ||
    digest(readFileSync(patch)) !== remediation.patchSha256
  ) {
    fail();
  }
  // Verify pnpm's canonical lockfile representation without an extra YAML/runtime dependency.
  const lock = readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8").replace(
    /\r\n/gu,
    "\n",
  );
  const expectedPatch = `  image-size@1.2.1:\n    hash: ${remediation.lockPatchHash}\n    path: ${remediation.patchPath}\n`;
  const patchSection = lock.match(/^patchedDependencies:\n((?:[ \t].*\n|\n)*)/mu)?.[1];
  const patchedVersion = `1.2.1(patch_hash=${remediation.lockPatchHash})`;
  const snapshots = lock.split(/^snapshots:\n/mu);
  if (
    !patchSection?.includes(expectedPatch) ||
    [...lock.matchAll(/^patchedDependencies:$/gmu)].length !== 1 ||
    [...patchSection.matchAll(/^ {2}image-size@/gmu)].length !== 1 ||
    snapshots.length !== 2 ||
    JSON.stringify(
      [...snapshots[1].matchAll(/^ {2}image-size@([^\n:]+):$/gmu)].map((match) => match[1]),
    ) !== JSON.stringify([patchedVersion]) ||
    !lock.includes(`      image-size: ${patchedVersion}\n`) ||
    [...lock.matchAll(/^\s+image-size: (.+)$/gmu)].some((match) => match[1] !== patchedVersion)
  ) {
    fail();
  }
  const paths = imageSizeDependencyPaths(dependencyRoots, repositoryRoot);
  const moduleBoundary = realpathSync(path.join(repositoryRoot, "node_modules"));
  const installations = new Set();
  for (const directory of paths) {
    const resolved = realpathSync(directory);
    const relative = path.relative(moduleBoundary, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail();
    installations.add(resolved);
  }
  for (const directory of installations) {
    const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (
      metadata.name !== remediation.package ||
      metadata.version !== remediation.version ||
      metadata.main !== "dist/index.js" ||
      installedPackageTreeSha256(directory) !== remediation.installedTreeSha256
    ) {
      fail();
    }
  }
  return { dependencyPaths: paths.length, installationsVerified: installations.size };
}

export function evaluateAuditReport(report) {
  if (
    !isRecord(report) ||
    !isRecord(report.advisories) ||
    !isRecord(report.metadata?.vulnerabilities) ||
    Object.hasOwn(report, "error")
  ) {
    fail();
  }
  const severities = ["info", "low", "moderate", "high", "critical"];
  const expectedCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  const observed = new Set();
  for (const advisory of Object.values(report.advisories)) {
    if (!isRecord(advisory) || !Array.isArray(advisory.findings) || advisory.findings.length === 0)
      fail();
    const cve =
      Array.isArray(advisory.cves) && advisory.cves.length === 1 ? advisory.cves[0] : undefined;
    if (
      !remediatedAdvisories.has(cve) ||
      observed.has(cve) ||
      advisory.github_advisory_id !== remediatedAdvisories.get(cve) ||
      advisory.module_name !== IMAGE_SIZE_REMEDIATION.package ||
      advisory.severity !== "high" ||
      advisory.patched_versions !== "<0.0.0" ||
      advisory.findings.some(
        (finding) =>
          !isRecord(finding) ||
          finding.version !== IMAGE_SIZE_REMEDIATION.version ||
          !Array.isArray(finding.paths) ||
          finding.paths.length === 0 ||
          finding.paths.some(
            (entry) =>
              typeof entry !== "string" ||
              !entry.startsWith("frontend__mobile>expo>") ||
              !entry.endsWith(">metro>image-size"),
          ),
      )
    ) {
      fail();
    }
    observed.add(cve);
    expectedCounts.high++;
  }
  for (const severity of severities) {
    if (report.metadata.vulnerabilities[severity] !== expectedCounts[severity]) fail();
  }
  return {
    remediatedAdvisories: observed.size,
    registryOmittedAdvisories: remediatedAdvisories.size - observed.size,
  };
}
