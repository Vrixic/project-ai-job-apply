import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateAuditReport,
  UPSTREAM_PINS,
  verifyUpstreamPins,
} from "../lib/dependency-remediations.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const mobileRequire = createRequire(path.join(repository, "frontend/mobile/package.json"));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const installedForge = path.dirname(cliRequire.resolve("node-forge/package.json"));
const [pin] = UPSTREAM_PINS;

function fixture(t) {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "upstream-pin-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  for (const filename of ["package.json", "pnpm-lock.yaml"])
    cpSync(path.join(repository, filename), path.join(repositoryRoot, filename));
  const directory = path.join(repositoryRoot, "node_modules", pin.package);
  cpSync(installedForge, directory, { recursive: true });
  const leaf = { version: pin.version, path: directory };
  return {
    repositoryRoot,
    leaf,
    dependencyRoots: [
      {
        name: "@ai-job-apply/mobile",
        path: path.join(repositoryRoot, "frontend/mobile"),
        dependencies: {
          expo: { dependencies: { "@expo/cli": { dependencies: { "node-forge": leaf } } } },
        },
      },
    ],
  };
}

test("the exact upstream release is accepted as installed, with no local patch", (t) => {
  const input = fixture(t);
  assert.deepEqual(verifyUpstreamPins(input), { dependencyPaths: 1, installationsVerified: 1 });
  const metadata = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
  assert.equal(
    Object.keys(metadata.pnpm.patchedDependencies).some((key) => key.startsWith("node-forge@")),
    false,
  );
});

test("the other mobile path to it is accepted", (t) => {
  const input = fixture(t);
  input.dependencyRoots[0].dependencies = {
    "react-native-auth0": {
      dependencies: {
        expo: {
          dependencies: {
            "@expo/cli": {
              dependencies: {
                "@expo/code-signing-certificates": { dependencies: { "node-forge": input.leaf } },
              },
            },
          },
        },
      },
    },
  };
  assert.equal(verifyUpstreamPins(input).installationsVerified, 1);
});

const lockPath = (input) => path.join(input.repositoryRoot, "pnpm-lock.yaml");
const packagePath = (input) => path.join(input.repositoryRoot, "package.json");

for (const [label, mutate] of [
  [
    "a modified entrypoint",
    (input) => writeFileSync(path.join(input.leaf.path, pin.main), "unreviewed"),
  ],
  [
    "an injected file",
    (input) => writeFileSync(path.join(input.leaf.path, "injected.js"), "unreviewed"),
  ],
  [
    "a different installed version",
    (input) => {
      const file = path.join(input.leaf.path, "package.json");
      const metadata = JSON.parse(readFileSync(file, "utf8"));
      metadata.version = "1.4.0";
      writeFileSync(file, JSON.stringify(metadata));
    },
  ],
  [
    "a different version in the dependency inventory",
    (input) => {
      input.leaf.version = "1.4.0";
    },
  ],
  [
    "an installation outside the module boundary",
    (input) => {
      input.leaf.path = installedForge;
    },
  ],
  [
    "a reintroduced local patch",
    (input) => {
      const metadata = JSON.parse(readFileSync(packagePath(input), "utf8"));
      metadata.pnpm.patchedDependencies["node-forge@1.4.3"] = "patches/node-forge@1.4.3.patch";
      writeFileSync(packagePath(input), JSON.stringify(metadata));
    },
  ],
  [
    "a missing override",
    (input) => {
      const metadata = JSON.parse(readFileSync(packagePath(input), "utf8"));
      delete metadata.pnpm.overrides["node-forge@<1.4.3"];
      writeFileSync(packagePath(input), JSON.stringify(metadata));
    },
  ],
  [
    "a second installation in the lockfile",
    (input) =>
      writeFileSync(
        lockPath(input),
        `${readFileSync(lockPath(input), "utf8")}\n  node-forge@1.4.0: {}\n`,
      ),
  ],
  [
    "a lockfile reference to another version",
    (input) =>
      writeFileSync(
        lockPath(input),
        readFileSync(lockPath(input), "utf8").replace(
          "      node-forge: 1.4.3\n",
          "      node-forge: 1.4.0\n",
        ),
      ),
  ],
  [
    "a suppression configuration",
    (input) => {
      const metadata = JSON.parse(readFileSync(packagePath(input), "utf8"));
      metadata.pnpm.auditConfig = {};
      writeFileSync(packagePath(input), JSON.stringify(metadata));
    },
  ],
  [
    "an unknown parent",
    (input) => {
      input.dependencyRoots[0].dependencies.expo.dependencies = {
        unknown: { dependencies: { "node-forge": input.leaf } },
      };
    },
  ],
  [
    "an unknown first hop",
    (input) => {
      input.dependencyRoots[0].dependencies = {
        unknown: { dependencies: { "@expo/cli": { dependencies: { "node-forge": input.leaf } } } },
      };
    },
  ],
  [
    "another importer",
    (input) => {
      input.dependencyRoots[0].name = "@ai-job-apply/web";
    },
  ],
  [
    "a missing dependency inventory",
    (input) => {
      input.dependencyRoots = [];
    },
  ],
  [
    "no installation found",
    (input) => {
      input.dependencyRoots[0].dependencies = {};
    },
  ],
]) {
  test(`the upstream pin refuses ${label}`, (t) => {
    const input = fixture(t);
    mutate(input);
    assert.throws(() => verifyUpstreamPins(input));
  });
}

test("any registry advisory for the pinned package fails the audit, at any severity", () => {
  for (const severity of ["low", "moderate", "high", "critical"]) {
    const report = {
      advisories: {
        1: {
          cves: ["CVE-2026-00000"],
          github_advisory_id: "GHSA-test",
          module_name: pin.package,
          severity,
          patched_versions: ">=99.0.0",
          findings: [
            { version: pin.version, paths: [`frontend__mobile>expo>@expo/cli>${pin.package}`] },
          ],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: 1 },
      },
    };
    assert.throws(() => evaluateAuditReport(report));
  }
});
