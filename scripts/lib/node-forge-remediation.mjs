import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { installedPackageTreeSha256 } from "./dependency-remediations.mjs";

export const NODE_FORGE_REMEDIATION = Object.freeze({
  version: "1.4.0",
  patchPath: "patches/node-forge@1.4.0.patch",
  patchSha256: "658b6b624b19b149c75f04079e34e68d14e04ce1c6381e393625d813f6e46adf",
  installedTreeSha256: "2bac91e147b6b0cc8fc7cf39b3450ff5c7b1cff501f09b14d03f819112acd71d",
});
const trails = Object.freeze([
  "expo>@expo/cli>node-forge",
  "expo>@expo/cli>@expo/code-signing-certificates>node-forge",
  "react-native-auth0>expo>@expo/cli>node-forge",
  "react-native-auth0>expo>@expo/cli>@expo/code-signing-certificates>node-forge",
]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = () => {
  throw new Error("Node-forge source remediation verification failed.");
};
const sections = ["dependencies", "devDependencies", "optionalDependencies"];

export function nodeForgeDependencyPaths(roots, repositoryRoot) {
  if (!Array.isArray(roots) || roots.length === 0) fail();
  const paths = [];
  let visited = 0;
  function visit(dependencies, trail, root) {
    if (dependencies === undefined) return;
    if (!isRecord(dependencies) || trail.length > 64) fail();
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!isRecord(dependency) || ++visited > 50_000) fail();
      const next = [...trail, name];
      if (name === "node-forge" || dependency.from === "node-forge") {
        if (
          name !== "node-forge" ||
          root.name !== "@ai-job-apply/mobile" ||
          typeof root.path !== "string" ||
          path.resolve(root.path) !== path.resolve(repositoryRoot, "frontend/mobile") ||
          !trails.includes(next.join(">")) ||
          dependency.version !== "1.4.0" ||
          typeof dependency.path !== "string" ||
          !path.isAbsolute(dependency.path)
        )
          fail();
        paths.push(dependency.path);
      }
      for (const section of sections) visit(dependency[section], next, root);
    }
  }
  for (const root of roots) {
    if (!isRecord(root)) fail();
    for (const section of sections) visit(root[section], [], root);
  }
  if (paths.length === 0) fail();
  return paths;
}

export function verifyNodeForgeRemediation({ repositoryRoot, dependencyRoots }) {
  const pin = NODE_FORGE_REMEDIATION;
  const metadata = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const patch = path.join(repositoryRoot, pin.patchPath);
  if (
    metadata.pnpm?.patchedDependencies?.["node-forge@1.4.0"] !== pin.patchPath ||
    metadata.pnpm?.auditConfig !== undefined ||
    lstatSync(patch).isSymbolicLink() ||
    createHash("sha256").update(readFileSync(patch)).digest("hex") !== pin.patchSha256
  )
    fail();
  const lock = readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8").replace(
    /\r\n/gu,
    "\n",
  );
  const patchSection = lock.match(/^patchedDependencies:\n((?:[ \t].*\n|\n)*)/mu)?.[1];
  const version = `1.4.0(patch_hash=${pin.patchSha256})`;
  const snapshots = lock.split(/^snapshots:\n/mu);
  if (
    !patchSection?.includes(
      `  node-forge@1.4.0:\n    hash: ${pin.patchSha256}\n    path: ${pin.patchPath}\n`,
    ) ||
    [...lock.matchAll(/^patchedDependencies:$/gmu)].length !== 1 ||
    [...patchSection.matchAll(/^ {2}node-forge@/gmu)].length !== 1 ||
    snapshots.length !== 2 ||
    JSON.stringify([...snapshots[1].matchAll(/^ {2}node-forge@([^\n:]+):/gmu)].map((m) => m[1])) !==
      JSON.stringify([version]) ||
    !lock.includes(`      node-forge: ${version}\n`) ||
    [...lock.matchAll(/^\s+node-forge: (.+)$/gmu)].some((m) => m[1] !== version)
  )
    fail();
  const dependencyPaths = nodeForgeDependencyPaths(dependencyRoots, repositoryRoot);
  const boundary = realpathSync(path.join(repositoryRoot, "node_modules"));
  const installations = new Set();
  for (const directory of dependencyPaths) {
    const resolved = realpathSync(directory);
    const relative = path.relative(boundary, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail();
    installations.add(resolved);
  }
  for (const directory of installations) {
    const installed = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (
      installed.name !== "node-forge" ||
      installed.version !== pin.version ||
      installed.main !== "lib/index.js" ||
      installedPackageTreeSha256(directory) !== pin.installedTreeSha256
    )
      fail();
  }
  return { dependencyPaths: dependencyPaths.length, installationsVerified: installations.size };
}

// Only classify this one exact advisory after the caller has verified the local installation.
// The remaining report still goes through the existing strict complete-lockfile evaluator.
export function separateNodeForgeAdvisory(report) {
  if (
    !isRecord(report) ||
    !isRecord(report.advisories) ||
    !isRecord(report.metadata?.vulnerabilities) ||
    Object.hasOwn(report, "error")
  )
    fail();
  const remaining = structuredClone(report);
  let remediated = 0;
  for (const [key, advisory] of Object.entries(report.advisories)) {
    if (!isRecord(advisory)) fail();
    if (
      advisory.module_name !== "node-forge" &&
      advisory.github_advisory_id !== "GHSA-86w9-cpqp-85rv" &&
      !advisory.cves?.includes("CVE-2026-85393")
    )
      continue;
    if (
      remediated ||
      JSON.stringify(advisory.cves) !== '["CVE-2026-85393"]' ||
      advisory.github_advisory_id !== "GHSA-86w9-cpqp-85rv" ||
      advisory.module_name !== "node-forge" ||
      advisory.severity !== "high" ||
      advisory.patched_versions !== "<0.0.0" ||
      !Array.isArray(advisory.findings) ||
      advisory.findings.length === 0 ||
      advisory.findings.some(
        (finding) =>
          !isRecord(finding) ||
          finding.version !== "1.4.0" ||
          !Array.isArray(finding.paths) ||
          finding.paths.length === 0 ||
          finding.paths.some(
            (entry) =>
              typeof entry !== "string" ||
              !trails.some((trail) => entry === `frontend__mobile>${trail}`),
          ),
      )
    )
      fail();
    remediated++;
    delete remaining.advisories[key];
  }
  if (
    !Number.isSafeInteger(remaining.metadata.vulnerabilities.high) ||
    remaining.metadata.vulnerabilities.high < remediated
  )
    fail();
  remaining.metadata.vulnerabilities.high -= remediated;
  return {
    report: remaining,
    remediatedAdvisories: remediated,
    registryOmittedAdvisories: 1 - remediated,
  };
}
