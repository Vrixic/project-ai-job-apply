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
  installedTreeSha256s: Object.freeze([
    // Legacy Windows/WSL launchers, native Windows launchers, and Linux installation.
    "69353bb092411adf01d204d8d1d423770834e57af1a15e42b9c7ca4e4a937c07",
    "9a13c3ef6192f85050c9f83fc9cddb48911a634ea29253fa39b9797d4b03bc3b",
    "cf10fa4cf9d5f85a86f0db1b29911a4760a810161675f6f745d3631fbabb809d",
  ]),
});
const remediatedAdvisories = new Map([
  ["CVE-2025-71329", "GHSA-5p2g-fcmc-qvqq"],
  ["CVE-2025-71330", "GHSA-w3rx-r6r6-pgpr"],
]);
export const ADDITIONAL_REMEDIATIONS = Object.freeze([
  Object.freeze({
    package: "braces",
    version: "3.0.3",
    main: "index.js",
    cve: "CVE-2026-93687",
    advisory: "GHSA-vfj7-8cjw-p6xm",
    severity: "high",
    // Where the installed copy may sit, and how the registry reports its path.
    parents: Object.freeze(["micromatch"]),
    firstHops: Object.freeze(["expo"]),
    auditSuffix: ">micromatch>braces",
    patchPath: "patches/braces@3.0.3.patch",
    patchSha256: "816530fe94f297f2ae23f1d98d9c4795b4898b9720e81fa900f0a89b84a1d707",
    treeSha256: "185e0a8b074390a55748d7ec0965da52d2c69b821cb3cdbfb0ee033efd156fda",
  }),
  // No upstream release fixes this (4.3.1 is the latest). mergeObject copied an own `__proto__` key
  // of the target through the prototype setter, so a merged result could take an attacker's
  // prototype. The patch defines every merged key as an own data property instead.
  Object.freeze({
    package: "deepmerge",
    version: "4.3.1",
    main: "dist/cjs.js",
    cve: "CVE-2026-93753",
    advisory: "GHSA-gcqx-w48m-w2h4",
    severity: "low",
    parents: Object.freeze(["@expo/config"]),
    firstHops: Object.freeze(["expo", "react-native-auth0"]),
    auditSuffix: ">@expo/config>deepmerge",
    patchPath: "patches/deepmerge@4.3.1.patch",
    patchSha256: "13b2e96c286a41d7b4259bfdb34d125622736e7dfd6271a2d64d541caef621e6",
    treeSha256: "7fad449baa2bfea8eedc07f46d58caf1d5a90f7a0ce8776eb0cf944f00bd78b5",
  }),
]);
// Exact upstream releases that fix an advisory, installed as published with no local patch.
// node-forge 1.4.3 (2026-11-04) re-encodes and compares the RSASSA-PKCS1-v1_5 DigestInfo, which
// is the fix the earlier local 1.4.0 patch backported (CVE-2026-85393), and it is outside every
// affected range in the registry audit. The mobile build tooling is the only importer that reaches
// it; the installed tree is pinned by digest, and any registry advisory for it fails the audit.
export const UPSTREAM_PINS = Object.freeze([
  Object.freeze({
    package: "node-forge",
    version: "1.4.3",
    main: "lib/index.js",
    treeSha256: "9b6be415be2445073b7c08e1ebcfdbcee25de2a48d89ff3b98f92a33867ad96f",
    parents: Object.freeze(["@expo/cli", "@expo/code-signing-certificates"]),
    firstHops: Object.freeze(["expo", "react-native-auth0"]),
  }),
]);
// The registry reports the affected transitive path from the mobile importer through either of its
// two direct dependencies that reach metro; both lead to the same reviewed, patched installation
// that verifyImageSizeRemediation proves. Any other importer or first hop is still rejected.
const mobileAuditPathPrefixes = Object.freeze([
  "frontend__mobile>expo>",
  "frontend__mobile>react-native>",
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
      !remediation.installedTreeSha256s.includes(installedPackageTreeSha256(directory))
    ) {
      fail();
    }
  }
  return { dependencyPaths: paths.length, installationsVerified: installations.size };
}

