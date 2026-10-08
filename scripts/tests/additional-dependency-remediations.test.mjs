import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADDITIONAL_REMEDIATIONS,
  evaluateAuditReport,
  evaluateInstalledDependencyAudit,
  verifyAdditionalDependencyRemediations,
} from "../lib/dependency-remediations.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const mobileRequire = createRequire(path.join(repository, "frontend/mobile/package.json"));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const fileMapRequire = createRequire(cliRequire.resolve("@expo/metro-file-map/package.json"));
const micromatchRequire = createRequire(fileMapRequire.resolve("micromatch/package.json"));
const installed = {
  "node-forge": path.dirname(cliRequire.resolve("node-forge/package.json")),
  braces: path.dirname(micromatchRequire.resolve("braces/package.json")),
};

function report() {
  return {
    advisories: Object.fromEntries(
      ADDITIONAL_REMEDIATIONS.map((item) => [
        item.cve,
        {
          cves: [item.cve],
          github_advisory_id: item.advisory,
          module_name: item.package,
          severity: "high",
          patched_versions: "<0.0.0",
          findings: [
            {
              version: item.version,
              paths: [
                item.package === "braces"
                  ? "frontend__mobile>expo>@expo/cli>@expo/metro-file-map>micromatch>braces"
                  : "frontend__mobile>expo>@expo/cli>node-forge",
              ],
            },
          ],
        },
      ]),
    ),
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } },
  };
}

function fixture(t) {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "additional-remediation-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repositoryRoot, "patches"));
  for (const filename of [
    "package.json",
    "pnpm-lock.yaml",
    ...ADDITIONAL_REMEDIATIONS.map((x) => x.patchPath),
  ]) {
    cpSync(path.join(repository, filename), path.join(repositoryRoot, filename));
  }
  const leaves = {};
  for (const item of ADDITIONAL_REMEDIATIONS) {
    const directory = path.join(repositoryRoot, "node_modules", item.package);
    cpSync(installed[item.package], directory, { recursive: true });
    leaves[item.package] = { version: item.version, path: directory };
  }
  return {
    repositoryRoot,
    leaves,
    report: report(),
    dependencyRoots: [
      {
        name: "@ai-job-apply/mobile",
        path: path.join(repositoryRoot, "frontend/mobile"),
        dependencies: {
          expo: {
            dependencies: {
              "@expo/cli": {
                dependencies: {
                  "node-forge": leaves["node-forge"],
                  micromatch: { dependencies: { braces: leaves.braces } },
                },
              },
            },
          },
        },
      },
    ],
  };
}

test("registry recognition requires verified installations, not advisory IDs alone", (t) => {
  const input = fixture(t);
  assert.throws(() => evaluateAuditReport(input.report));
  assert.deepEqual(evaluateInstalledDependencyAudit(input), {
    remediatedAdvisories: 2,
    registryOmittedAdvisories: 2,
    dependencyPaths: 2,
    installationsVerified: 2,
  });
  input.report.advisories = {};
  input.report.metadata.vulnerabilities.high = 0;
  assert.equal(evaluateInstalledDependencyAudit(input).registryOmittedAdvisories, 4);
});

