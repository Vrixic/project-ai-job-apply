import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateAuditReport,
  IMAGE_SIZE_REMEDIATION,
  imageSizeDependencyPaths,
  parseToolJson,
  verifyImageSizeRemediation,
} from "../lib/dependency-remediations.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const clone = (value) => structuredClone(value);
function graph(root, installedPath = path.join(root, "node_modules/image-size")) {
  return [
    {
      name: "@ai-job-apply/mobile",
      path: path.join(root, "frontend/mobile"),
      dependencies: {
        expo: {
          version: "57.0.11",
          dependencies: {
            metro: {
              version: "0.84.4",
              dependencies: {
                "image-size": { from: "image-size", version: "1.2.1", path: installedPath },
              },
            },
          },
        },
      },
    },
  ];
}
function report(count = 2) {
  return {
    advisories: Object.fromEntries(
      [
        ["CVE-2025-71329", "GHSA-5p2g-fcmc-qvqq"],
        ["CVE-2025-71330", "GHSA-w3rx-r6r6-pgpr"],
      ]
        .slice(0, count)
        .map(([cve, id], index) => [
          index,
          {
            cves: [cve],
            github_advisory_id: id,
            module_name: "image-size",
            severity: "high",
            patched_versions: "<0.0.0",
            findings: [{ version: "1.2.1", paths: ["frontend__mobile>expo>metro>image-size"] }],
          },
        ]),
    ),
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: count, critical: 0 } },
  };
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "dependency-remediation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const patch = path.join(root, IMAGE_SIZE_REMEDIATION.patchPath);
  mkdirSync(path.dirname(patch), { recursive: true });
  cpSync(path.join(repository, IMAGE_SIZE_REMEDIATION.patchPath), patch);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      pnpm: { patchedDependencies: { "image-size@1.2.1": IMAGE_SIZE_REMEDIATION.patchPath } },
    }),
  );
  cpSync(path.join(repository, "pnpm-lock.yaml"), path.join(root, "pnpm-lock.yaml"));
  const packages = path.join(repository, "node_modules/.pnpm");
  const installed = readdirSync(packages).filter((name) =>
    name.startsWith("image-size@1.2.1_patch_hash"),
  );
  assert.equal(installed.length, 1, "Tests require the single exact patched installation.");
  cpSync(
    path.join(packages, installed[0], "node_modules/image-size"),
    path.join(root, "node_modules/image-size"),
    { recursive: true },
  );
  return { root, patch, dependencyRoots: graph(root) };
}

test("accepts exactly the reviewed patched installation even when the registry omits advisories", (t) => {
  const { root, dependencyRoots } = fixture(t);
  assert.deepEqual(verifyImageSizeRemediation({ repositoryRoot: root, dependencyRoots }), {
    dependencyPaths: 1,
    installationsVerified: 1,
  });
  for (const count of [0, 1, 2]) {
    assert.deepEqual(evaluateAuditReport(report(count)), {
      remediatedAdvisories: count,
      registryOmittedAdvisories: 2 - count,
    });
  }
});

for (const [name, mutate] of [
  ["changed patch bytes", ({ patch }) => writeFileSync(patch, "unreviewed patch")],
  ["missing patch", ({ patch }) => rmSync(patch)],
  [
    "missing patch registration",
    ({ root }) => writeFileSync(path.join(root, "package.json"), "{}"),
  ],
  [
    "hidden audit suppression configuration",
    ({ root }) => {
      const target = path.join(root, "package.json");
      const metadata = JSON.parse(readFileSync(target, "utf8"));
      metadata.pnpm.auditConfig = { ignoreCves: ["CVE-2026-99999"] };
      writeFileSync(target, JSON.stringify(metadata));
    },
  ],
  [
    "unpatched lockfile reference",
    ({ root }) => {
      const target = path.join(root, "pnpm-lock.yaml");
      const patched = `1.2.1(patch_hash=${IMAGE_SIZE_REMEDIATION.lockPatchHash})`;
      writeFileSync(
        target,
        readFileSync(target, "utf8").replace(`image-size: ${patched}`, "image-size: 1.2.1"),
      );
    },
  ],
  [
    "changed lock patch hash",
    ({ root }) => {
      const target = path.join(root, "pnpm-lock.yaml");
      writeFileSync(
        target,
        readFileSync(target, "utf8").replace(
          `hash: ${IMAGE_SIZE_REMEDIATION.lockPatchHash}`,
          "hash: unreviewed",
        ),
      );
    },
  ],
  [
    "unapplied or tampered runtime patch",
    ({ root }) =>
      writeFileSync(
        path.join(root, "node_modules/image-size/dist/types/utils.js"),
        "unpatched parser",
      ),
  ],
  [
    "tampered entrypoint",
    ({ root }) =>
      writeFileSync(path.join(root, "node_modules/image-size/dist/index.js"), "unreviewed loader"),
  ],
  [
    "unexpected installed file",
    ({ root }) =>
      writeFileSync(path.join(root, "node_modules/image-size/extra.js"), "unexpected source"),
  ],
  [
    "wrong installed package version",
    ({ root }) =>
      writeFileSync(
        path.join(root, "node_modules/image-size/package.json"),
        '{"name":"image-size","version":"1.2.2","main":"dist/index.js"}',
      ),
  ],
]) {
  test(`fails on ${name}, independently of an empty registry report`, (t) => {
    const data = fixture(t);
    assert.doesNotThrow(() => evaluateAuditReport(report(0)));
    mutate(data);
    assert.throws(() =>
      verifyImageSizeRemediation({
        repositoryRoot: data.root,
        dependencyRoots: data.dependencyRoots,
      }),
    );
  });
}

