// Test-only process supervisor. Production main never imports this fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { exerciseNativeRuntime } from "../native-session/runtime-fixture.mjs";

assert.equal(process.env.NODE_ENV, "test");
const root = "/materials/native-material";
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
const sourceSha = process.argv[2];
assert.match(sourceSha, /^[a-f0-9]{40}$/u);
assert.equal(manifest.sourceSha, sourceSha);
for (const [name, hash] of Object.entries(manifest.files))
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`${root}/${name}`))
      .digest("hex"),
    hash,
  );
const mode = process.argv[3];
if (mode) {
  assert.ok(
    [
      "runtime-image",
      "runtime-image-version-two",
      "runtime-image-secret-refused",
      "runtime-image-tls-refused",
    ].includes(mode),
  );
  await exerciseNativeRuntime(mode, `${root}/kernel-deadline.node`, true);
  process.exit(0);
}
for (const current of [
  "runtime-image",
  "runtime-image-version-two",
  "runtime-image-secret-refused",
  "runtime-image-tls-refused",
]) {
  const child = spawn(process.execPath, ["/native/image-proof.mjs", sourceSha, current], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    diagnostics = "",
    forced = false;
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    diagnostics += chunk;
  });
  const expiry = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 9000);
  try {
    const [code, signal] = await once(child, "exit");
    assert.equal(forced, false, "Image proof supervisor fallback cannot prove kernel retirement");
    assert.equal(diagnostics, "", "No unknown or content-derived diagnostics are permitted");
    assert.ok(output.trim(), `Missing scalar proof: ${current}, code=${code}, signal=${signal}`);
    const value = JSON.parse(output.trim());
    if (current.endsWith("refused")) {
      assert.equal(code, 0);
      assert.equal(signal, null);
      assert.deepEqual(value, {
        imageRefused: true,
        secretReads: 2,
        providerCalls: 0,
        controlInvocations: 0,
      });
    } else {
      assert.equal(code, null);
      assert.equal(signal, "SIGKILL");
      assert.equal(value.ready, true);
      assert.equal(value.providerCalls, 1);
      assert.equal(value.controlInvocations, 3);
      assert.equal(value.actualFiles, 2);
      assert.equal(value.originalExpiry - value.originalCompletion, 1_800_000);
      assert.ok(Date.now() - value.originalCompletion < 6000);
    }
    process.stdout.write(`${JSON.stringify({ scenario: current, passed: true })}\n`);
  } finally {
    clearTimeout(expiry);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
