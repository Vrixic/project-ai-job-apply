import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = realpathSync(fileURLToPath(new URL("../../../../", import.meta.url)));
const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  !/^[a-f0-9]{40}$/u.test(args[0]) ||
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  process.versions.node.split(".")[0] !== "24"
)
  throw Error("NativeImageBuildRejected");
const [sourceSha, configurationPath, kernelPath, output] = args;
const configFile = realpathSync(configurationPath);
if (!configFile.startsWith(`${path.join(root, "backend")}${path.sep}`))
  throw Error("NativeImageBuildRejected");
const { validateNativeImageConfiguration } = await import(
  "../../../services/documents/dist/src/native-image-runtime.js"
);
const configuration = JSON.parse(readFileSync(configFile, "utf8"));
if (!validateNativeImageConfiguration(configuration)) throw Error("NativeImageBuildRejected");
mkdirSync(output, { recursive: false });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["backend/services/documents/dist/src/native-image-runtime.js"],
  outfile: path.join(output, "runtime.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  // PDF verification lazily resolves canvas through createRequire(import.meta.url).
  // CJS has no import.meta; bind it to this image's fixed bundle location.
  define: { "import.meta.url": '"file:///materials/native-material/runtime.cjs"' },
  metafile: true,
  external: ["@napi-rs/canvas"],
});
const inputs = Object.values(result.metafile.outputs).flatMap((entry) =>
  Object.entries(entry.inputs)
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([name]) => name.replaceAll("\\", "/")),
);
for (const forbidden of [
  "postgres",
  "client-s3",
  "client-ecs",
  "client-kms",
  "backend/workflows",
  "backend/services/profile",
  "backend/services/applications",
  "backend/services/jobs",
])
  if (inputs.some((name) => name.includes(forbidden))) throw Error("NativeImageCapabilityRejected");
for (const required of [
  "client-secrets-manager",
  "native-task-bootstrap.js",
  "native-owner-rpc-client.js",
  "openai",
  "native-memory-transport.js",
  "render/render.js",
  "pdfjs-dist",
])
  if (!inputs.some((name) => name.includes(required))) throw Error("NativeImageCapabilityRejected");
copyFileSync(kernelPath, path.join(output, "kernel-deadline.node"));
copyFileSync(new URL("main.mjs", import.meta.url), path.join(output, "main.mjs"));
writeFileSync(path.join(output, "configuration.json"), `${JSON.stringify(configuration)}\n`);
// Include the real Linux canvas dependency, rather than accepting parser startup warnings.
const require = createRequire(path.join(root, "backend/services/documents/package.json"));
const pdfRequire = createRequire(require.resolve("pdfjs-dist/package.json"));
const canvasRoot = path.dirname(pdfRequire.resolve("@napi-rs/canvas/package.json"));
const canvasRequire = createRequire(path.join(canvasRoot, "package.json"));
const binaryRoot = path.dirname(
  canvasRequire.resolve("@napi-rs/canvas-linux-x64-gnu/package.json"),
);
const nativeModules = path.join(output, "node_modules/@napi-rs");
mkdirSync(nativeModules, { recursive: true });
cpSync(canvasRoot, path.join(nativeModules, "canvas"), {
  recursive: true,
  dereference: true,
  filter: (name) => path.basename(name) !== "node_modules",
});
cpSync(binaryRoot, path.join(nativeModules, "canvas-linux-x64-gnu"), {
  recursive: true,
  dereference: true,
  filter: (name) => path.basename(name) !== "node_modules",
});
const files = Object.fromEntries(
  ["configuration.json", "kernel-deadline.node", "runtime.cjs"].map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(path.join(output, name)))
      .digest("hex"),
  ]),
);
writeFileSync(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, sourceSha, platform: "linux/amd64", nodeMajor: 24, files })}\n`,
);
console.log("NativeImageBuild:ok");