test("checks every dependency section and rejects new roots, aliases, versions and paths", () => {
  const valid = graph(repository);
  assert.equal(imageSizeDependencyPaths(valid, repository).length, 1);
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const candidate = clone(valid);
    candidate[0][section] = clone(valid[0].dependencies);
    assert.ok(imageSizeDependencyPaths(candidate, repository).length > 0);
    candidate[0][section]["image-size"] = {
      version: "1.2.1",
      path: path.join(repository, "node_modules/image-size"),
    };
    assert.throws(() => imageSizeDependencyPaths(candidate, repository));
  }
  for (const mutate of [
    (value) => {
      value[0].name = "@ai-job-apply/gateway";
    },
    (value) => {
      value[0].path = path.join(repository, "backend/gateway");
    },
    (value) => {
      value[0].dependencies.expo.dependencies.metro.dependencies["image-size"].version = "1.2.2";
    },
    (value) => {
      value[0].dependencies.expo.dependencies.metro.dependencies["image-size"].path =
        "relative/path";
    },
    (value) => {
      const dependencies = value[0].dependencies.expo.dependencies.metro.dependencies;
      dependencies["aliased-image"] = dependencies["image-size"];
      delete dependencies["image-size"];
    },
    (value) => {
      value[0].dependencies.expo.dependencies = {};
    },
  ]) {
    const candidate = clone(valid);
    mutate(candidate);
    assert.throws(() => imageSizeDependencyPaths(candidate, repository));
  }
});

test("rejects any changed advisory, new advisory or hidden metadata vulnerability", () => {
  for (const mutate of [
    (value) => {
      value.advisories[0].severity = "critical";
    },
    (value) => {
      value.advisories[0].github_advisory_id = "GHSA-unreviewed";
    },
    (value) => {
      value.advisories[0].cves = ["CVE-2026-99999"];
    },
    (value) => {
      value.advisories[0].cves.push("CVE-2026-99999");
    },
    (value) => {
      value.advisories[0].module_name = "another-package";
    },
    (value) => {
      value.advisories[0].patched_versions = ">=1.2.2";
    },
    (value) => {
      value.advisories[0].findings[0].version = "1.2.2";
    },
    (value) => {
      value.advisories[0].findings[0].paths = ["backend__gateway>metro>image-size"];
    },
    (value) => {
      value.advisories[0].findings[0].paths = [];
    },
    (value) => {
      value.advisories[0].findings = [];
    },
    (value) => {
      value.advisories[2] = clone(value.advisories[0]);
    },
    (value) => {
      value.metadata.vulnerabilities.critical = 1;
    },
    (value) => {
      value.metadata.vulnerabilities.high = 0;
    },
    (value) => {
      value.error = "registry failure";
    },
  ]) {
    const candidate = report();
    mutate(candidate);
    assert.throws(() => evaluateAuditReport(candidate));
  }
  for (const value of [{}, [], null, { advisories: {}, metadata: {} }]) {
    assert.throws(() => evaluateAuditReport(value));
  }
});

test("never accepts registry/tool errors, invalid JSON, timeouts, or unexpected exit codes", () => {
  assert.deepEqual(parseToolJson({ status: 0, stdout: "[]" }, [0]), []);
  for (const result of [
    { status: 2, stdout: "{}" },
    { status: null, signal: "SIGTERM", stdout: "{}" },
    { status: 0, error: new Error("timeout"), stdout: "{}" },
    { status: 0, stdout: "{invalid" },
    { status: 0, stdout: '{"error":"registry unavailable"}' },
    { status: 1, stdout: '{"message":"registry unavailable"}' },
  ]) {
    assert.throws(() => parseToolJson(result, [0, 1]));
  }
});

test("the central CLI verifies remediation before audit and retains the high-severity gate", () => {
  const source = readFileSync(new URL("../audit-dependencies.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("verifyImageSizeRemediation({") < source.indexOf('["audit",'));
  assert.match(source, /"--audit-level", "high"/u);
  assert.doesNotMatch(source, /ignore-unfixable|ignoreCves|ignoreGhsas|exceptionExpiry|Date\.now/u);
});