export function verifyAdditionalDependencyRemediations({ repositoryRoot, dependencyRoots }) {
  if (!Array.isArray(dependencyRoots) || dependencyRoots.length === 0) fail();
  const metadata = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  if (metadata.pnpm?.auditConfig !== undefined) fail();
  const lock = readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8").replace(
    /\r\n/gu,
    "\n",
  );
  const patchSections = [...lock.matchAll(/^patchedDependencies:\n((?:[ \t].*\n|\n)*)/gmu)];
  const snapshots = lock.split(/^snapshots:\n/mu);
  if (patchSections.length !== 1 || snapshots.length !== 2) fail();
  const moduleBoundary = realpathSync(path.join(repositoryRoot, "node_modules"));
  let dependencyPaths = 0;
  let installationsVerified = 0;
  for (const remediation of ADDITIONAL_REMEDIATIONS) {
    const { package: name, version, patchPath, patchSha256 } = remediation;
    const key = `${name}@${version}`;
    const patch = path.join(repositoryRoot, patchPath);
    const patchedVersion = `${version}(patch_hash=${patchSha256})`;
    if (
      metadata.pnpm?.patchedDependencies?.[key] !== patchPath ||
      lstatSync(patch).isSymbolicLink() ||
      digest(readFileSync(patch)) !== patchSha256 ||
      !patchSections[0][1].includes(
        `  ${key}:\n    hash: ${patchSha256}\n    path: ${patchPath}\n`,
      ) ||
      patchSections[0][1].split("\n").filter((line) => line.startsWith(`  ${name}@`)).length !==
        1 ||
      JSON.stringify(
        snapshots[1]
          .split("\n")
          .filter((line) => line.startsWith(`  ${name}@`))
          .map((line) => line.replace(/ \{\}$/u, "")),
      ) !== JSON.stringify([`  ${name}@${patchedVersion}:`]) ||
      !lock.includes(`      ${name}: ${patchedVersion}\n`) ||
      lock
        .split("\n")
        .some(
          (line) =>
            line.trimStart().startsWith(`${name}: `) &&
            line.trim() !== `${name}: ${patchedVersion}`,
        )
    )
      fail();
    const installations = new Set();
    let visited = 0;
    function visit(dependencies, trail, root) {
      if (dependencies === undefined) return;
      if (!isRecord(dependencies) || trail.length > 64) fail();
      for (const [dependencyName, dependency] of Object.entries(dependencies)) {
        if (!isRecord(dependency) || ++visited > 50_000) fail();
        const next = [...trail, dependencyName];
        if (dependencyName === name || dependency.from === name) {
          if (
            root.name !== "@ai-job-apply/mobile" ||
            typeof root.path !== "string" ||
            path.resolve(root.path) !== path.resolve(repositoryRoot, "frontend/mobile") ||
            !remediation.firstHops.includes(next[0]) ||
            dependencyName !== name ||
            dependency.version !== version ||
            !remediation.parents.includes(next.at(-2)) ||
            typeof dependency.path !== "string" ||
            !path.isAbsolute(dependency.path)
          )
            fail();
          const resolved = realpathSync(dependency.path);
          const relative = path.relative(moduleBoundary, resolved);
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail();
          installations.add(resolved);
          dependencyPaths++;
        }
        for (const section of dependencySections) visit(dependency[section], next, root);
      }
    }
    for (const root of dependencyRoots) {
      if (!isRecord(root)) fail();
      for (const section of dependencySections) visit(root[section], [], root);
    }
    if (installations.size === 0) fail();
    for (const directory of installations) {
      const installed = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      if (
        installed.name !== name ||
        installed.version !== version ||
        installed.main !== remediation.main ||
        installedPackageTreeSha256(directory) !== remediation.treeSha256
      )
        fail();
      installationsVerified++;
    }
  }
  return { dependencyPaths, installationsVerified };
}