for (const item of ADDITIONAL_REMEDIATIONS) {
  for (const [label, mutate] of [
    [
      "modified patch",
      (input) => writeFileSync(path.join(input.repositoryRoot, item.patchPath), "unreviewed"),
    ],
    [
      "modified entrypoint",
      (input) => writeFileSync(path.join(input.leaves[item.package].path, item.main), "unreviewed"),
    ],
    [
      "modified auxiliary file",
      (input) =>
        writeFileSync(path.join(input.leaves[item.package].path, "injected.js"), "unreviewed"),
    ],
    [
      "unpatched lock edge",
      (input) => {
        const p = path.join(input.repositoryRoot, "pnpm-lock.yaml");
        writeFileSync(
          p,
          readFileSync(p, "utf8").replace(
            `${item.package}: ${item.version}(patch_hash=${item.patchSha256})`,
            `${item.package}: ${item.version}`,
          ),
        );
      },
    ],
    [
      "different patch hash",
      (input) => {
        const p = path.join(input.repositoryRoot, "pnpm-lock.yaml");
        writeFileSync(
          p,
          readFileSync(p, "utf8").replace(`hash: ${item.patchSha256}`, `hash: ${"0".repeat(64)}`),
        );
      },
    ],
    [
      "unpatched duplicate snapshot",
      (input) => {
        const p = path.join(input.repositoryRoot, "pnpm-lock.yaml");
        writeFileSync(p, `${readFileSync(p, "utf8")}\n  ${item.package}@${item.version}: {}\n`);
      },
    ],
    [
      "unregistered patch",
      (input) => {
        const p = path.join(input.repositoryRoot, "package.json");
        const metadata = JSON.parse(readFileSync(p, "utf8"));
        delete metadata.pnpm.patchedDependencies[`${item.package}@${item.version}`];
        writeFileSync(p, JSON.stringify(metadata));
      },
    ],
    [
      "unexpected installed version",
      (input) => {
        input.leaves[item.package].version = "0.0.0";
      },
    ],
    [
      "path outside installation",
      (input) => {
        input.leaves[item.package].path = installed[item.package];
      },
    ],
  ]) {
    test(`${item.package} refuses ${label}`, (t) => {
      const input = fixture(t);
      mutate(input);
      assert.throws(() => evaluateInstalledDependencyAudit(input));
    });
  }
  for (const [label, mutate] of [
    [
      "unknown CVE",
      (a) => {
        a.cves = ["CVE-2026-99999"];
      },
    ],
    [
      "changed advisory ID",
      (a) => {
        a.github_advisory_id = "GHSA-unknown";
      },
    ],
    [
      "different version",
      (a) => {
        a.findings[0].version = "0.0.0";
      },
    ],
    [
      "new importer",
      (a) => {
        a.findings[0].paths = [`frontend__web>expo>${item.package}`];
      },
    ],
    [
      "unknown parent",
      (a) => {
        a.findings[0].paths = [`frontend__mobile>expo>unknown>${item.package}`];
      },
    ],
    [
      "empty findings",
      (a) => {
        a.findings = [];
      },
    ],
    [
      "changed patched range",
      (a) => {
        a.patched_versions = ">=99.0.0";
      },
    ],
  ]) {
    test(`${item.package} refuses registry ${label}`, (t) => {
      const input = fixture(t);
      mutate(input.report.advisories[item.cve]);
      assert.throws(() => evaluateInstalledDependencyAudit(input));
    });
  }
}

for (const [label, mutate] of [
  [
    "wrong importer",
    (input) => {
      input.dependencyRoots[0].name = "@ai-job-apply/web";
    },
  ],
  [
    "missing dependency inventory",
    (input) => {
      input.dependencyRoots = [];
    },
  ],
  [
    "inconsistent vulnerability totals",
    (input) => {
      input.report.metadata.vulnerabilities.critical = 1;
    },
  ],
  [
    "duplicate advisory",
    (input) => {
      input.report.advisories.duplicate = input.report.advisories[ADDITIONAL_REMEDIATIONS[0].cve];
    },
  ],
  [
    "suppression configuration",
    (input) => {
      const p = path.join(input.repositoryRoot, "package.json");
      const metadata = JSON.parse(readFileSync(p, "utf8"));
      metadata.pnpm.auditConfig = {};
      writeFileSync(p, JSON.stringify(metadata));
    },
  ],
]) {
  test(`additional remediation refuses ${label}`, (t) => {
    const input = fixture(t);
    mutate(input);
    assert.throws(() => evaluateInstalledDependencyAudit(input));
  });
}

test("missing installed patches refuse even when registry omits their advisories", (t) => {
  const input = fixture(t);
  input.report.advisories = {};
  input.report.metadata.vulnerabilities.high = 0;
  writeFileSync(path.join(input.leaves.braces.path, "index.js"), "unpatched");
  assert.throws(() => evaluateInstalledDependencyAudit(input));
  assert.throws(() => verifyAdditionalDependencyRemediations(input));
});
