import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Dedicated image entrypoint. No candidate request, argv, environment secret or workstation
// credentials can select configuration, kernel or source reader. All release files are image-owned.
const require = createRequire(import.meta.url);
const directory = new URL("./", import.meta.url);
const unavailable = () => Error("NativeImageConfigurationUnavailable");
function bytes(name, maximum) {
  const value = readFileSync(new URL(name, directory));
  if (value.byteLength < 1 || value.byteLength > maximum) throw unavailable();
  return value;
}
function verified(name, maximum, manifest) {
  const value = bytes(name, maximum);
  if (createHash("sha256").update(value).digest("hex") !== manifest.files[name])
    throw unavailable();
  return value;
}
try {
  if (
    process.argv.length !== 2 ||
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    process.versions.node.split(".")[0] !== "24" ||
    process.env.NODE_ENV !== "production" ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_SHARED_CREDENTIALS_FILE",
      "AWS_CONFIG_FILE",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "NODE_OPTIONS",
      "NODE_PATH",
    ].some((key) => process.env[key] !== undefined)
  )
    throw unavailable();
  const manifest = JSON.parse(bytes("manifest.json", 16_384).toString("utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/u.test(manifest.sourceSha) ||
    manifest.platform !== "linux/amd64" ||
    manifest.nodeMajor !== 24 ||
    Object.keys(manifest).sort().join(",") !== "files,nodeMajor,platform,schemaVersion,sourceSha" ||
    Object.keys(manifest.files).sort().join(",") !==
      "configuration.json,kernel-deadline.node,runtime.cjs" ||
    !Object.values(manifest.files).every((hash) => /^[a-f0-9]{64}$/u.test(hash))
  )
    throw unavailable();
  const configuration = JSON.parse(
    verified("configuration.json", 16_384, manifest).toString("utf8"),
  );
  // Check the emitted bundle before executing it. This proves image file integrity, not cloud
  // signature approval or a task death receipt; managed release admission remains separate.
  verified("runtime.cjs", 32 * 1024 * 1024, manifest);
  const { startNativeResumeImage } = require(new URL("runtime.cjs", directory).pathname);
  const runtime = await startNativeResumeImage({
    configuration,
    loadKernel() {
      verified("kernel-deadline.node", 1024 * 1024, manifest);
      return require(new URL("kernel-deadline.node", directory).pathname);
    },
  });
  runtime.server.once("error", () => {
    runtime.terminate();
  });
  runtime.server.listen(8443, "0.0.0.0");
} catch {
  process.stderr.write("NativeImageConfigurationUnavailable\n");
  process.exit(1);
}
