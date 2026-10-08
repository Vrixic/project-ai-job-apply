/** Explicit local Linux/PostgreSQL composition. Requires a labeled disposable, network-none database. */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
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
  args.length !== 5 ||
  process.versions.node.split(".")[0] !== "24" ||
  args[0] !== "--enable-local-approval-test" ||
  args[1] !== "--image" ||
  !/^sha256:[a-f0-9]{64}$/u.test(args[2]) ||
  args[3] !== "--database-container" ||
  !/^[a-f0-9]{64}$/u.test(args[4])
)
  throw Error("NativePostgresqlApprovalTestTargetRejected");
const database = spawnSync("docker", ["inspect", args[4]], { encoding: "utf8" });
if (database.status !== 0) throw Error("SyntheticApprovalDatabaseUnavailable");
const inspectedDatabase = JSON.parse(database.stdout)[0];
if (
  inspectedDatabase.Config.Labels?.["codex.task"] !== "native-approval" ||
  !inspectedDatabase.State.Running ||
  inspectedDatabase.HostConfig.NetworkMode !== "none" ||
  !inspectedDatabase.Config.Env.includes("POSTGRES_DB=native_approval") ||
  !inspectedDatabase.Config.Env.includes("POSTGRES_USER=synthetic") ||
  !inspectedDatabase.Config.Env.includes("POSTGRES_PASSWORD=synthetic_local_only")
)
  throw Error("SyntheticApprovalDatabaseRejected");
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const stagingRoot = path.join(root, ".tmp");
mkdirSync(stagingRoot, { recursive: true });
if (!realpathSync(stagingRoot).startsWith(`${root}${path.sep}`))
  throw Error("NativePostgresqlApprovalTestTargetRejected");
const staging = mkdtempSync(path.join(stagingRoot, "native-postgresql-approval-"));
const resolved = realpathSync(staging);
if (!resolved.startsWith(`${realpathSync(stagingRoot)}${path.sep}`))
  throw Error("NativePostgresqlApprovalTestTargetRejected");
let verificationFailure;
try {
  for (const name of ["kernel-deadline.c"])
    copyFileSync(
      path.join(root, "backend/workers/ai/native-session", name),
      path.join(staging, name),
    );
  await build({
    entryPoints: [
      path.join(root, "backend/workers/ai/native-session/approval-session-fixture.mjs"),
    ],
    outfile: path.join(staging, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import {createRequire as nativeCreateRequire} from "node:module"; const require = nativeCreateRequire(import.meta.url);',
    },
  });
  for (const owner of ["profile", "documents", "applications"]) {
    const target = path.join(staging, owner);
    cpSync(
      path.join(root, "backend/services", owner, "migrations"),
      path.join(target, "migrations"),
      { recursive: true },
    );
    await build({
      entryPoints: [path.join(root, "backend/services", owner, "src/migrate.ts")],
      outfile: path.join(target, "dist/src/migrate.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      banner: {
        js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);',
      },
    });
  }
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
      `container:${args[4]}`,
      "--env",
      "DATABASE_URL=postgres://synthetic:synthetic_local_only@127.0.0.1:5432/native_approval",
      "--env",
      "NATIVE_APPROVAL_DATABASE=synthetic-local-only",
      "--label",
      "ai-job-apply.task=d3-native-postgresql-approval",
      "--mount",
      `type=bind,source=${staging},target=/input,readonly`,
      "--tmpfs",
      "/native:rw,exec,size=67108864",
      "--entrypoint",
      "sh",
      args[2],
      "-c",
      'node -e \'if(process.versions.node.split(".")[0] !== "24") process.exit(1)\' && node /input/profile/dist/src/migrate.mjs && node /input/documents/dist/src/migrate.mjs && node /input/applications/dist/src/migrate.mjs && gcc -std=c11 -O2 -Wall -Wextra -Werror -shared -fPIC -I/usr/local/include/node /input/kernel-deadline.c -o /native/kernel-deadline.node -lrt -lm && openssl req -x509 -newkey rsa:2048 -nodes -keyout /native/key.pem -out /native/cert.pem -days 1 -subj /CN=material.test.invalid -addext subjectAltName=DNS:material.test.invalid,DNS:*.material.test.invalid 2>/dev/null && cp /input/fixture.mjs /native/fixture.mjs && NODE_EXTRA_CA_CERTS=/native/cert.pem NODE_ENV=test node /native/fixture.mjs /native/kernel-deadline.node cover_letter && NODE_EXTRA_CA_CERTS=/native/cert.pem NODE_ENV=test node /native/fixture.mjs /native/kernel-deadline.node tailored_resume',
    ],
    { cwd: root, stdio: "inherit", timeout: 180_000 },
  );
  if (result.error || result.status !== 0) throw Error("NativePostgresqlApprovalTestFailed");
} catch (error) {
  verificationFailure = error;
}
let cleanupComplete = false;
try {
  const cidFile = path.join(staging, "container-id");
  if (existsSync(cidFile)) {
    const id = readFileSync(cidFile, "utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("NativePostgresqlApprovalCleanupTargetRejected");
    const inspected = spawnSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], {
      encoding: "utf8",
    });
    if (inspected.status === 0) {
      const labels = JSON.parse(inspected.stdout);
      if (labels?.["ai-job-apply.task"] !== "d3-native-postgresql-approval")
        throw Error("NativePostgresqlApprovalCleanupTargetRejected");
      const removed = spawnSync("docker", ["rm", "--force", id], { encoding: "utf8" });
      if (removed.status !== 0) throw Error("NativePostgresqlApprovalCleanupUnavailable");
    } else if (!/No such (object|container)/iu.test(inspected.stderr ?? "")) {
      throw Error("NativePostgresqlApprovalCleanupUnavailable");
    }
  }
  cleanupComplete = true;
} catch (error) {
  throw verificationFailure
    ? new AggregateError(
        [verificationFailure, error],
        "NativePostgresqlApprovalVerificationAndCleanupFailed",
      )
    : error;
} finally {
  // Only this invocation's checked, newly created staging directory; preserve all other data.
  if (cleanupComplete) rmSync(resolved, { recursive: true, force: true });
}

if (verificationFailure) throw verificationFailure;
