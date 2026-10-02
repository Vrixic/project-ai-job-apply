import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAuditReport } from "../lib/dependency-remediations.mjs";
import {
  nodeForgeDependencyPaths,
  NODE_FORGE_REMEDIATION as pin,
  separateNodeForgeAdvisory,
  verifyNodeForgeRemediation,
} from "../lib/node-forge-remediation.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const mobile = createRequire(path.join(repository, "frontend/mobile/package.json"));
const expo = createRequire(mobile.resolve("expo/package.json"));
const cli = createRequire(expo.resolve("@expo/cli/package.json"));
const installed = path.dirname(cli.resolve("node-forge/package.json"));
function graph(root) {
  return [
    {
      name: "@ai-job-apply/mobile",
      path: path.join(root, "frontend/mobile"),
      dependencies: {
        expo: {
          dependencies: {
            "@expo/cli": {
              dependencies: {
                "node-forge": {
                  from: "node-forge",
                  version: "1.4.0",
                  path: path.join(root, "node_modules/node-forge"),
                },
              },
            },
          },
        },
      },
    },
  ];
}
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "forge-remediation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "patches"));
  cpSync(path.join(repository, pin.patchPath), path.join(root, pin.patchPath));
  cpSync(path.join(repository, "package.json"), path.join(root, "package.json"));
  cpSync(path.join(repository, "pnpm-lock.yaml"), path.join(root, "pnpm-lock.yaml"));
  cpSync(installed, path.join(root, "node_modules/node-forge"), { recursive: true });
  return { root, dependencyRoots: graph(root) };
}
const report = () => ({
  advisories: {
    forge: {
      cves: ["CVE-2026-85393"],
      github_advisory_id: "GHSA-86w9-cpqp-85rv",
      module_name: "node-forge",
      severity: "high",
      patched_versions: "<0.0.0",
      findings: [{ version: "1.4.0", paths: ["frontend__mobile>expo>@expo/cli>node-forge"] }],
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
});

test("verifies the entire exact installed tree and frozen patch independently of registry output", (t) => {
  const { root, dependencyRoots } = fixture(t);
  assert.deepEqual(verifyNodeForgeRemediation({ repositoryRoot: root, dependencyRoots }), {
    dependencyPaths: 1,
    installationsVerified: 1,
  });
  const result = separateNodeForgeAdvisory(report());
  assert.equal(result.remediatedAdvisories, 1);
  assert.doesNotThrow(() => evaluateAuditReport(result.report));
  assert.equal(Object.keys(report().advisories).length, 1, "does not mutate the input");
  const omitted = report();
  omitted.advisories = {};
  omitted.metadata.vulnerabilities.high = 0;
  assert.equal(separateNodeForgeAdvisory(omitted).registryOmittedAdvisories, 1);
});
for (const [name, mutate] of [
  [
    "changed source",
    (root) => writeFileSync(path.join(root, "node_modules/node-forge/lib/rsa.js"), "unpatched"),
  ],
  [
    "changed package entry",
    (root) => writeFileSync(path.join(root, "node_modules/node-forge/package.json"), "{}"),
  ],
  [
    "extra installed file",
    (root) => writeFileSync(path.join(root, "node_modules/node-forge/extra.js"), "injected"),
  ],
  ["changed patch", (root) => writeFileSync(path.join(root, pin.patchPath), "unreviewed")],
  ["missing patch", (root) => rmSync(path.join(root, pin.patchPath))],
  ["missing registration", (root) => writeFileSync(path.join(root, "package.json"), "{}")],
  [
    "audit suppression",
    (root) => {
      const target = path.join(root, "package.json");
      const metadata = JSON.parse(readFileSync(target, "utf8"));
      metadata.pnpm.auditConfig = { ignoreCves: ["CVE-2026-85393"] };
      writeFileSync(target, JSON.stringify(metadata));
    },
  ],
  [
    "unpatched dependency reference",
    (root) => {
      const target = path.join(root, "pnpm-lock.yaml");
      writeFileSync(
        target,
        readFileSync(target, "utf8").replace(
          `node-forge: 1.4.0(patch_hash=${pin.patchSha256})`,
          "node-forge: 1.4.0",
        ),
      );
    },
  ],
  [
    "tampered lock hash",
    (root) => {
      const target = path.join(root, "pnpm-lock.yaml");
      writeFileSync(
        target,
        readFileSync(target, "utf8").replace(`hash: ${pin.patchSha256}`, "hash: unreviewed"),
      );
    },
  ],
])
  test(`refuses ${name} even if registry omits the advisory`, (t) => {
    const { root, dependencyRoots } = fixture(t);
    mutate(root);
    assert.throws(() => verifyNodeForgeRemediation({ repositoryRoot: root, dependencyRoots }));
  });

test("refuses changed roots, aliases, versions, relative paths and unexpected dependency chains", () => {
  for (const mutate of [
    (roots) => {
      roots[0].name = "@ai-job-apply/gateway";
    },
    (roots) => {
      roots[0].path = path.join(repository, "backend/gateway");
    },
    (roots) => {
      roots[0].dependencies.expo.dependencies["@expo/cli"].dependencies["node-forge"].version =
        "1.4.1";
    },
    (roots) => {
      roots[0].dependencies.expo.dependencies["@expo/cli"].dependencies["node-forge"].path =
        "relative";
    },
    (roots) => {
      const deps = roots[0].dependencies.expo.dependencies["@expo/cli"].dependencies;
      deps.alias = deps["node-forge"];
      delete deps["node-forge"];
    },
    (roots) => {
      roots[0].dependencies["node-forge"] =
        roots[0].dependencies.expo.dependencies["@expo/cli"].dependencies["node-forge"];
    },
  ]) {
    const roots = graph(repository);
    mutate(roots);
    assert.throws(() => nodeForgeDependencyPaths(roots, repository));
  }
});
test("refuses every changed advisory and preserves unknown advisory blocking", () => {
  for (const mutate of [
    (r) => {
      r.advisories.forge.cves = ["CVE-new"];
    },
    (r) => {
      r.advisories.forge.github_advisory_id = "GHSA-new";
    },
    (r) => {
      r.advisories.forge.module_name = "other";
    },
    (r) => {
      r.advisories.forge.severity = "critical";
    },
    (r) => {
      r.advisories.forge.patched_versions = ">=1.4.1";
    },
    (r) => {
      r.advisories.forge.findings[0].version = "1.3.2";
    },
    (r) => {
      r.advisories.forge.findings[0].paths = ["backend__gateway>expo>@expo/cli>node-forge"];
    },
    (r) => {
      r.advisories.forge.findings[0].paths.push("frontend__mobile>other>node-forge");
    },
    (r) => {
      r.advisories.forge.findings = [];
    },
    (r) => {
      r.advisories.duplicate = structuredClone(r.advisories.forge);
    },
    (r) => {
      r.metadata.vulnerabilities.high = 0;
    },
    (r) => {
      r.error = "registry unavailable";
    },
  ]) {
    const r = report();
    mutate(r);
    assert.throws(() => separateNodeForgeAdvisory(r));
  }
  const unknown = report();
  unknown.advisories.other = { module_name: "unknown", findings: [{}] };
  unknown.metadata.vulnerabilities.high++;
  assert.throws(() => evaluateAuditReport(separateNodeForgeAdvisory(unknown).report));
  for (const invalid of [null, [], {}, { advisories: {}, metadata: {} }]) {
    assert.throws(() => separateNodeForgeAdvisory(invalid));
  }
});
test("central CLI verifies forge bytes before classifying any registry advisory", () => {
  const source = readFileSync(new URL("../audit-dependencies.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("verifyNodeForgeRemediation({") < source.indexOf('["audit",'));
  assert.ok(
    source.indexOf("separateNodeForgeAdvisory(report)") <
      source.indexOf("evaluateAuditReport(forgeResult.report)"),
  );
});
