// Test-only entrypoint. Exercises the immutable image bundle with synthetic external ports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { exerciseResumeRuntime } from "../native-session/resume-runtime-fixture.mjs";

const directory = "/materials/native-resume/";
const manifest = JSON.parse(readFileSync(`${directory}manifest.json`, "utf8"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.getuid(), 65532);
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert.equal(manifest.sourceSha, process.argv[2]);
assert.equal(manifest.platform, "linux/amd64");
for (const name of ["configuration.json", "runtime.cjs", "kernel-deadline.node"]) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`${directory}${name}`))
      .digest("hex"),
    manifest.files[name],
  );
}
const { startNativeResumeImage } = createRequire(import.meta.url)(`${directory}runtime.cjs`);
await exerciseResumeRuntime(
  "resume-runtime-image",
  `${directory}kernel-deadline.node`,
  startNativeResumeImage,
);
