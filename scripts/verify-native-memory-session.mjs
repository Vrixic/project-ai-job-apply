/** Explicit local Linux test only. No cloud/model call or publication. */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const args = process.argv.slice(2);
if (
  args.length !== 3 ||
  process.versions.node.split(".")[0] !== "24" ||
  args[0] !== "--enable-local-linux-tests" ||
  args[1] !== "--image" ||
  !/^sha256:[a-f0-9]{64}$/u.test(args[2])
)
  throw Error("NativeMemorySessionTestTargetRejected");
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const stagingRoot = path.join(root, ".tmp");
mkdirSync(stagingRoot, { recursive: true });
if (!realpathSync(stagingRoot).startsWith(`${root}${path.sep}`))
  throw Error("NativeMemorySessionTestTargetRejected");
const staging = mkdtempSync(path.join(stagingRoot, "native-memory-session-"));
const resolved = realpathSync(staging);
if (!resolved.startsWith(`${realpathSync(stagingRoot)}${path.sep}`))
  throw Error("NativeMemorySessionTestTargetRejected");
let verificationFailure;
try {
  for (const name of ["kernel-deadline.c", "native.test.mjs"])
    copyFileSync(
      path.join(root, "backend/workers/ai/native-session", name),
      path.join(staging, name),
    );
  await build({
    entryPoints: [path.join(root, "backend/workers/ai/native-session/fixture.mjs")],
    outfile: path.join(staging, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import {createRequire as nativeCreateRequire} from "node:module"; const require = nativeCreateRequire(import.meta.url);',
    },
  });
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--cidfile",
      path.join(staging, "container-id"),
      "--pull",
      "never",
      "--network",
      "none",
      "--label",
      "ai-job-apply.task=d3-native-memory-session",
      "--mount",
      `type=bind,source=${staging},target=/input,readonly`,
      "--tmpfs",
      "/native:rw,exec,size=67108864",
      "--entrypoint",
      "sh",
      args[2],
      "-c",
      'node -e \'if(process.versions.node.split(".")[0] !== "24") process.exit(1)\' && gcc -std=c11 -O2 -Wall -Wextra -Werror -shared -fPIC -I/usr/local/include/node /input/kernel-deadline.c -o /native/kernel-deadline.node -lrt -lm && openssl req -x509 -newkey rsa:2048 -nodes -keyout /native/key.pem -out /native/cert.pem -days 1 -subj /CN=material.test.invalid -addext subjectAltName=DNS:material.test.invalid 2>/dev/null && cp /input/fixture.mjs /native/fixture.mjs && NODE_ENV=test node --test --test-concurrency=1 /input/native.test.mjs',
    ],
    { cwd: root, stdio: "inherit", timeout: 120_000 },
  );
  if (result.error || result.status !== 0) throw Error("NativeMemorySessionTestFailed");
} catch (error) {
  verificationFailure = error;
}
let cleanupComplete = false;
try {
  const cidFile = path.join(staging, "container-id");
  if (existsSync(cidFile)) {
    const id = readFileSync(cidFile, "utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("NativeMemorySessionCleanupTargetRejected");
    const inspected = spawnSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], {
      encoding: "utf8",
    });
    if (inspected.status === 0) {
      const labels = JSON.parse(inspected.stdout);
      if (labels?.["ai-job-apply.task"] !== "d3-native-memory-session")
        throw Error("NativeMemorySessionCleanupTargetRejected");
      const removed = spawnSync("docker", ["rm", "--force", id], { encoding: "utf8" });
      if (removed.status !== 0) throw Error("NativeMemorySessionCleanupUnavailable");
    } else if (!/No such (object|container)/iu.test(inspected.stderr ?? "")) {
      throw Error("NativeMemorySessionCleanupUnavailable");
    }
  }
  cleanupComplete = true;
} catch (error) {
  throw verificationFailure
    ? new AggregateError(
        [verificationFailure, error],
        "NativeMemorySessionVerificationAndCleanupFailed",
      )
    : error;
} finally {
  // Only this invocation's checked, newly created staging directory; preserve all other data.
  if (cleanupComplete) rmSync(resolved, { recursive: true, force: true });
}

if (verificationFailure) throw verificationFailure;
