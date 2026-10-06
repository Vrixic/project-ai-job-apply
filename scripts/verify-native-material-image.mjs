/** Explicit local image conformance only. Synthetic ports; no pulls, AWS or provider calls. */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const args = process.argv.slice(2);
if (
  args.length !== 7 ||
  args[0] !== "--enable-local-image-tests" ||
  args[1] !== "--image" ||
  args[3] !== "--certificate-image" ||
  args[5] !== "--source-sha" ||
  !/^sha256:[a-f0-9]{64}$/u.test(args[2]) ||
  !/^sha256:[a-f0-9]{64}$/u.test(args[4]) ||
  !/^[a-f0-9]{40}$/u.test(args[6]) ||
  process.versions.node.split(".")[0] !== "24"
)
  throw Error("NativeImageProofTargetRejected");
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const stagingRoot = path.join(root, ".tmp");
mkdirSync(stagingRoot, { recursive: true });
if (!realpathSync(stagingRoot).startsWith(`${root}${path.sep}`))
  throw Error("NativeImageProofTargetRejected");
const staging = realpathSync(mkdtempSync(path.join(stagingRoot, "native-image-proof-")));
if (!staging.startsWith(`${realpathSync(stagingRoot)}${path.sep}`))
  throw Error("NativeImageProofTargetRejected");
const label = "ai-job-apply.task=d3-native-image-proof";
const containers = [];
function docker(command, timeout = 30000) {
  const result = spawnSync("docker", command, {
    cwd: root,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw Error("NativeImageProofOperationFailed");
  return result.stdout.trim();
}
function remove(id) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("NativeImageProofCleanupRejected");
  const result = spawnSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (/No such (object|container)/iu.test(result.stderr ?? "")) return;
    throw Error("NativeImageProofCleanupUnavailable");
  }
  if (JSON.parse(result.stdout)?.["ai-job-apply.task"] !== "d3-native-image-proof")
    throw Error("NativeImageProofCleanupRejected");
  docker(["rm", "--force", id]);
}
let failure;
try {
  const image = JSON.parse(docker(["image", "inspect", args[2]]))[0];
  if (
    image.Id !== args[2] ||
    image.Os !== "linux" ||
    image.Architecture !== "amd64" ||
    image.Config.User !== "65532:65532" ||
    image.Config.WorkingDir !== "/materials" ||
    JSON.stringify(image.Config.Entrypoint) !== '["/usr/local/bin/node"]' ||
    JSON.stringify(image.Config.Cmd) !== '["native-material/main.mjs"]'
  )
    throw Error("NativeImageProofTargetRejected");
  await build({
    entryPoints: [path.join(root, "backend/workers/ai/native-material/image-proof.mjs")],
    outfile: path.join(staging, "image-proof.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: 'import {createRequire as proofRequire} from "node:module"; const require = proofRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "actual-image-runtime",
        setup(builder) {
          builder.onResolve({ filter: /native-image-runtime\.ts$/ }, () => ({
            path: "actual-image-runtime",
            namespace: "actual-image",
          }));
          builder.onLoad({ filter: /.*/, namespace: "actual-image" }, () => ({
            contents:
              'import {createRequire} from "node:module"; export const startNativeImage = createRequire(import.meta.url)("/materials/native-material/runtime.cjs").startNativeImage;',
            loader: "js",
          }));
        },
      },
    ],
  });
  // The certificate is generated-only fixture data, never a managed key or candidate artifact.
  const certificateContainer = docker([
    "create",
    "--pull",
    "never",
    "--network",
    "none",
    "--label",
    label,
    "--log-driver",
    "none",
    "--tmpfs",
    "/synthetic:rw,noexec,size=1048576",
    "--entrypoint",
    "sh",
    args[4],
    "-c",
    "while :; do sleep 60; done",
  ]);
  containers.push(certificateContainer);
  docker(["start", certificateContainer]);
  docker([
    "exec",
    certificateContainer,
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "/synthetic/key.pem",
    "-out",
    "/synthetic/cert.pem",
    "-days",
    "1",
    "-subj",
    "/CN=material.test.invalid",
    "-addext",
    "subjectAltName=DNS:material.test.invalid,DNS:*.material.test.invalid",
  ]);
  for (const file of ["key.pem", "cert.pem"]) {
    const generated = docker(["exec", certificateContainer, "cat", `/synthetic/${file}`]);
    if (generated.length > 16384 || !generated.startsWith("-----BEGIN "))
      throw Error("NativeImageProofOperationFailed");
    writeFileSync(path.join(staging, file), `${generated}\n`);
    chmodSync(path.join(staging, file), 0o644);
  }
  remove(certificateContainer);
  const cid = path.join(staging, "runtime-cid");
  const run = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--pull",
      "never",
      "--cidfile",
      cid,
      "--network",
      "none",
      "--label",
      label,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--ulimit",
      "core=0:0",
      "--pids-limit",
      "64",
      "--memory",
      "512m",
      "--log-driver",
      "none",
      "--mount",
      `type=bind,source=${staging},target=/native,readonly`,
      "--env",
      "NODE_ENV=test",
      "--env",
      "NODE_PATH=/materials/native-material/node_modules",
      args[2],
      "/native/image-proof.mjs",
      args[6],
    ],
    { cwd: root, encoding: "utf8", timeout: 45000, maxBuffer: 1024 * 1024 },
  );
  if (existsSync(cid)) containers.push(readFileSync(cid, "utf8").trim());
  if (run.error || run.status !== 0 || run.stderr !== "")
    throw Error("NativeImageConformanceFailed");
  const rows = run.stdout
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  const expected = [
    "runtime-image",
    "runtime-image-version-two",
    "runtime-image-secret-refused",
    "runtime-image-tls-refused",
  ];
  if (
    rows.length !== 4 ||
    rows.some(
      (row, i) => JSON.stringify(row) !== JSON.stringify({ scenario: expected[i], passed: true }),
    )
  )
    throw Error("NativeImageConformanceFailed");
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
} catch (error) {
  failure = error;
}
try {
  for (const id of containers) remove(id);
  rmSync(staging, { recursive: true, force: true });
} catch {
  throw Error("NativeImageProofCleanupUnavailable");
}
if (failure) throw failure;