export function verifyUpstreamPins({ repositoryRoot, dependencyRoots }) {
  if (!Array.isArray(dependencyRoots) || dependencyRoots.length === 0) fail();
  const metadata = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  if (metadata.pnpm?.auditConfig !== undefined) fail();
  const lock = readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8").replace(
    /\r\n/gu,
    "\n",
  );
  const snapshots = lock.split(/^snapshots:\n/mu);
  if (snapshots.length !== 2) fail();
  const moduleBoundary = realpathSync(path.join(repositoryRoot, "node_modules"));
  let dependencyPaths = 0;
  let installationsVerified = 0;
  for (const pin of UPSTREAM_PINS) {
    const { package: name, version } = pin;
    // Installed as published: no local patch for it, and the override that forces the release.
    const patchSection = lock.match(/^patchedDependencies:\n((?:[ \t].*\n|\n)*)/mu)?.[1] ?? "";
    if (
      Object.keys(metadata.pnpm?.patchedDependencies ?? {}).some((key) =>
        key.startsWith(`${name}@`),
      ) ||
      patchSection.split("\n").some((line) => line.startsWith(`  ${name}@`)) ||
      metadata.pnpm?.overrides?.[`${name}@<${version}`] !== version
    )
      fail();
    // One installation of the package in the lockfile, at exactly this version, referenced only so.
    if (
      JSON.stringify(
        snapshots[1]
          .split("\n")
          .filter((line) => line.startsWith(`  ${name}@`))
          .map((line) => line.replace(/ \{\}$/u, "")),
      ) !== JSON.stringify([`  ${name}@${version}:`]) ||
      lock
        .split("\n")
        .some(
          (line) =>
            line.trimStart().startsWith(`${name}: `) && line.trim() !== `${name}: ${version}`,
        )
    )
      fail();
    const installations = new Set();
    let visited = 0;
    function visit(dependencies, trail, root) {
      if (dependencies === undefined) return;
      if (!isRecord(dependencies) || trail.length > 64) fail();
      for (const [dependencyName, dependency] of Object.entries(dependencies)) {
        if (!isRecord(dependency) || ++visited > 50_000) fail();
        const next = [...trail, dependencyName];
        if (dependencyName === name || dependency.from === name) {
          if (
            root.name !== "@ai-job-apply/mobile" ||
            typeof root.path !== "string" ||
            path.resolve(root.path) !== path.resolve(repositoryRoot, "frontend/mobile") ||
            !pin.firstHops.includes(next[0]) ||
            dependencyName !== name ||
            dependency.version !== version ||
            !pin.parents.includes(next.at(-2)) ||
            typeof dependency.path !== "string" ||
            !path.isAbsolute(dependency.path)
          )
            fail();
          const resolved = realpathSync(dependency.path);
          const relative = path.relative(moduleBoundary, resolved);
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail();
          installations.add(resolved);
          dependencyPaths++;
        }
        for (const section of dependencySections) visit(dependency[section], next, root);
      }
    }
    for (const root of dependencyRoots) {
      if (!isRecord(root)) fail();
      for (const section of dependencySections) visit(root[section], [], root);
    }
    if (installations.size === 0) fail();
    for (const directory of installations) {
      const installed = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      if (
        installed.name !== name ||
        installed.version !== version ||
        installed.main !== pin.main ||
        installedPackageTreeSha256(directory) !== pin.treeSha256
      )
        fail();
      installationsVerified++;
    }
  }
  return { dependencyPaths, installationsVerified };
}

export function evaluateInstalledDependencyAudit({ repositoryRoot, dependencyRoots, report }) {
  const remediation = verifyAdditionalDependencyRemediations({ repositoryRoot, dependencyRoots });
  const pins = verifyUpstreamPins({ repositoryRoot, dependencyRoots });
  return {
    ...evaluateAudit(report, true),
    dependencyPaths: remediation.dependencyPaths + pins.dependencyPaths,
    installationsVerified: remediation.installationsVerified + pins.installationsVerified,
  };
}

export function evaluateAuditReport(report) {
  return evaluateAudit(report, false);
}

function evaluateAudit(report, additionalVerified) {
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
    const additional =
      additionalVerified && ADDITIONAL_REMEDIATIONS.find((item) => item.cve === cve);
    if (additional) {
      if (
        observed.has(cve) ||
        advisory.github_advisory_id !== additional.advisory ||
        advisory.module_name !== additional.package ||
        advisory.severity !== additional.severity ||
        advisory.patched_versions !== "<0.0.0" ||
        advisory.findings.some(
          (finding) =>
            !isRecord(finding) ||
            finding.version !== additional.version ||
            !Array.isArray(finding.paths) ||
            finding.paths.length === 0 ||
            finding.paths.some(
              (entry) =>
                typeof entry !== "string" ||
                !entry.startsWith("frontend__mobile>expo>") ||
                !entry.endsWith(additional.auditSuffix),
            ),
        )
      )
        fail();
      observed.add(cve);
      expectedCounts[additional.severity]++;
      continue;
    }
    if (
      !remediatedAdvisories.has(cve) ||
      observed.has(cve) ||
      advisory.github_advisory_id !== remediatedAdvisories.get(cve) ||
      advisory.module_name !== IMAGE_SIZE_REMEDIATION.package ||
      advisory.severity !== "high" ||
      advisory.patched_versions !== ">=2.0.3" ||
      advisory.findings.some(
        (finding) =>
          !isRecord(finding) ||
          finding.version !== IMAGE_SIZE_REMEDIATION.version ||
          !Array.isArray(finding.paths) ||
          finding.paths.length === 0 ||
          finding.paths.some(
            (entry) =>
              typeof entry !== "string" ||
              !mobileAuditPathPrefixes.some((prefix) => entry.startsWith(prefix)) ||
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
    registryOmittedAdvisories:
      remediatedAdvisories.size +
      (additionalVerified ? ADDITIONAL_REMEDIATIONS.length : 0) -
      observed.size,
  };
}
