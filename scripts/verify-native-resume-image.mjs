/** Local immutable-image smoke. No cloud calls, pulls, publication or real candidate data. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const args = process.argv.slice(2);
if (
  args.length !== 7 ||
  args[0] !== "--enable-local-image-test" ||
  args[1] !== "--image" ||
  !/^sha256:[a-f0-9]{64}$/u.test(args[2]) ||
  args[3] !== "--source-sha" ||
  !/^[a-f0-9]{40}$/u.test(args[4]) ||
  args[5] !== "--openssl" ||
  !path.isAbsolute(args[6]) ||
  !existsSync(args[6])
)
  throw Error("NativeResumeImageTestTargetRejected");
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const stagingRoot = path.join(root, ".tmp");
mkdirSync(stagingRoot, { recursive: true });
if (!realpathSync(stagingRoot).startsWith(`${root}${path.sep}`))
  throw Error("NativeResumeImageTestTargetRejected");
const staging = realpathSync(mkdtempSync(path.join(stagingRoot, "native-resume-image-")));
if (!staging.startsWith(`${realpathSync(stagingRoot)}${path.sep}`))
  throw Error("NativeResumeImageTestTargetRejected");
const label = "d3-native-resume-image";
// "redraw": no original file, drawn from the layout. "original": a synthetic candidate PDF edited in place.
const scenarios = ["redraw", "original"];
let failure;
const receipts = [];
try {
  const certificate = spawnSync(
    args[6],
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(staging, "key.pem"),
      "-out",
      path.join(staging, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=material.test.invalid",
      "-addext",
      "subjectAltName=DNS:material.test.invalid,DNS:*.material.test.invalid",
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  if (certificate.error || certificate.status !== 0)
    throw Error("SyntheticImageCertificateUnavailable");
  await build({
    entryPoints: [path.join(root, "backend/workers/ai/native-resume/image-fixture.mjs")],
    outfile: path.join(staging, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@napi-rs/canvas"],
    define: { "import.meta.url": '"file:///materials/native-resume/runtime.cjs"' },
    banner: {
      js: 'import {createRequire as fixtureRequire} from "node:module"; const require = fixtureRequire("file:///materials/native-resume/runtime.cjs");',
    },
  });
  // The synthetic candidate PDF and its parsed document are made on the host, before the container
  // starts with no network and a read-only root.
  await build({
    entryPoints: [path.join(root, "backend/workers/ai/native-resume/image-fixture-prep.mjs")],
    outfile: path.join(staging, "prep.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@napi-rs/canvas"],
    banner: {
      js: 'import {createRequire as prepRequire} from "node:module"; const require = prepRequire(import.meta.url);',
    },
  });
  const prepared = spawnSync(process.execPath, [path.join(staging, "prep.mjs"), staging], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (prepared.error || prepared.status !== 0) throw Error("SyntheticOriginalPdfUnavailable");
  for (const scenario of scenarios) {
    const started = performance.now();
    const result = spawnSync(
      "docker",
      [
        "run",
        "--init",
        "--pull",
        "never",
        "--cidfile",
        path.join(staging, `container-id-${scenario}`),
        "--label",
        `ai-job-apply.task=${label}`,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--ulimit",
        "core=0",
        "--memory",
        "512m",
        "--pids-limit",
        "64",
        "--user",
        "65532:65532",
        "--mount",
        `type=bind,source=${staging},target=/native,readonly`,
        "--env",
        "NODE_ENV=test",
        "--entrypoint",
        "/usr/local/bin/node",
        args[2],
        "/native/fixture.mjs",
        args[4],
        scenario,
      ],
      { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const elapsed = performance.now() - started;
    assert.equal(result.error, undefined, "Image must exit before host fallback");
    assert.equal(result.status, 137, result.stderr);
    assert.ok(
      elapsed < 12_000,
      `Image deadline exceeded container startup tolerance (${scenario}, ${Math.round(elapsed)} ms)`,
    );
    assert.equal(result.stderr, "", "Image emitted unexpected diagnostics");
    const completedId = readFileSync(path.join(staging, `container-id-${scenario}`), "utf8").trim();
    assert.match(completedId, /^[a-f0-9]{64}$/u);
    const observed = spawnSync("docker", ["inspect", "--format", "{{json .State}}", completedId], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(observed.status, 0);
    const state = JSON.parse(observed.stdout);
    assert.equal(state.Status, "exited");
    assert.equal(state.ExitCode, 137);
    assert.equal(state.OOMKilled, false, "An OOM kill is not native deadline evidence");
    const proof = JSON.parse(result.stdout.trim());
    assert.equal(proof.ready, true);
    assert.equal(proof.actualFiles, 1);
    assert.ok(proof.runtimeAssertions >= 20);
    assert.equal(proof.originalExpiry - proof.originalCompletion, 1_800_000);
    receipts.push({
      image: args[2],
      sourceSha: args[4],
      scenario,
      ...proof,
      exitCode: 137,
      elapsedMilliseconds: Math.round(elapsed),
      externalPorts: "synthetic",
      network: "none",
      init: true,
      readOnly: true,
      uid: 65532,
      oomKilled: false,
    });
  }
} catch (error) {
  failure = error;
}
let cleaned = false;
try {
  for (const scenario of scenarios) {
    const cid = path.join(staging, `container-id-${scenario}`);
    if (!existsSync(cid)) continue;
    const id = readFileSync(cid, "utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("NativeResumeImageCleanupTargetRejected");
    const inspected = spawnSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (inspected.status === 0) {
      if (JSON.parse(inspected.stdout)?.["ai-job-apply.task"] !== label)
        throw Error("NativeResumeImageCleanupTargetRejected");
      const removed = spawnSync("docker", ["rm", "--force", id], {
        encoding: "utf8",
        timeout: 10_000,
      });
      if (removed.status !== 0) throw Error("NativeResumeImageCleanupUnavailable");
    } else if (!/No such (object|container)/iu.test(inspected.stderr ?? ""))
      throw Error("NativeResumeImageCleanupUnavailable");
  }
  cleaned = true;
} catch (error) {
  throw failure
    ? new AggregateError([failure, error], "NativeResumeImageTestAndCleanupFailed")
    : error;
} finally {
  // Checked, newly created staging only. Never remove shared images or volumes.
  if (cleaned) rmSync(staging, { recursive: true, force: true });
}
if (failure) throw failure;
for (const receipt of receipts) process.stdout.write(`${JSON.stringify(receipt)}\n`);
